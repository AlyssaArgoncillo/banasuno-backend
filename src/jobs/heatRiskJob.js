/**
 * Heat risk job: fetch barangay-level forecast from Open-Meteo, compute heat index and risk level,
 * then insert into Supabase heat_risk_counts via insertHeatRisk().
 *
 * Run manually: npm run heat-risk-job   or   node src/jobs/heatRiskJob.js
 * Run on a schedule (automatic):
 *   npm run heat-risk-job:schedule   or   node src/jobs/heatRiskJob.js --schedule
 *
 * With --schedule:
 * - Heat risk + city temperatures + 7-day cleanups run every hour.
 * - Historical trends + 30-day cleanup run once per day after midnight (UTC hour 0 by default;
 *   set HEAT_HISTORICAL_UTC_HOUR=0 in .env to change, e.g. 1 for 01:00 UTC).
 *
 * Or use system cron: 0 * * * * cd /path/to/app && node src/jobs/heatRiskJob.js
 */

import "dotenv/config";
import { getDavaoBarangayGeo, getBarangayCentroids } from "../lib/barangays.js";
import { getOpenMeteoCurrent, getCurrentWeather } from "../services/weatherService.js";
import { assessBarangayHeatRisk } from "../services/heatRiskModel.js";
import { insertHeatRisk } from "../services/heatRiskCounts.js";
import {
  insertCityTemperature,
  deleteOlderThan7Days as deleteCityTemperaturesOlderThan7Days,
} from "../services/cityTemperatures.js";
import { deleteOlderThan7Days as deleteHeatRiskCountsOlderThan7Days } from "../services/heatRiskCounts.js";
import {
  fetchAndStoreCityHistoricalTrends,
  deleteOlderThan30Days,
} from "../services/historicalTrends.js";

const OPEN_METEO_TIMEZONE = process.env.HEAT_OPEN_METEO_TIMEZONE || "Asia/Singapore";
const CONCURRENCY = Math.max(1, Math.min(20, parseInt(process.env.HEAT_JOB_CONCURRENCY, 10) || 5));
const CITY_ID = "davao";
const SOURCE = "open-meteo";
/** WeatherAPI location query for city average (e.g. "7.1907,125.4553" or "Davao City"). */
const CITY_WEATHER_QUERY = process.env.HEAT_CITY_WEATHER_QUERY || "7.1907,125.4553";
/** City name for WeatherAPI history.json (q=). */
const CITY_NAME_WEATHER_API = "Davao";
/** UTC hour when to run historical trends in scheduled mode (0 = midnight UTC). */
const HISTORICAL_UTC_HOUR = Math.max(0, Math.min(23, parseInt(process.env.HEAT_HISTORICAL_UTC_HOUR, 10) || 0));

function log(msg, ...args) {
  console.log("[HeatRiskJob]", msg, ...args);
}

/**
 * Run async work with limited concurrency.
 * @param {Array<{ key: string, lat: number, lng: number, barangayId: string }>} items
 * @param {(item: any) => Promise<{ temp_c: number, humidity?: number } | null>} fn
 * @returns {Promise<Map<string, { temp_c: number, humidity?: number }>>}
 */
async function runWithConcurrency(items, fn) {
  const results = new Map();
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const item = items[index++];
      try {
        const value = await fn(item);
        if (item.key != null && value != null) results.set(item.key, value);
      } catch (err) {
        log(`Error for ${item.barangayId}:`, err.message);
      }
    }
  }
  const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Fetch Open-Meteo current temp + humidity for all barangay centroids and assess risk; insert each into Supabase.
 * @param {{ runHistoricalTrends?: boolean }} [opts] - runHistoricalTrends: if false, skip historical_trends fetch and 30-day cleanup (used in scheduled mode except at midnight).
 * @returns {Promise<{ inserted: number, failed: number, errors: string[] }>}
 */
export async function runHeatRiskJob(opts = {}) {
  const runHistoricalTrends = opts.runHistoricalTrends !== false;
  const errors = [];
  let inserted = 0;
  let failed = 0;

  try {
    const geo = await getDavaoBarangayGeo();
    const list = getBarangayCentroids(geo);
    if (list.length === 0) {
      log("No barangay centroids found.");
      return { inserted: 0, failed: 0, errors: ["No barangay centroids"] };
    }

    log("Fetching Open-Meteo for", list.length, "barangays (concurrency:", CONCURRENCY + ")");

    const items = list.map(({ barangayId, lat, lng }) => ({
      key: barangayId,
      barangayId,
      lat,
      lng,
    }));

    const weatherByKey = await runWithConcurrency(items, async (item) => {
      const weather = await getOpenMeteoCurrent(item.lat, item.lng, OPEN_METEO_TIMEZONE);
      if (!weather || typeof weather.temp_c !== "number") return null;
      const temp_c = Math.round(weather.temp_c * 10) / 10;
      const humidity =
        typeof weather.humidity === "number" && weather.humidity >= 0 && weather.humidity <= 100
          ? weather.humidity
          : undefined;
      return { temp_c, humidity };
    });

    const temperatures = {};
    const humidityByBarangay = {};
    for (const [barangayId, w] of weatherByKey) {
      if (typeof w.temp_c === "number") {
        temperatures[barangayId] = w.temp_c;
        if (typeof w.humidity === "number") humidityByBarangay[barangayId] = w.humidity;
      }
    }

    const { risks } = assessBarangayHeatRisk(temperatures, { humidityByBarangay });

    for (const [barangayId, risk] of Object.entries(risks)) {
      const payload = {
        barangay_psgc: barangayId,
        city_id: CITY_ID,
        risk_level: risk.level,
        risk_label: risk.label,
        heat_index_c: risk.heat_index_c ?? null,
        source: SOURCE,
      };
      const result = await insertHeatRisk(payload);
      if (result.ok) {
        inserted++;
        log("Inserted", barangayId, risk.label, result.id ? `(id: ${result.id})` : "");
      } else {
        failed++;
        errors.push(`${barangayId}: ${result.error || "unknown"}`);
      }
    }

    const apiKey = process.env.WEATHER_API_KEY?.trim();
    if (!apiKey) {
      log("WEATHER_API_KEY not set; skipping city average temperature insert.");
    } else {
      try {
        const cityWeather = await getCurrentWeather(apiKey, CITY_WEATHER_QUERY);
        const avg_temp_c =
          cityWeather != null && typeof cityWeather.temp_c === "number"
            ? Math.round(cityWeather.temp_c * 10) / 10
            : null;
        if (avg_temp_c != null) {
          const cityResult = await insertCityTemperature({
            city_id: CITY_ID,
            avg_temp_c,
            recorded_at: new Date().toISOString().slice(0, 10),
          });
          if (cityResult.ok) {
            log("City temperature inserted (WeatherAPI):", CITY_ID, avg_temp_c + "°C", cityResult.recorded_at ? `(${cityResult.recorded_at})` : "");
          } else {
            errors.push(`city_temperatures: ${cityResult.error || "unknown"}`);
          }
        } else {
          log("WeatherAPI current.json did not return temp_c; skipping city temperature insert.");
        }
      } catch (err) {
        log("WeatherAPI city temperature error:", err.message);
        errors.push(`city_temperatures (WeatherAPI): ${err.message}`);
      }
    }

    if (apiKey && runHistoricalTrends) {
      try {
        const trendResult = await fetchAndStoreCityHistoricalTrends(
          apiKey,
          CITY_ID,
          CITY_NAME_WEATHER_API,
          14
        );
        log("Historical trends (WeatherAPI history.json): inserted", trendResult.inserted, "days");
        if (trendResult.errors?.length) trendResult.errors.forEach((e) => errors.push(`historical_trends: ${e}`));
        const cleanup = await deleteOlderThan30Days();
        if (cleanup.ok && cleanup.deleted > 0) log("Historical trends cleanup: deleted", cleanup.deleted, "rows older than 30 days");
      } catch (err) {
        log("Historical trends error:", err.message);
        errors.push(`historical_trends: ${err.message}`);
      }
    } else if (!runHistoricalTrends) {
      log("Skipping historical trends (scheduled run, not midnight hour).");
    }

    const ctCleanup = await deleteCityTemperaturesOlderThan7Days();
    if (ctCleanup.ok && ctCleanup.deleted > 0) log("city_temperatures 7-day cleanup: deleted", ctCleanup.deleted);
    const hrcCleanup = await deleteHeatRiskCountsOlderThan7Days();
    if (hrcCleanup.ok && hrcCleanup.deleted > 0) log("heat_risk_counts 7-day cleanup: deleted", hrcCleanup.deleted);

    log("Done. Inserted:", inserted, "Failed:", failed);
    return { inserted, failed, errors };
  } catch (err) {
    log("Job error:", err.message);
    errors.push(err.message);
    return { inserted, failed, errors };
  }
}

async function main() {
  const schedule = process.argv.includes("--schedule");
  if (schedule) {
    const hour = () => new Date().getUTCHours();
    const runHistorical = () => hour() === HISTORICAL_UTC_HOUR;
    log("Scheduled mode: heat risk every hour; historical trends once per day at", HISTORICAL_UTC_HOUR + ":00 UTC.");
    await runHeatRiskJob({ runHistoricalTrends: runHistorical() });
    setInterval(async () => {
      log("Scheduled run.");
      await runHeatRiskJob({ runHistoricalTrends: runHistorical() });
    }, 60 * 60 * 1000);
    return;
  }
  await runHeatRiskJob();
}

main().catch((err) => {
  console.error("[HeatRiskJob] Fatal:", err);
  process.exit(1);
});

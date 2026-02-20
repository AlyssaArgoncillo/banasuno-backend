/**
 * Heat / barangay temperatures API.
 * WeatherAPI (WEATHER_API_KEY) only: per-barangay temp by lat,lon (centroid); used for heat risk computation.
 */

import express from "express";
import { Router } from "express";
import {
  getCurrentWeather as getWeatherWeatherAPI,
  getForecast as getWeatherForecast,
} from "../services/weatherService.js";
import { getDavaoBarangayGeo, getBarangayCentroids } from "../lib/barangays.js";
import { getPopulationDensityByBarangayId } from "../lib/populationByBarangay.js";
import { assessBarangayHeatRisk } from "../services/heatRiskModel.js";
import {
  getFacilities,
  getPipelineReport,
  getPipelineReportMeta,
  setPipelineReport,
} from "../lib/store.js";
import { assessFacilitiesInBarangay } from "../services/facilitiesByBarangay.js";
import { runPipelineReport } from "../services/pipelineReportGenerator.js";

/** Davao City center for WeatherAPI average temp (lat, lon) */
const DAVAO_CENTER = "7.1907,125.4553";

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const CACHE_KEY_AVG = "davao_avg";
const CACHE_KEY_FORECAST_7 = "davao_forecast_7";
const CACHE_KEY_FORECAST_14 = "davao_forecast_14";
/** Parallel WeatherAPI requests for per-barangay fetch. */
const CONCURRENCY = Math.max(1, Math.min(20, parseInt(process.env.WEATHER_API_CONCURRENCY, 10) || 5));

const router = Router();

/** Cache: "lat,lng" (2 decimals) -> { temp_c, ts }; CACHE_KEY_AVG -> { temp_c, ts } */
const weatherCache = new Map();

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** Precision 3 ≈ 111 m; fewer barangays share one WeatherAPI call when not in per-barangay mode. */
function cacheKey(lat, lng) {
  return `${Number(lat).toFixed(3)},${Number(lng).toFixed(3)}`;
}

/** When true, one WeatherAPI request per barangay (exact centroid); closer estimate, more API calls. */
const PER_BARANGAY = process.env.HEAT_PER_BARANGAY === "1" || process.env.HEAT_PER_BARANGAY === "true";

/** Max °C to add for urban heat island (density proxy). 0 = disabled. */
const UHI_MAX_C = Math.max(0, parseFloat(process.env.HEAT_UHI_MAX) || 0);

async function runWithConcurrency(items, fn) {
  const results = new Map();
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const item = items[index++];
      const temp = await fn(item);
      if (item.key != null && temp != null) results.set(item.key, temp);
    }
  }
  const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * GET /api/heat/:cityId/barangay-population
 * Returns { [barangayId]: { population, density } } for pipeline (PSA census + GeoJSON area).
 */
router.get("/heat/:cityId/barangay-population", async (req, res) => {
  const cityId = (req.params.cityId || "").toLowerCase();
  if (cityId !== "davao") {
    return res.status(404).json({ error: "City not supported", cityId });
  }
  try {
    const map = await getPopulationDensityByBarangayId();
    return res.json(map);
  } catch (err) {
    console.error("Barangay population error:", err);
    return res.status(500).json({ error: "Failed to load population data" });
  }
});

/**
 * GET /api/heat/:cityId/pipeline-report/meta
 * Returns available and updatedAt for the pipeline report (for display when offering download).
 */
router.get("/heat/:cityId/pipeline-report/meta", async (req, res) => {
  const cityId = (req.params.cityId || "").toLowerCase();
  if (cityId !== "davao") {
    return res.status(404).json({ error: "City not supported", cityId });
  }
  try {
    const { available, updatedAt } = await getPipelineReportMeta(cityId);
    return res.json({
      available,
      updatedAt: updatedAt || null,
    });
  } catch (err) {
    console.error("Pipeline report meta error:", err);
    return res.status(500).json({ error: "Failed to load pipeline report meta" });
  }
});

/**
 * GET /api/heat/:cityId/pipeline-report
 * Returns the latest pipeline heat-risk report CSV for download (stored in Postgres by pipeline script).
 * Frontend can link or fetch this URL and trigger a file download.
 */
router.get("/heat/:cityId/pipeline-report", async (req, res) => {
  const cityId = (req.params.cityId || "").toLowerCase();
  if (cityId !== "davao") {
    return res.status(404).json({ error: "City not supported", cityId });
  }
  try {
    const { csv, updatedAt } = await getPipelineReport(cityId);
    if (csv == null || csv === "") {
      return res.status(404).json({
        error: "No pipeline report available",
        hint: "Run the AI pipeline and upload the report (POST with x-pipeline-report-key), or wait for the next scheduled run.",
      });
    }
    const filename = `barangay_heat_risk_${cityId}_${(updatedAt || "latest").replace(/[:.]/g, "-")}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(csv);
  } catch (err) {
    console.error("Pipeline report download error:", err);
    return res.status(500).json({ error: "Failed to load pipeline report" });
  }
});

/**
 * POST /api/heat/:cityId/pipeline-report/generate
 * Generate the pipeline heat-risk report on demand (same logic as AI pipeline: heat + facilities + density, K-Means, PAGASA levels).
 * Frontend can call this to trigger generation, then GET pipeline-report to download. May take 1–2 min (WeatherAPI per-barangay temps).
 */
router.post("/heat/:cityId/pipeline-report/generate", async (req, res) => {
  const cityId = (req.params.cityId || "").toLowerCase();
  if (cityId !== "davao") {
    return res.status(404).json({ error: "City not supported", cityId });
  }

  const weatherApiKey = process.env.WEATHER_API_KEY;
  if (!weatherApiKey) {
    return res.status(503).json({
      error: "Pipeline generate requires WeatherAPI",
      hint: "Set WEATHER_API_KEY in .env (https://www.weatherapi.com/my/)",
    });
  }

  try {
    const tempsData = await fetchBarangayTempsWeatherAPI(weatherApiKey, null);
    const temperatures = tempsData.temperatures || {};
    if (Object.keys(temperatures).length === 0) {
      return res.status(502).json({ error: "No temperature data returned; cannot generate report." });
    }

    const geo = await getDavaoBarangayGeo();
    const centroids = getBarangayCentroids(geo);
    const barangayIds = centroids.map((c) => c.barangayId);

    let facilities = [];
    try {
      facilities = await getFacilities();
      if (!Array.isArray(facilities)) facilities = [];
    } catch (e) {
      console.warn("Facilities not loaded for pipeline generate:", e?.message);
    }
    const facilityCounts = {};
    for (const bid of barangayIds) {
      const result = await assessFacilitiesInBarangay(bid, facilities);
      facilityCounts[bid] = result.total ?? 0;
    }

    let populationDensity = {};
    try {
      populationDensity = await getPopulationDensityByBarangayId();
    } catch (e) {
      console.warn("Population/density not loaded for pipeline generate:", e?.message);
    }

    const rows = barangayIds
      .filter((id) => typeof temperatures[id] === "number")
      .map((id) => ({
        barangay_id: id,
        temp: temperatures[id],
        facility_score: 1 / (1 + (facilityCounts[id] ?? 0)),
        density: (populationDensity[id] && Number(populationDensity[id].density)) || 0,
      }));

    if (rows.length === 0) {
      return res.status(502).json({ error: "No rows to generate; temperature data missing for all barangays." });
    }

    const csv = runPipelineReport(rows);
    const now = await setPipelineReport(cityId, csv);

    return res.status(200).json({
      ok: true,
      updatedAt: now,
      rows: rows.length,
      hint: "Download via GET /api/heat/davao/pipeline-report.",
    });
  } catch (err) {
    console.error("Pipeline report generate error:", err);
    return res.status(500).json({ error: "Failed to generate pipeline report", detail: err?.message });
  }
});

/**
 * POST /api/heat/:cityId/pipeline-report
 * Upload the latest pipeline heat-risk report CSV (e.g. from ai/run_pipeline.cmd).
 * Body: raw CSV. If PIPELINE_REPORT_WRITER_KEY is set, require header x-pipeline-report-key.
 * Report is stored in Postgres and served by GET for frontend download.
 */
router.post(
  "/heat/:cityId/pipeline-report",
  express.raw({ type: ["text/csv", "text/plain"], limit: "2mb" }),
  async (req, res) => {
    const cityId = (req.params.cityId || "").toLowerCase();
    if (cityId !== "davao") {
      return res.status(404).json({ error: "City not supported", cityId });
    }
    const writerKey = process.env.PIPELINE_REPORT_WRITER_KEY;
    if (writerKey && req.get("x-pipeline-report-key") !== writerKey) {
      return res.status(401).json({ error: "Unauthorized", hint: "Set x-pipeline-report-key to PIPELINE_REPORT_WRITER_KEY." });
    }
    const body = req.body;
    const csv = Buffer.isBuffer(body) ? body.toString("utf8") : (body || "");
    if (!csv.trim()) {
      return res.status(400).json({ error: "Empty body", hint: "POST CSV with Content-Type: text/csv." });
    }
    try {
      const now = await setPipelineReport(cityId, csv);
      return res.status(201).json({
        ok: true,
        updatedAt: now,
        hint: "Users can download via GET /api/heat/davao/pipeline-report.",
      });
    } catch (err) {
      console.error("Pipeline report upload error:", err);
      return res.status(500).json({ error: "Failed to store pipeline report" });
    }
  }
);

/**
 * GET /api/heat/:cityId/barangay-temperatures
 * Barangay heat temps only (used for heat risk): { temperatures: { [barangayId]: temp_c }, min, max }.
 * WeatherAPI per-barangay by lat,lon: air temp (temp_c) for validated Rothfusz+PAGASA path when humidity is used. Optional ?limit=N.
 */
router.get("/heat/:cityId/barangay-temperatures", async (req, res) => {
  const cityId = (req.params.cityId || "").toLowerCase();
  if (cityId !== "davao") {
    return res.status(404).json({ error: "City not supported", cityId });
  }

  const limitRaw = req.query.limit;
  const parsed = Number.parseInt(String(limitRaw ?? ""), 10);
  const limit =
    limitRaw == null || limitRaw === "" || Number.isNaN(parsed) || parsed <= 0
      ? null
      : Math.min(500, parsed);

  const weatherApiKey = process.env.WEATHER_API_KEY;
  if (!weatherApiKey) {
    return res.status(503).json({
      error: "Weather API not configured",
      hint: "Set WEATHER_API_KEY for barangay temperatures and heat risk (https://www.weatherapi.com/my/)",
    });
  }

  try {
    const data = await fetchBarangayTempsWeatherAPI(weatherApiKey, limit);
    return res.json({
      temperatures: data.temperatures,
      min: data.min,
      max: data.max,
      meta: {
        uniqueLocations: data.uniqueLocations,
        perBarangay: data.perBarangay,
        uhiMaxC: data.uhiMaxC,
        autoSpreadApplied: data.autoSpreadApplied,
      },
    });
  } catch (err) {
    const status = err?.status || 500;
    return res.status(status).json({ error: err?.message || "Failed to fetch temperature data" });
  }
});

/**
 * GET /api/heat/:cityId/average
 * City average heat only: single temperature for Davao center (WeatherAPI).
 */
router.get("/heat/:cityId/average", async (req, res) => {
  const cityId = (req.params.cityId || "").toLowerCase();
  if (cityId !== "davao") {
    return res.status(404).json({ error: "City not supported", cityId });
  }

  const weatherApiKey = process.env.WEATHER_API_KEY;
  if (!weatherApiKey) {
    return res.status(503).json({
      error: "City average requires WeatherAPI",
      hint: "Set WEATHER_API_KEY (https://www.weatherapi.com/my/)",
    });
  }

  try {
    const temp_c = await fetchAverageTempOnly(weatherApiKey);
    if (temp_c == null) {
      return res.status(502).json({ error: "Failed to fetch city average from WeatherAPI" });
    }
    return res.json({
      cityId,
      temp_c,
      source: "weatherapi",
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    const status = err?.status || 500;
    return res.status(status).json({ error: err?.message || "Failed to fetch city average" });
  }
});

/**
 * GET /api/heat/:cityId/temp-vs-feelslike
 * One WeatherAPI call for city center: returns air temp, feels-like, and their difference (for comparison).
 */
router.get("/heat/:cityId/temp-vs-feelslike", async (req, res) => {
  const cityId = (req.params.cityId || "").toLowerCase();
  if (cityId !== "davao") {
    return res.status(404).json({ error: "City not supported", cityId });
  }
  const weatherApiKey = process.env.WEATHER_API_KEY;
  if (!weatherApiKey) {
    return res.status(503).json({
      error: "WeatherAPI not configured",
      hint: "Set WEATHER_API_KEY (https://www.weatherapi.com/my/)",
    });
  }
  try {
    const weather = await getWeatherWeatherAPI(weatherApiKey, DAVAO_CENTER);
    if (!weather || typeof weather.temp_c !== "number") {
      return res.status(502).json({ error: "Failed to fetch current weather from WeatherAPI" });
    }
    const temp_c = Math.round(weather.temp_c * 10) / 10;
    const feelslike_c =
      typeof weather.feelslike_c === "number"
        ? Math.round(weather.feelslike_c * 10) / 10
        : null;
    const difference_c =
      feelslike_c != null ? Math.round((feelslike_c - temp_c) * 10) / 10 : null;
    return res.json({
      cityId,
      location: DAVAO_CENTER,
      temp_c,
      feelslike_c,
      difference_c,
      note:
        "temp_c = air temperature. feelslike_c = perceived (humidity/wind). Heat routes use feelslike when available.",
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Failed to fetch weather" });
  }
});

/**
 * GET /api/heat/:cityId/forecast
 * Returns 7- or 14-day forecast (historical trend) from WeatherAPI for the city center.
 * Query: ?days=7 (default) or ?days=14.
 * Requires WEATHER_API_KEY.
 */
router.get("/heat/:cityId/forecast", async (req, res) => {
  const cityId = (req.params.cityId || "").toLowerCase();
  if (cityId !== "davao") {
    return res.status(404).json({ error: "City not supported", cityId });
  }

  const weatherApiKey = process.env.WEATHER_API_KEY;
  if (!weatherApiKey) {
    return res.status(503).json({
      error: "Forecast requires WeatherAPI",
      hint: "Set WEATHER_API_KEY (https://www.weatherapi.com/my/)",
    });
  }

  const daysParam = req.query.days;
  const days = daysParam === "14" ? 14 : 7;
  const cacheKey = days === 14 ? CACHE_KEY_FORECAST_14 : CACHE_KEY_FORECAST_7;

  try {
    const now = Date.now();
    const cached = weatherCache.get(cacheKey);
    if (cached && now - cached.ts < CACHE_TTL_MS) {
      return res.json(cached.response);
    }

    const data = await getWeatherForecast(weatherApiKey, DAVAO_CENTER, days);
    if (!data) {
      return res.status(502).json({ error: "Failed to fetch forecast from WeatherAPI" });
    }

    const forecastDayCount = data.forecastDay?.length ?? 0;
    const response = {
      cityId,
      days,
      forecastDayCount,
      location: data.location,
      forecastDay: data.forecastDay,
      updatedAt: new Date().toISOString(),
    };
    weatherCache.set(cacheKey, { response, ts: now });
    return res.json(response);
  } catch (err) {
    console.error("Forecast API error:", err);
    return res.status(500).json({ error: "Failed to fetch forecast" });
  }
});

/**
 * GET /api/heat/:cityId/barangay-heat-risk
 * Returns barangay temperatures (WeatherAPI per lat,lon) plus heuristic heat-risk assessment.
 */
router.get("/heat/:cityId/barangay-heat-risk", async (req, res) => {
  const cityId = (req.params.cityId || "").toLowerCase();
  if (cityId !== "davao") {
    return res.status(404).json({ error: "City not supported", cityId });
  }

  const limitRaw = req.query.limit;
  const parsed = Number.parseInt(String(limitRaw ?? ""), 10);
  const limit =
    limitRaw == null || limitRaw === "" || Number.isNaN(parsed) || parsed <= 0
      ? null
      : Math.min(500, parsed);

  const weatherApiKey = process.env.WEATHER_API_KEY;
  if (!weatherApiKey) {
    return res.status(503).json({
      error: "Heat risk requires WeatherAPI",
      hint: "Set WEATHER_API_KEY (https://www.weatherapi.com/my/)",
    });
  }

  try {
    const tempsData = await fetchBarangayTempsWeatherAPI(weatherApiKey, limit);
    const values = Object.values(tempsData.temperatures);
    tempsData.averageTemp = values.length ? values.reduce((a, b) => a + b, 0) / values.length : undefined;

    let populationDensityByBarangay = {};
    try {
      populationDensityByBarangay = await getPopulationDensityByBarangayId();
    } catch (err) {
      console.warn("Population/density data not loaded, heat risk will not include urban density:", err?.message);
    }
    const assessment = assessBarangayHeatRisk(tempsData.temperatures, {
      averageTemp: tempsData.averageTemp,
      humidityByBarangay: tempsData.humidityByBarangay,
      populationDensityByBarangay,
    });

    return res.json({
      temperatures: tempsData.temperatures,
      averageTemp: assessment.averageTemp,
      risks: assessment.risks,
      minRisk: assessment.minScore,
      maxRisk: assessment.maxScore,
      counts: assessment.counts,
      legend: assessment.legend,
      basis: assessment.basis,
      usedHeatIndex: assessment.usedHeatIndex,
      updatedAt: new Date().toISOString(),
      meta: {
        cityId,
        temperaturesSource: "weatherapi",
        averageSource: "weatherapi",
        perBarangay: PER_BARANGAY,
        uhiMaxC: UHI_MAX_C,
        autoSpreadApplied: tempsData.autoSpreadApplied,
      },
    });
  } catch (err) {
    console.error("Heat risk API error:", err);
    return res.status(500).json({ error: "Failed to assess heat risk" });
  }
});

/**
 * WeatherAPI per-barangay: fetch by lat,lon for each centroid. Used for heat risk.
 * Uses air temperature (temp_c) for validated path: with humidity → NOAA Rothfusz heat index → PAGASA.
 * WeatherAPI supports q="lat,lon" (https://www.weatherapi.com/docs/). Cached by location (10 min).
 */
async function fetchBarangayTempsWeatherAPI(apiKey, limit = null) {
  const geo = await getDavaoBarangayGeo();
  const listAll = getBarangayCentroids(geo);
  const effectiveLimit =
    limit != null && Number.isFinite(limit) ? Math.max(0, Math.min(500, limit)) : null;
  const list = effectiveLimit == null ? listAll : listAll.slice(0, effectiveLimit);

  const now = Date.now();
  for (const [key, entry] of weatherCache.entries()) {
    if (key !== CACHE_KEY_AVG && now - entry.ts > CACHE_TTL_MS) weatherCache.delete(key);
  }

  const items = [];
  const keyToBarangayIds = new Map();
  if (PER_BARANGAY) {
    for (const { barangayId, lat, lng } of list) {
      const key = `b:${barangayId}`;
      items.push({ key, lat, lng });
      keyToBarangayIds.set(key, [barangayId]);
    }
  } else {
    for (const { barangayId, lat, lng } of list) {
      const key = cacheKey(lat, lng);
      if (!keyToBarangayIds.has(key)) {
        keyToBarangayIds.set(key, []);
        items.push({ key, lat, lng });
      }
      keyToBarangayIds.get(key).push(barangayId);
    }
  }

  const weatherByKey = await runWithConcurrency(items, async (item) => {
    const cached = weatherCache.get(item.key);
    if (cached && now - cached.ts < CACHE_TTL_MS) {
      return { temp_c: cached.temp_c, humidity: cached.humidity };
    }
    const q = `${item.lat},${item.lng}`;
    const weather = await getWeatherWeatherAPI(apiKey, q);
    const temp_c =
      weather && typeof weather.temp_c === "number"
        ? Math.round(weather.temp_c * 10) / 10
        : null;
    const humidity =
      weather && typeof weather.humidity === "number" && weather.humidity >= 0 && weather.humidity <= 100
        ? weather.humidity
        : undefined;
    if (temp_c != null) {
      weatherCache.set(item.key, { temp_c, humidity, ts: now });
    }
    return temp_c != null ? { temp_c, humidity } : null;
  });

  const temperatures = {};
  const humidityByBarangay = {};
  for (const [key, ids] of keyToBarangayIds) {
    const w = weatherByKey.get(key);
    if (w != null && typeof w.temp_c === "number") {
      for (const id of ids) {
        temperatures[String(id)] = w.temp_c;
        if (typeof w.humidity === "number") humidityByBarangay[String(id)] = w.humidity;
      }
    }
  }

  const barIds = Object.keys(temperatures);
  const valuesPreUhi = barIds.map((id) => temperatures[id]);
  const allSame =
    valuesPreUhi.length > 1 &&
    valuesPreUhi.every((v) => v === valuesPreUhi[0]);

  if (barIds.length > 0) {
    let densityByBarangay = {};
    try {
      densityByBarangay = await getPopulationDensityByBarangayId();
    } catch (_) {}
    const byDensity = [...barIds].sort(
      (a, b) => (densityByBarangay[a]?.density ?? 0) - (densityByBarangay[b]?.density ?? 0)
    );
    const n = byDensity.length;
    const spreadCap =
      UHI_MAX_C > 0 ? UHI_MAX_C : allSame ? 1 : 0;
    if (spreadCap > 0 && n > 0) {
      for (let i = 0; i < n; i++) {
        const id = byDensity[i];
        const pct = n <= 1 ? 0 : (i / Math.max(1, n - 1)) * 100;
        const delta = (pct / 100) * spreadCap;
        const t = temperatures[id];
        if (typeof t === "number") {
          temperatures[id] = Math.round((t + delta) * 10) / 10;
        }
      }
    }
  }

  const values = Object.values(temperatures);
  const min = values.length ? Math.min(...values) : undefined;
  const max = values.length ? Math.max(...values) : undefined;
  return {
    temperatures,
    min,
    max,
    humidityByBarangay: Object.keys(humidityByBarangay).length ? humidityByBarangay : undefined,
    uniqueLocations: items.length,
    perBarangay: PER_BARANGAY,
    uhiMaxC: UHI_MAX_C,
    autoSpreadApplied: allSame && UHI_MAX_C === 0 && barIds.length > 1,
  };
}

/** City average: air temperature for Davao center (for delta_c and validated path consistency). */
async function fetchAverageTempOnly(apiKey) {
  const now = Date.now();
  let temp = null;
  const cached = weatherCache.get(CACHE_KEY_AVG);
  if (cached && now - cached.ts < CACHE_TTL_MS) {
    temp = cached.temp_c;
  } else {
    const weather = await getWeatherWeatherAPI(apiKey, DAVAO_CENTER);
    temp =
      weather && typeof weather.temp_c === "number"
        ? Math.round(weather.temp_c * 10) / 10
        : null;
    if (temp != null) weatherCache.set(CACHE_KEY_AVG, { temp_c: temp, ts: now });
  }
  return temp;
}

export default router;

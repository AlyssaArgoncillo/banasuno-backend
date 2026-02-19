/**
 * Heat / barangay temperatures API.
 * - Meteosource (METEOSOURCE_API_KEY): required for different heat temps per barangay. Fetches per-barangay temp by centroid; heat-risk varies by barangay.
 * - WeatherAPI only (WEATHER_API_KEY, no Meteosource): fallback—single city average applied to all barangays; same temp and risk for every barangay.
 */

import { Router } from "express";
import {
  getCurrentWeather as getWeatherWeatherAPI,
  getForecast as getWeatherForecast,
} from "../services/weatherService.js";
import { getCurrentWeather as getWeatherMeteosource } from "../services/meteosourceService.js";
import { getDavaoBarangayGeo, getBarangayCentroids } from "../lib/barangays.js";
import { assessBarangayHeatRisk } from "../services/heatRiskModel.js";

/** Davao City center for WeatherAPI average temp (lat, lon) */
const DAVAO_CENTER = "7.1907,125.4553";

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const CACHE_KEY_AVG = "davao_avg";
const CACHE_KEY_FORECAST_7 = "davao_forecast_7";
const CACHE_KEY_FORECAST_14 = "davao_forecast_14";
const CONCURRENCY = 5;

const router = Router();

/** Cache: "lat,lng" (2 decimals) -> { temp_c, ts } for Meteosource; CACHE_KEY_AVG -> { temp_c, ts } for WeatherAPI */
const weatherCache = new Map();

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function cacheKey(lat, lng) {
  return `${Number(lat).toFixed(2)},${Number(lng).toFixed(2)}`;
}

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
 * GET /api/heat/:cityId/barangay-temperatures
 * Returns { temperatures: { [barangayId]: temp_c }, min, max, averageTemp? }.
 * For different temps per barangay, use Meteosource (METEOSOURCE_API_KEY). WeatherAPI-only: one city average for all.
 */
router.get("/heat/:cityId/barangay-temperatures", async (req, res) => {
  const cityId = (req.params.cityId || "").toLowerCase();
  if (cityId !== "davao") {
    return res.status(404).json({ error: "City not supported", cityId });
  }

  const meteosourceKey = process.env.METEOSOURCE_API_KEY;
  const weatherApiKey = process.env.WEATHER_API_KEY;
  const useMeteosource = Boolean(meteosourceKey);

  try {
    if (useMeteosource) {
      const data = await fetchBarangaySpecificTemps(meteosourceKey, null);
      let averageTemp;
      if (weatherApiKey) {
        const avg = await fetchAverageTempOnly(weatherApiKey);
        if (typeof avg === "number") averageTemp = Math.round(avg * 10) / 10;
      }
      return res.json({ ...data, ...(averageTemp != null ? { averageTemp } : {}) });
    }
    if (weatherApiKey) {
      const data = await fetchAverageTemps(weatherApiKey);
      return res.json(data);
    }
    return res.status(503).json({
      error: "Weather API not configured",
      hint: "Set METEOSOURCE_API_KEY for different heat temps per barangay (recommended), or WEATHER_API_KEY for one city average for all (https://www.meteosource.com/client, https://www.weatherapi.com/my/)",
    });
  } catch (err) {
    const status = err?.status || 500;
    return res.status(status).json({ error: err?.message || "Failed to fetch temperature data" });
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
 * Returns barangay temperatures plus heuristic heat-risk assessment.
 * For different heat temps per barangay, use Meteosource (METEOSOURCE_API_KEY). WeatherAPI-only: city average for all, uniform risk.
 */
router.get("/heat/:cityId/barangay-heat-risk", async (req, res) => {
  const cityId = (req.params.cityId || "").toLowerCase();
  if (cityId !== "davao") {
    return res.status(404).json({ error: "City not supported", cityId });
  }

  // Optional cap on barangay count (Meteosource only): for initial testing; limit ignored when using WeatherAPI-only.
  const limitRaw = req.query.limit;
  const parsed = Number.parseInt(String(limitRaw ?? ""), 10);
  const limit =
    limitRaw == null || limitRaw === "" || Number.isNaN(parsed)
      ? null
      : Math.max(0, Math.min(500, parsed));

  const meteosourceKey = process.env.METEOSOURCE_API_KEY;
  const weatherApiKey = process.env.WEATHER_API_KEY;

  try {
    let tempsData;
    let temperaturesSource;
    let averageSource;

    if (meteosourceKey) {
      tempsData = await fetchBarangaySpecificTemps(meteosourceKey, limit);
      temperaturesSource = "meteosource";
      if (weatherApiKey) {
        const avg = await fetchAverageTempOnly(weatherApiKey);
        if (typeof avg === "number") tempsData.averageTemp = avg;
      }
      averageSource = weatherApiKey ? "weatherapi" : "computed";
    } else if (weatherApiKey) {
      // WeatherAPI only: city average applied to all barangays; full barangay list, uniform risk.
      tempsData = await fetchAverageTemps(weatherApiKey);
      temperaturesSource = "weatherapi";
      averageSource = "weatherapi";
    } else {
      return res.status(503).json({
        error: "Heat risk requires a weather API",
        hint: "Set METEOSOURCE_API_KEY for different heat temps per barangay (recommended), or WEATHER_API_KEY for city average for all (https://www.meteosource.com/client, https://www.weatherapi.com/my/)",
      });
    }

    const assessment = assessBarangayHeatRisk(tempsData.temperatures, {
      averageTemp: tempsData.averageTemp,
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
      updatedAt: new Date().toISOString(),
      meta: {
        cityId,
        temperaturesSource,
        averageSource,
      },
    });
  } catch (err) {
    console.error("Heat risk API error:", err);
    return res.status(500).json({ error: "Failed to assess heat risk" });
  }
});

/** Barangay-specific: Meteosource per centroid, cached and throttled. limit=null means all. Max 500 when limit set (initial testing; change for official deployment if needed). */
async function fetchBarangaySpecificTemps(apiKey, limit = null) {
  try {
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

    for (const { barangayId, lat, lng } of list) {
      const key = cacheKey(lat, lng);
      if (!keyToBarangayIds.has(key)) {
        keyToBarangayIds.set(key, []);
        items.push({ key, lat, lng });
      }
      keyToBarangayIds.get(key).push(barangayId);
    }

    const tempByKey = await runWithConcurrency(items, async (item) => {
      const cached = weatherCache.get(item.key);
      if (cached && now - cached.ts < CACHE_TTL_MS) return cached.temp_c;
      const weather = await getWeatherMeteosource(apiKey, item.lat, item.lng);
      const temp = weather && typeof weather.temp_c === "number"
        ? Math.round(weather.temp_c * 10) / 10
        : null;
      if (temp != null) weatherCache.set(item.key, { temp_c: temp, ts: now });
      return temp;
    });

    const temperatures = {};
    for (const [key, ids] of keyToBarangayIds) {
      const temp = tempByKey.get(key);
      if (temp != null) {
        for (const id of ids) temperatures[String(id)] = temp;
      }
    }
    const values = Object.values(temperatures);
    const min = values.length ? Math.min(...values) : undefined;
    const max = values.length ? Math.max(...values) : undefined;
    return { temperatures, min, max };
  } catch (err) {
    console.error("Heat API error:", err);
    throw err;
  }
}

/** Average temp: WeatherAPI single call for Davao center, applied to all barangays. Returns averageTemp when available. */
async function fetchAverageTemps(apiKey) {
  try {
    const temp = await fetchAverageTempOnly(apiKey);

    const geo = await getDavaoBarangayGeo();
    const list = getBarangayCentroids(geo);
    const temperatures = {};
    if (temp != null) {
      for (const { barangayId } of list) {
        temperatures[barangayId] = temp;
      }
    }
    const values = Object.values(temperatures);
    const min = values.length ? Math.min(...values) : undefined;
    const max = values.length ? Math.max(...values) : undefined;
    const averageTemp = temp != null ? Math.round(temp * 10) / 10 : undefined;
    return { temperatures, min, max, averageTemp };
  } catch (err) {
    console.error("Heat API error:", err);
    throw err;
  }
}

async function fetchAverageTempOnly(apiKey) {
  const now = Date.now();
  let temp = null;
  const cached = weatherCache.get(CACHE_KEY_AVG);
  if (cached && now - cached.ts < CACHE_TTL_MS) {
    temp = cached.temp_c;
  } else {
    const weather = await getWeatherWeatherAPI(apiKey, DAVAO_CENTER);
    temp = weather && typeof weather.temp_c === "number"
      ? Math.round(weather.temp_c * 10) / 10
      : null;
    if (temp != null) weatherCache.set(CACHE_KEY_AVG, { temp_c: temp, ts: now });
  }
  return temp;
}

export default router;

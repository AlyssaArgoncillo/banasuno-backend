/**
 * Heat Advisory AI route: per-barangay advisories from weather + PAGASA + Gemini/fallback.
 * Also: POST/GET /api/heat-advisory for frontend Heat Advisory UI (tagline + advices).
 */

import { Router } from "express";
import { getDavaoBarangayGeo, getBarangayCentroids, getBarangayNameById } from "../lib/barangays.js";
import { getCurrentWeather, getOpenMeteoCurrent } from "../services/weatherService.js";
import { assessBarangayHeatRisk, HEAT_LEVELS } from "../services/heatRiskModel.js";
import { getHeatAdvisories, getHeatAdvisoryForFrontend } from "../services/advisoryAI.js";
import { getFallbackAdvisoryForFrontend } from "../services/fallbackAdvisories.js";

const router = Router();
const OPEN_METEO_TIMEZONE = process.env.HEAT_OPEN_METEO_TIMEZONE || "Asia/Singapore";

/** In-memory cache for frontend advisory: key (barangayId|'default', riskLevel) → { payload, expiresAt }. Longer TTL = fewer Gemini calls. */
const ADVISORY_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const advisoryCache = new Map();

/** Not Hazardous tagline – used to detect stale cache that has wrong content for level 2–5 (from before fallback fix). */
const NOT_HAZARDOUS_TAGLINE = "Conditions are comfortable. Stay hydrated and dress for the weather.";

function getCachedAdvisory(barangayId, riskLevel) {
  const key = `${barangayId || "default"}:${riskLevel}`;
  const entry = advisoryCache.get(key);
  if (!entry || Date.now() > entry.expiresAt) return null;
  const payload = entry.payload;
  // If cache has Not Hazardous tagline but request is for a different level, treat as stale (wrong content from old bug)
  if (riskLevel !== 1 && payload && payload.tagline === NOT_HAZARDOUS_TAGLINE) {
    advisoryCache.delete(key);
    return null;
  }
  return payload;
}

function setCachedAdvisory(barangayId, riskLevel, payload) {
  const key = `${barangayId || "default"}:${riskLevel}`;
  advisoryCache.set(key, { payload, expiresAt: Date.now() + ADVISORY_CACHE_TTL_MS });
}

function normalizeRiskLevelAndLabel(riskLevel, riskLabel) {
  const levelNum = riskLevel != null ? Number(riskLevel) : NaN;
  const labelStr = riskLabel != null ? String(riskLabel).trim() : "";
  const byLevel = HEAT_LEVELS.find((r) => r.level === levelNum);
  const byLabel = HEAT_LEVELS.find((r) => r.label === labelStr);
  if (byLevel) return { riskLevel: byLevel.level, riskLabel: byLevel.label };
  if (byLabel) return { riskLevel: byLabel.level, riskLabel: byLabel.label };
  return { riskLevel: 2, riskLabel: "Caution" };
}

/** When there is no barangay selection, avoid defaulting to level 1 (Not Hazardous) so a generic "initial" request does not overwrite a correct advisory. */
function effectiveRiskForRequest(barangayId, riskLevel, riskLabel) {
  const normalized = normalizeRiskLevelAndLabel(riskLevel, riskLabel);
  const hasBarangay = String(barangayId || "").trim().length > 0;
  if (!hasBarangay && normalized.riskLevel === 1) {
    return { riskLevel: 2, riskLabel: "Caution" };
  }
  return normalized;
}

/**
 * GET /by-barangay/:id
 * Returns heat risk details and three advisories (Gemini AI or fallback).
 */
router.get("/by-barangay/:id", async (req, res) => {
  const barangayId = req.params.id?.trim();
  if (!barangayId) {
    return res.status(400).json({ error: "Barangay ID is required" });
  }

  try {
    const geo = await getDavaoBarangayGeo();
    const centroids = getBarangayCentroids(geo);
    const centroid = centroids.find((c) => c.barangayId === barangayId);

    if (!centroid) {
      return res.status(404).json({
        error: "Barangay not found",
        barangayId,
        hint: "Use a Davao barangay ID (e.g. PSGC 1130700001)",
      });
    }

    const barangayName = getBarangayNameById(geo, barangayId);

    // 1) Fetch temperature and humidity
    const weatherApiKey = process.env.WEATHER_API_KEY?.trim();
    let temp_c = null;
    let humidity = undefined;

    if (weatherApiKey) {
      const q = `${centroid.lat},${centroid.lng}`;
      const weather = await getCurrentWeather(weatherApiKey, q);
      if (weather && typeof weather.temp_c === "number") {
        temp_c = weather.temp_c;
        humidity = weather.humidity;
      }
    }

    if (temp_c == null) {
      const openMeteo = await getOpenMeteoCurrent(centroid.lat, centroid.lng, OPEN_METEO_TIMEZONE);
      if (openMeteo && typeof openMeteo.temp_c === "number") {
        temp_c = openMeteo.temp_c;
        humidity = openMeteo.humidity;
      }
    }

    if (temp_c == null) {
      return res.status(502).json({
        error: "Could not fetch weather data",
        barangayId,
        hint: "Set WEATHER_API_KEY or ensure Open-Meteo is reachable",
      });
    }

    // 2) Compute Rothfusz heat index and PAGASA category
    const temperatures = { [barangayId]: temp_c };
    const humidityByBarangay = typeof humidity === "number" ? { [barangayId]: humidity } : {};
    const assessment = assessBarangayHeatRisk(temperatures, { humidityByBarangay });
    const risk = assessment.risks[barangayId];

    if (!risk) {
      return res.status(500).json({
        error: "Heat risk computation failed",
        barangayId,
      });
    }

    const heatIndexC = risk.heat_index_c ?? risk.temp_c;

    // 3) Get three advisories (Gemini or fallback)
    const { advisories, source, fallbackUsed } = await getHeatAdvisories(
      barangayName,
      heatIndexC,
      risk.label
    );

    return res.json({
      barangayId,
      risk: {
        temperature_c: risk.temp_c,
        heat_index_c: risk.heat_index_c ?? null,
        level: risk.level,
        label: risk.label,
        score: risk.score,
      },
      advisories,
      metadata: {
        source,
        fallbackUsed,
      },
    });
  } catch (err) {
    console.error("Heat advisory error:", err);
    return res.status(500).json({
      error: "Failed to generate heat advisory",
      details: err?.message,
    });
  }
});

/**
 * POST /api/heat-advisory
 * Body: { barangay_id?, barangay_name?, risk_level?, risk_label?, temperature_c? }
 * Returns: { tagline, advices: [{ title, body }] } for Heat Advisory UI (Gemini or fallback).
 */
router.post("/", async (req, res) => {
  try {
    const body = req.body || {};
    const barangayId = (body.barangay_id ?? body.barangayId) != null ? String(body.barangay_id ?? body.barangayId).trim() : "";
    const barangayName = (body.barangay_name ?? body.barangayName) != null ? String(body.barangay_name ?? body.barangayName).trim() : "";
    const tempC = (body.temperature_c ?? body.temperatureC) != null ? Number(body.temperature_c ?? body.temperatureC) : undefined;
    const riskLevelParam = body.risk_level ?? body.riskLevel;
    const riskLabelParam = body.risk_label ?? body.riskLabel;
    const { riskLevel, riskLabel } = effectiveRiskForRequest(barangayId, riskLevelParam, riskLabelParam);

    const cacheKey = barangayId || "default";
    const cached = getCachedAdvisory(cacheKey, riskLevel);
    if (cached) {
      return res.json(cached);
    }

    let result = await getHeatAdvisoryForFrontend({
      barangayId,
      barangayName: barangayName || undefined,
      riskLevel,
      riskLabel,
      temperatureC: Number.isFinite(tempC) ? tempC : undefined,
    });

    // Safety: if we requested level 2–5 but got Not Hazardous content, force correct fallback by level
    if (riskLevel !== 1 && result && result.tagline === NOT_HAZARDOUS_TAGLINE) {
      result = getFallbackAdvisoryForFrontend(riskLabel, riskLevel);
    }

    const payload = {
      tagline: result.tagline,
      advices: result.advices,
      risk_level: riskLevel,
      risk_label: riskLabel,
      barangay_name: barangayName || null,
      generated_at: new Date().toISOString(),
    };
    setCachedAdvisory(cacheKey, riskLevel, payload);
    return res.json(payload);
  } catch (err) {
    console.error("Heat advisory (POST) error:", err);
    return res.status(500).json({
      error: "Failed to generate heat advisory",
      details: err?.message,
    });
  }
});

/**
 * GET /api/heat-advisory?barangay_id=...&barangay_name=...&risk_level=...&risk_label=...&temperature_c=...
 * Same response as POST (tagline + advices). Query params optional.
 */
router.get("/", async (req, res) => {
  try {
    const q = req.query || {};
    const barangayId = (q.barangay_id ?? q.barangayId) != null ? String(q.barangay_id ?? q.barangayId).trim() : "";
    const barangayName = (q.barangay_name ?? q.barangayName) != null ? String(q.barangay_name ?? q.barangayName).trim() : "";
    const tempC = (q.temperature_c ?? q.temperatureC) != null ? Number(q.temperature_c ?? q.temperatureC) : undefined;
    const riskLevelParam = q.risk_level ?? q.riskLevel;
    const riskLabelParam = q.risk_label ?? q.riskLabel;
    const { riskLevel, riskLabel } = effectiveRiskForRequest(barangayId, riskLevelParam, riskLabelParam);

    const cacheKey = barangayId || "default";
    const cached = getCachedAdvisory(cacheKey, riskLevel);
    if (cached) {
      return res.json(cached);
    }

    let result = await getHeatAdvisoryForFrontend({
      barangayId,
      barangayName: barangayName || undefined,
      riskLevel,
      riskLabel,
      temperatureC: Number.isFinite(tempC) ? tempC : undefined,
    });

    // Safety: if we requested level 2–5 but got Not Hazardous content, force correct fallback by level
    if (riskLevel !== 1 && result && result.tagline === NOT_HAZARDOUS_TAGLINE) {
      result = getFallbackAdvisoryForFrontend(riskLabel, riskLevel);
    }

    const payload = {
      tagline: result.tagline,
      advices: result.advices,
      risk_level: riskLevel,
      risk_label: riskLabel,
      barangay_name: barangayName || null,
      generated_at: new Date().toISOString(),
    };
    setCachedAdvisory(cacheKey, riskLevel, payload);
    return res.json(payload);
  } catch (err) {
    console.error("Heat advisory (GET) error:", err);
    return res.status(500).json({
      error: "Failed to generate heat advisory",
      details: err?.message,
    });
  }
});

export default router;

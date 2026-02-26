/**
 * Heat Advisory AI route: per-barangay advisories from weather + PAGASA + Gemini/fallback.
 */

import { Router } from "express";
import { getDavaoBarangayGeo, getBarangayCentroids, getBarangayNameById } from "../lib/barangays.js";
import { getCurrentWeather, getOpenMeteoCurrent } from "../services/weatherService.js";
import { assessBarangayHeatRisk } from "../services/heatRiskModel.js";
import { getHeatAdvisories } from "../services/advisoryAI.js";

const router = Router();
const OPEN_METEO_TIMEZONE = process.env.HEAT_OPEN_METEO_TIMEZONE || "Asia/Singapore";

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

export default router;

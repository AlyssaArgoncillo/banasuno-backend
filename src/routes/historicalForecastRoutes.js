/**
 * Backend routes for fetching WeatherAPI historical weather and persisting in Supabase.
 * Table: historical_forecasts. Uses history.json (past data only), not forecast.
 */

import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { getHistory } from "../services/weatherService.js";
import { getDavaoBarangayGeo, getBarangayCentroids } from "../lib/barangays.js";

const router = Router();

/**
 * Resolve barangay ID to "lat,lon" for WeatherAPI.
 * @param {string} barangayId - e.g. 1130700001
 * @returns {Promise<string | null>} "lat,lon" or null if barangay not found
 */
async function resolveBarangayToLocation(barangayId) {
  const id = String(barangayId ?? "").trim();
  if (!id) return null;
  const geo = await getDavaoBarangayGeo();
  const centroids = getBarangayCentroids(geo);
  const centroid = centroids.find((c) => c.barangayId === id);
  if (!centroid) return null;
  return `${centroid.lat},${centroid.lng}`;
}

/**
 * Format date as YYYY-MM-DD for a given Date.
 * @param {Date} d
 * @returns {string}
 */
function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Save historical day rows into Supabase.
 * Table: historical_forecasts
 * Columns: barangay_id, date, maxtemp_c, mintemp_c, avgtemp_c, condition, precip_mm
 */
async function saveHistoryToSupabase(barangayId, rows) {
  if (!supabase) {
    console.warn("[historicalForecast] Supabase not configured; skipping save.");
    return;
  }
  if (rows.length === 0) return;
  const { error } = await supabase.from("historical_forecasts").insert(rows);
  if (error) {
    console.error("[historicalForecast] Supabase insert error:", error);
  }
}

/**
 * GET /api/historical-forecast/by-barangay/:id?days=7|14
 * Fetch past N days from WeatherAPI history API, save to Supabase, return JSON.
 * Uses history.json with dt=YYYY-MM-DD for each date (past days only).
 */
router.get("/by-barangay/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const days = Math.min(14, Math.max(1, Number(req.query.days) || 7));
    const apiKey = process.env.WEATHER_API_KEY?.trim();

    if (!apiKey) {
      return res.status(503).json({
        error: "WEATHER_API_KEY required",
        hint: "Set WEATHER_API_KEY in .env (https://www.weatherapi.com/my/)",
      });
    }

    const q = await resolveBarangayToLocation(id);
    if (!q) {
      return res.status(404).json({
        error: "Barangay not found",
        barangayId: id,
        hint: "Use a Davao barangay ID (e.g. PSGC 1130700001)",
      });
    }

    // Past N days from today (yesterday, 2 days ago, ... N days ago)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const history = [];
    let location = null;

    for (let i = 1; i <= days; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = formatDate(d);
      const dayData = await getHistory(apiKey, q, dateStr);
      if (dayData) {
        if (dayData.location) location = dayData.location;
        history.push({
          date: dayData.date,
          maxtemp_c: dayData.maxtemp_c ?? null,
          mintemp_c: dayData.mintemp_c ?? null,
          avgtemp_c: dayData.avgtemp_c ?? null,
          condition: dayData.condition ?? null,
          precip_mm: dayData.totalprecip_mm ?? null,
        });
      }
    }

    // Build rows for Supabase: barangay_id, date, maxtemp_c, mintemp_c, avgtemp_c, condition, precip_mm
    const rows = history.map((h) => ({
      barangay_id: id,
      date: h.date,
      maxtemp_c: h.maxtemp_c,
      mintemp_c: h.mintemp_c,
      avgtemp_c: h.avgtemp_c,
      condition: h.condition,
      precip_mm: h.precip_mm,
    }));

    await saveHistoryToSupabase(id, rows);

    res.json({
      barangayId: id,
      days,
      history,
      location,
    });
  } catch (err) {
    console.error("[historicalForecast] by-barangay error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/historical-forecast/history/:id
 * Query stored historical records from Supabase (historical_forecasts table).
 */
router.get("/history/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!supabase) {
      return res.status(503).json({
        error: "Supabase not configured",
        hint: "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env",
      });
    }

    const { data, error } = await supabase
      .from("historical_forecasts")
      .select("*")
      .eq("barangay_id", id)
      .order("date", { ascending: true });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({
      barangayId: id,
      history: data ?? [],
    });
  } catch (err) {
    console.error("[historicalForecast] history error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

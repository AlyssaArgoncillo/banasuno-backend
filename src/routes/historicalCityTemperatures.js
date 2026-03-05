/**
 * API routes for historical_city_temperatures (mirrors daily city-temperatures).
 * POST upserts into historical_city_temperatures; GET fetches by city_id with optional limit and offset.
 */

import { Router } from "express";
import {
  upsertHistoricalCityTemperature,
  getHistoricalCityTemperaturesForCity,
} from "../services/historicalCityTemperatures.js";

const router = Router();

/**
 * POST /api/historical/city-temperatures
 * Upsert a city-level record. Body: { city_id, avg_temp_c, source?, recorded_at? }
 */
router.post("/", async (req, res) => {
  try {
    const body = req.body ?? {};
    const result = await upsertHistoricalCityTemperature({
      city_id: body.city_id,
      avg_temp_c: body.avg_temp_c,
      source: body.source,
      recorded_at: body.recorded_at,
    });
    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error });
    }
    return res.status(201).json({ ok: true, id: result.id, recorded_at: result.recorded_at });
  } catch (err) {
    console.error("[historical/city-temperatures] POST error:", err);
    return res.status(500).json({ ok: false, error: err?.message ?? "Internal server error" });
  }
});

/**
 * GET /api/historical/city-temperatures?city_id=davao&limit=30&offset=0
 * Fetch records for a city, most recent first.
 */
router.get("/", async (req, res) => {
  try {
    const city_id = (req.query.city_id ?? "davao").toString().trim();
    const limit = parseInt(req.query.limit, 10) || 30;
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const { rows, error } = await getHistoricalCityTemperaturesForCity(city_id, { limit, offset });
    if (error) {
      return res.status(503).json({ ok: false, error });
    }
    return res.json({ city_id, rows });
  } catch (err) {
    console.error("[historical/city-temperatures] GET error:", err);
    return res.status(500).json({ ok: false, error: err?.message ?? "Internal server error" });
  }
});

export default router;

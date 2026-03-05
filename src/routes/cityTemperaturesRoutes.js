/**
 * API routes for city_temperatures (city-level daily readings).
 * Uses src/services/cityTemperatures.js. Schema: id, city_id, avg_temp_c, source, recorded_at, created_at.
 */

import { Router } from "express";
import {
  insertCityTemperature,
  getCityTemperaturesForCity,
  deleteOlderThan7Days,
} from "../services/cityTemperatures.js";

const router = Router();

/**
 * POST /api/city-temperatures/cleanup
 * Run 7-day retention: delete rows where recorded_at < CURRENT_DATE - 7 days.
 */
router.post("/cleanup", async (req, res) => {
  try {
    const result = await deleteOlderThan7Days();
    if (!result.ok) {
      return res.status(503).json({ ok: false, error: result.error });
    }
    return res.json({ ok: true, deleted: result.deleted ?? 0 });
  } catch (err) {
    console.error("[city-temperatures] cleanup error:", err);
    return res.status(500).json({ error: err?.message ?? "Internal server error" });
  }
});

/**
 * POST /api/city-temperatures
 * Insert a city-level record. Body: { city_id, avg_temp_c, source?, recorded_at? }
 */
router.post("/", async (req, res) => {
  try {
    const body = req.body ?? {};
    const result = await insertCityTemperature({
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
    console.error("[city-temperatures] POST error:", err);
    return res.status(500).json({ error: err?.message ?? "Internal server error" });
  }
});

/**
 * GET /api/city-temperatures?city_id=davao&limit=30
 * Fetch rows for a city, most recent first.
 */
router.get("/", async (req, res) => {
  try {
    const city_id = (req.query.city_id ?? "davao").toString().trim();
    const limit = parseInt(req.query.limit, 10) || 30;
    const rows = await getCityTemperaturesForCity(city_id, { limit });
    return res.json({ city_id, rows });
  } catch (err) {
    console.error("[city-temperatures] GET error:", err);
    return res.status(500).json({ error: err?.message ?? "Internal server error" });
  }
});

export default router;

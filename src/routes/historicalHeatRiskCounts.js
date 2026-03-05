/**
 * API routes for historical_heat_risk_counts (mirrors daily heat-risk-counts).
 * POST upserts into historical_heat_risk_counts; GET fetches by city_id with optional limit and offset.
 */

import { Router } from "express";
import {
  upsertHistoricalHeatRisk,
  getHistoricalHeatRiskCountsForCity,
} from "../services/historicalHeatRiskCounts.js";

const router = Router();

/**
 * POST /api/historical/heat-risk-counts
 * Upsert a barangay-level record. Body: { barangay_psgc, city_id?, risk_level, risk_label, heat_index_c?, source?, recorded_at? }
 */
router.post("/", async (req, res) => {
  try {
    const body = req.body ?? {};
    const result = await upsertHistoricalHeatRisk({
      barangay_psgc: body.barangay_psgc,
      city_id: body.city_id,
      risk_level: body.risk_level,
      risk_label: body.risk_label,
      heat_index_c: body.heat_index_c,
      source: body.source,
      recorded_at: body.recorded_at,
    });
    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error });
    }
    return res.status(201).json({ ok: true, id: result.id });
  } catch (err) {
    console.error("[historical/heat-risk-counts] POST error:", err);
    return res.status(500).json({ ok: false, error: err?.message ?? "Internal server error" });
  }
});

/**
 * GET /api/historical/heat-risk-counts?city_id=davao&limit=100&offset=0
 * Fetch records for a city, most recent first.
 */
router.get("/", async (req, res) => {
  try {
    const city_id = (req.query.city_id ?? "davao").toString().trim();
    const limit = parseInt(req.query.limit, 10) || 100;
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const { rows, error } = await getHistoricalHeatRiskCountsForCity(city_id, { limit, offset });
    if (error) {
      return res.status(503).json({ ok: false, error });
    }
    return res.json({ city_id, rows });
  } catch (err) {
    console.error("[historical/heat-risk-counts] GET error:", err);
    return res.status(500).json({ ok: false, error: err?.message ?? "Internal server error" });
  }
});

export default router;

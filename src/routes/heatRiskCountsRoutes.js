/**
 * API routes for heat_risk_counts (barangay-level records).
 * Uses src/services/heatRiskCounts.js. Schema: id, barangay_psgc, city_id, risk_level, risk_label, heat_index_c, source, recorded_at, created_at.
 */

import { Router } from "express";
import {
  insertHeatRisk,
  getHeatRiskCountsForCity,
  deleteOlderThan7Days,
} from "../services/heatRiskCounts.js";

const router = Router();

/**
 * POST /api/heat-risk-counts/cleanup
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
    console.error("[heat-risk-counts] cleanup error:", err);
    return res.status(500).json({ error: err?.message ?? "Internal server error" });
  }
});

/**
 * POST /api/heat-risk-counts
 * Insert a barangay-level record. Body: { barangay_psgc, city_id?, risk_level, risk_label, heat_index_c?, source?, recorded_at? }
 */
router.post("/", async (req, res) => {
  try {
    const body = req.body ?? {};
    const result = await insertHeatRisk({
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
    console.error("[heat-risk-counts] POST error:", err);
    return res.status(500).json({ error: err?.message ?? "Internal server error" });
  }
});

/**
 * GET /api/heat-risk-counts?city_id=davao&limit=100
 * Fetch rows for a city, most recent first.
 */
router.get("/", async (req, res) => {
  try {
    const city_id = (req.query.city_id ?? "davao").toString().trim();
    const limit = parseInt(req.query.limit, 10) || 100;
    const rows = await getHeatRiskCountsForCity(city_id, { limit });
    return res.json({ city_id, rows });
  } catch (err) {
    console.error("[heat-risk-counts] GET error:", err);
    return res.status(500).json({ error: err?.message ?? "Internal server error" });
  }
});

export default router;

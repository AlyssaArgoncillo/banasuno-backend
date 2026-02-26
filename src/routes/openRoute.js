/**
 * OpenRouteService API routes – batch travel times (matrix).
 */

import { Router } from "express";
import { getBatchTravelTimes } from "../services/openRoute.js";

const router = Router();

/**
 * POST /batch-travel-times
 * Body: { locations: [[lng, lat], ...] }
 * Returns OpenRoute matrix result (durations, distances) or 500 with { error, details }.
 */
router.post("/batch-travel-times", async (req, res) => {
  try {
    const { locations } = req.body ?? {};
    const apiKey = process.env.OPEN_ROUTE_API_KEY?.trim();

    if (!apiKey) {
      return res.status(503).json({
        error: "OpenRoute not configured",
        details: "Set OPEN_ROUTE_API_KEY in .env (https://openrouteservice.org/dev/)",
      });
    }

    if (!Array.isArray(locations) || locations.length === 0) {
      return res.status(400).json({
        error: "Invalid request",
        details: "Body must include locations: [[lng, lat], ...]",
      });
    }

    const result = await getBatchTravelTimes(apiKey, locations);
    return res.json(result);
  } catch (err) {
    console.error("OpenRoute batch-travel-times error:", err);
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    return res.status(status).json({
      error: err.message || "OpenRoute request failed",
      details: err.details ?? undefined,
    });
  }
});

export default router;

/**
 * City-level historical temperature trends (historical_trends table).
 * Data from WeatherAPI history.json; 7-day and 14-day rolling averages computed from city_avg_temp_c.
 */

import { Router } from "express";
import {
  getHistoricalTrends,
  fetchAndStoreCityHistoricalTrends,
  deleteOlderThan30Days,
  insertHistoricalTrend,
} from "../services/historicalTrends.js";

const router = Router();

const DEFAULT_CITY_ID = "davao";
const WEATHER_API_CITY_NAME = "Davao";

function csvEscape(val) {
  if (val == null) return "";
  const s = String(val);
  if (/[,"\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * GET /api/historical-trends?city_id=davao&limit=30|&days=7|14&sync=0|1
 * Returns stored historical_trends rows (past data) with 7-day and 14-day rolling averages.
 * Use this for historical trends; do not use GET /api/heat/:cityId/forecast (that is future forecast).
 * Query: city_id, limit (default 30, max 90), days (optional: 7 or 14, overrides limit), sync=1 to fetch from WeatherAPI first.
 */
router.get("/", async (req, res) => {
  try {
    const cityId = (req.query.city_id || DEFAULT_CITY_ID).toString().trim().toLowerCase();
    const daysParam = req.query.days != null ? parseInt(req.query.days, 10) : null;
    const limitFromDays = daysParam === 7 || daysParam === 14 ? daysParam : null;
    const limitFromQuery = Math.min(90, Math.max(1, parseInt(req.query.limit, 10) || 30));
    const limit = limitFromDays != null ? limitFromDays : limitFromQuery;
    const sync = req.query.sync === "1" || req.query.sync === "true";

    if (sync) {
      const apiKey = process.env.WEATHER_API_KEY?.trim();
      if (!apiKey) {
        return res.status(503).json({
          error: "WEATHER_API_KEY required for sync",
          hint: "Set WEATHER_API_KEY in .env (https://www.weatherapi.com/my/)",
        });
      }
      await fetchAndStoreCityHistoricalTrends(apiKey, cityId, WEATHER_API_CITY_NAME, 14);
      const cleanup = await deleteOlderThan30Days();
      if (cleanup.ok && cleanup.deleted > 0) {
        console.log("[historicalTrends] Cleanup: deleted", cleanup.deleted, "rows older than 30 days");
      }
    }

    const result = await getHistoricalTrends(cityId, { limit });
    if (!result) {
      return res.status(503).json({
        error: "Failed to load historical trends",
        hint: "Ensure Supabase is configured and historical_trends table exists.",
      });
    }

    return res.json({
      city_id: cityId,
      rows: result.rows,
      trend_7d_avg_c: result.trend_7d_avg_c ?? null,
      trend_14d_avg_c: result.trend_14d_avg_c ?? null,
      summary: {
        avg_c: result.trend_7d_avg_c ?? (result.rows[0]?.city_avg_temp_c ?? null),
        max_c: result.rows[0]?.city_max_temp_c ?? null,
        min_c: result.rows[0]?.city_min_temp_c ?? null,
        rolling_7d_avg_c: result.trend_7d_avg_c ?? null,
        rolling_14d_avg_c: result.trend_14d_avg_c ?? null,
      },
    });
  } catch (err) {
    console.error("[historicalTrends] GET error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/historical-trends
 * Body: { city_id, recorded_at, city_avg_temp_c, city_max_temp_c?, city_min_temp_c?, source? }
 * Upserts into historical_trends using (city_id, recorded_at) as conflict target.
 */
router.post("/", async (req, res) => {
  try {
    const body = req.body ?? {};
    const result = await insertHistoricalTrend({
      city_id: body.city_id,
      recorded_at: body.recorded_at,
      city_avg_temp_c: body.city_avg_temp_c,
      city_max_temp_c: body.city_max_temp_c,
      city_min_temp_c: body.city_min_temp_c,
      source: body.source,
    });
    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error });
    }
    return res.status(201).json({ ok: true, id: result.id });
  } catch (err) {
    console.error("[historicalTrends] POST error:", err);
    return res.status(500).json({ ok: false, error: err?.message ?? "Internal server error" });
  }
});

/**
 * POST /api/historical-trends/sync
 * Body: { city_id?: "davao", days?: 14 }
 * Fetches last N days from WeatherAPI history.json for the city and upserts into historical_trends, then runs 30-day cleanup.
 */
router.post("/sync", async (req, res) => {
  try {
    const apiKey = process.env.WEATHER_API_KEY?.trim();
    if (!apiKey) {
      return res.status(503).json({
        error: "WEATHER_API_KEY required",
        hint: "Set WEATHER_API_KEY in .env (https://www.weatherapi.com/my/)",
      });
    }
    const cityId = (req.body?.city_id || DEFAULT_CITY_ID).toString().trim().toLowerCase();
    const days = Math.min(30, Math.max(1, parseInt(req.body?.days, 10) || 14));
    const cityName = cityId === "davao" ? WEATHER_API_CITY_NAME : cityId;

    const { inserted, errors } = await fetchAndStoreCityHistoricalTrends(
      apiKey,
      cityId,
      cityName,
      days
    );
    const cleanup = await deleteOlderThan30Days();

    return res.json({
      ok: true,
      city_id: cityId,
      inserted,
      errors: errors.length ? errors : undefined,
      cleanup: cleanup.ok ? { deleted: cleanup.deleted ?? 0 } : { error: cleanup.error },
    });
  } catch (err) {
    console.error("[historicalTrends] sync error:", err);
    return res.status(500).json({ error: err?.message ?? "Internal server error" });
  }
});

/**
 * GET /api/historical-trends/export
 * Historical Trends Export CSV. Query: city_id=davao, days=7|14 (or limit=), date=YYYY-MM-DD (optional, for filename).
 * Response: CSV attachment historical_trends_YYYY-MM-DD.csv
 * Columns: recorded_at, city_id, city_avg_temp_c, city_max_temp_c, city_min_temp_c, rolling_7d_avg_c, rolling_14d_avg_c
 */
router.get("/export", async (req, res) => {
  try {
    const cityId = (req.query.city_id || DEFAULT_CITY_ID).toString().trim().toLowerCase();
    const daysParam = req.query.days != null ? parseInt(req.query.days, 10) : null;
    const limitFromDays = daysParam === 7 || daysParam === 14 ? daysParam : null;
    const limitFromQuery = Math.min(90, Math.max(1, parseInt(req.query.limit, 10) || 14));
    const limit = limitFromDays != null ? limitFromDays : limitFromQuery;

    const result = await getHistoricalTrends(cityId, { limit });
    if (!result) {
      return res.status(503).json({
        error: "Failed to load historical trends",
        hint: "Ensure Supabase is configured and historical_trends table exists.",
      });
    }

    let dateStr = (req.query.date || "").toString().trim();
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const now = new Date();
      dateStr = [
        now.getUTCFullYear(),
        String(now.getUTCMonth() + 1).padStart(2, "0"),
        String(now.getUTCDate()).padStart(2, "0"),
      ].join("-");
    }

    const header = [
      "recorded_at",
      "city_id",
      "city_avg_temp_c",
      "city_max_temp_c",
      "city_min_temp_c",
      "rolling_7d_avg_c",
      "rolling_14d_avg_c",
    ];
    const lines = [header.join(",")];
    for (const row of result.rows ?? []) {
      lines.push(
        [
          csvEscape(row.recorded_at),
          csvEscape(row.city_id),
          csvEscape(row.city_avg_temp_c),
          csvEscape(row.city_max_temp_c),
          csvEscape(row.city_min_temp_c),
          csvEscape(row.rolling_7d_avg_c),
          csvEscape(row.rolling_14d_avg_c),
        ].join(",")
      );
    }

    res.set("Content-Type", "text/csv; charset=utf-8");
    res.set("Content-Disposition", `attachment; filename="historical_trends_${dateStr}.csv"`);
    return res.send(lines.join("\r\n"));
  } catch (err) {
    console.error("[historicalTrends] GET /export error:", err);
    return res.status(500).json({ error: "Failed to export historical trends CSV" });
  }
});

export default router;

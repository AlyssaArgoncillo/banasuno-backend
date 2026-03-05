/**
 * City-level historical temperature trends (WeatherAPI history.json → historical_trends).
 * Inserts one row per day; cleanup deletes rows older than 30 days.
 * Queries compute 7-day and 14-day rolling averages from city_avg_temp_c.
 */

import { supabase } from "../lib/supabase.js";
import { getHistory } from "./weatherService.js";

const TABLE = "historical_trends";
const RETENTION_DAYS = 30;

/**
 * Format date as YYYY-MM-DD.
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
 * Fetch one day of historical weather for a city from WeatherAPI history.json.
 * Extracts forecast.forecastday[0].day.avgtemp_c, maxtemp_c, mintemp_c.
 * @param {string} apiKey - WeatherAPI key (use WEATHER_API_KEY from env)
 * @param {string} cityName - e.g. "Davao"
 * @param {string} dt - YYYY-MM-DD
 * @returns {Promise<{ date: string, city_avg_temp_c: number, city_max_temp_c?: number, city_min_temp_c?: number } | null>}
 */
export async function fetchCityHistoryDay(apiKey, cityName, dt) {
  const data = await getHistory(apiKey, cityName, dt);
  if (!data) return null;
  const avgtemp = data.avgtemp_c;
  if (avgtemp == null || typeof avgtemp !== "number") return null;
  return {
    date: data.date ?? dt,
    city_avg_temp_c: Math.round(Number(avgtemp) * 100) / 100,
    city_max_temp_c:
      data.maxtemp_c != null && typeof data.maxtemp_c === "number"
        ? Math.round(Number(data.maxtemp_c) * 100) / 100
        : null,
    city_min_temp_c:
      data.mintemp_c != null && typeof data.mintemp_c === "number"
        ? Math.round(Number(data.mintemp_c) * 100) / 100
        : null,
  };
}

/**
 * Insert or upsert one row into historical_trends. Uses (city_id, recorded_at) as conflict target.
 * @param {object} row - { city_id, recorded_at (YYYY-MM-DD), city_avg_temp_c, city_max_temp_c?, city_min_temp_c?, source? (ignored if table has no column) }
 * @returns {Promise<{ ok: boolean, id?: number, error?: string }>}
 */
export async function insertHistoricalTrend(row) {
  if (!supabase) {
    console.error("[historicalTrends] Supabase not configured.");
    return { ok: false, error: "Supabase not configured" };
  }
  const recorded_at = row?.recorded_at ?? null;
  const city_id = row?.city_id ?? null;
  const city_avg_temp_c = row?.city_avg_temp_c != null ? Number(row.city_avg_temp_c) : null;
  if (!recorded_at || !city_id || city_avg_temp_c == null) {
    return { ok: false, error: "Missing recorded_at, city_id, or city_avg_temp_c" };
  }
  try {
    const payload = {
      recorded_at,
      city_id: String(city_id),
      city_avg_temp_c: Math.round(city_avg_temp_c * 100) / 100,
      city_max_temp_c: row.city_max_temp_c != null ? Math.round(Number(row.city_max_temp_c) * 100) / 100 : null,
      city_min_temp_c: row.city_min_temp_c != null ? Math.round(Number(row.city_min_temp_c) * 100) / 100 : null,
    };
    const { data, error } = await supabase
      .from(TABLE)
      .upsert(payload, { onConflict: "recorded_at,city_id" })
      .select("id")
      .single();
    if (error) {
      console.error("[historicalTrends] insert error:", error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true, id: data?.id };
  } catch (err) {
    console.error("[historicalTrends] insert exception:", err?.message ?? err);
    return { ok: false, error: err?.message ?? "Unknown error" };
  }
}

/**
 * Fetch last N days of WeatherAPI history for a city and insert into historical_trends.
 * @param {string} apiKey - WeatherAPI key
 * @param {string} cityId - e.g. "davao" (for stored city_id)
 * @param {string} cityName - e.g. "Davao" (for API q=)
 * @param {number} days - number of past days to fetch (e.g. 14)
 * @returns {Promise<{ inserted: number, errors: string[] }>}
 */
export async function fetchAndStoreCityHistoricalTrends(apiKey, cityId, cityName, days = 14) {
  const errors = [];
  let inserted = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 1; i <= days; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = formatDate(d);
    try {
      const dayData = await fetchCityHistoryDay(apiKey, cityName, dateStr);
      if (!dayData) continue;
      const result = await insertHistoricalTrend({
        recorded_at: dayData.date,
        city_id: cityId,
        city_avg_temp_c: dayData.city_avg_temp_c,
        city_max_temp_c: dayData.city_max_temp_c ?? undefined,
        city_min_temp_c: dayData.city_min_temp_c ?? undefined,
      });
      if (result.ok) inserted++;
      else if (result.error) errors.push(`${dateStr}: ${result.error}`);
    } catch (err) {
      errors.push(`${dateStr}: ${err?.message ?? err}`);
    }
  }
  return { inserted, errors };
}

/**
 * Delete rows older than 30 days: recorded_at < CURRENT_DATE - INTERVAL '30 days'.
 * @returns {Promise<{ ok: boolean, deleted?: number, error?: string }>}
 */
export async function deleteOlderThan30Days() {
  if (!supabase) {
    console.error("[historicalTrends] Supabase not configured.");
    return { ok: false, error: "Supabase not configured" };
  }
  try {
    const cutoff = formatDate(new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000));
    const { data, error } = await supabase
      .from(TABLE)
      .delete()
      .lt("recorded_at", cutoff)
      .select("id");
    if (error) {
      console.error("[historicalTrends] cleanup delete error:", error.message);
      return { ok: false, error: error.message };
    }
    const deleted = Array.isArray(data) ? data.length : 0;
    return { ok: true, deleted };
  } catch (err) {
    console.error("[historicalTrends] cleanup exception:", err?.message ?? err);
    return { ok: false, error: err?.message ?? "Unknown error" };
  }
}

/**
 * Get historical trend rows for a city with 7-day and 14-day rolling averages.
 * Each row includes avg, max, min and per-row rolling_7d_avg_c, rolling_14d_avg_c (average of that day and previous 6/13 days).
 * @param {string} cityId - e.g. "davao"
 * @param {object} [opts] - { limit?: number } max rows (default 30)
 * @returns {Promise<{ rows: Array<{ recorded_at, city_id, city_avg_temp_c, city_max_temp_c?, city_min_temp_c?, avg_c?, max_c?, min_c?, rolling_7d_avg_c?, rolling_14d_avg_c? }>, trend_7d_avg_c?, trend_14d_avg_c? } | null>}
 */
export async function getHistoricalTrends(cityId, opts = {}) {
  if (!supabase) return null;
  const id = cityId != null ? String(cityId).trim() : "";
  if (!id) return null;
  const limit = Math.min(90, Math.max(1, Number(opts.limit) || 30));
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("recorded_at, city_id, city_avg_temp_c, city_max_temp_c, city_min_temp_c")
      .eq("city_id", id)
      .order("recorded_at", { ascending: false })
      .limit(limit);
    if (error) {
      console.error("[historicalTrends] getHistoricalTrends error:", error.message);
      return null;
    }
    const raw = (data ?? []).map((r) => ({
      recorded_at: r.recorded_at,
      city_id: r.city_id,
      city_avg_temp_c: Number(r.city_avg_temp_c),
      city_max_temp_c: r.city_max_temp_c != null ? Number(r.city_max_temp_c) : undefined,
      city_min_temp_c: r.city_min_temp_c != null ? Number(r.city_min_temp_c) : undefined,
    }));
    const avgs = raw.map((r) => r.city_avg_temp_c);
    const trend_7d_avg_c =
      avgs.length >= 7
        ? Math.round((avgs.slice(0, 7).reduce((a, b) => a + b, 0) / 7) * 100) / 100
        : undefined;
    const trend_14d_avg_c =
      avgs.length >= 14
        ? Math.round((avgs.slice(0, 14).reduce((a, b) => a + b, 0) / 14) * 100) / 100
        : undefined;
    const rows = raw.map((r, i) => {
      const rolling7 = i + 7 <= raw.length ? raw.slice(i, i + 7).reduce((s, x) => s + x.city_avg_temp_c, 0) / 7 : undefined;
      const rolling14 = i + 14 <= raw.length ? raw.slice(i, i + 14).reduce((s, x) => s + x.city_avg_temp_c, 0) / 14 : undefined;
      return {
        ...r,
        avg_c: r.city_avg_temp_c,
        max_c: r.city_max_temp_c,
        min_c: r.city_min_temp_c,
        rolling_7d_avg_c: rolling7 != null ? Math.round(rolling7 * 100) / 100 : undefined,
        rolling_14d_avg_c: rolling14 != null ? Math.round(rolling14 * 100) / 100 : undefined,
      };
    });
    return {
      rows,
      trend_7d_avg_c,
      trend_14d_avg_c,
    };
  } catch (err) {
    console.error("[historicalTrends] getHistoricalTrends exception:", err?.message ?? err);
    return null;
  }
}

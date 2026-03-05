/**
 * Historical city temperatures: upsert and query Supabase historical_trends table.
 * API mounted at /api/historical/city-temperatures. Table columns: id, recorded_at, city_id, city_avg_temp_c, city_max_temp_c, city_min_temp_c, created_at.
 * Unique (recorded_at, city_id) → onConflict: "recorded_at,city_id".
 */

import { supabase } from "../lib/supabase.js";

const TABLE = "historical_trends";

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Upsert one row into historical_trends (city-level temps). Accepts avg_temp_c in API, maps to city_avg_temp_c.
 * @param {object} row - { city_id, avg_temp_c, [recorded_at], [city_max_temp_c], [city_min_temp_c] }
 * @returns {Promise<{ ok: boolean, id?: number, recorded_at?: string, error?: string }>}
 */
export async function upsertHistoricalCityTemperature(row) {
  if (!supabase) {
    console.error("[Supabase] historical_trends (city-temps): client not configured.");
    return { ok: false, error: "Supabase not configured" };
  }

  const city_id = row?.city_id ?? null;
  const avg_temp_c = row?.avg_temp_c != null ? Number(row.avg_temp_c) : null;
  if (city_id == null || avg_temp_c == null) {
    return { ok: false, error: "Missing required fields: city_id, avg_temp_c" };
  }

  const recorded_at = row?.recorded_at ?? formatDate(new Date());
  const payload = {
    city_id: String(city_id),
    city_avg_temp_c: Math.round(Number(avg_temp_c) * 100) / 100,
    recorded_at,
  };
  if (row?.city_max_temp_c != null && typeof row.city_max_temp_c === "number") payload.city_max_temp_c = Math.round(row.city_max_temp_c * 100) / 100;
  if (row?.city_min_temp_c != null && typeof row.city_min_temp_c === "number") payload.city_min_temp_c = Math.round(row.city_min_temp_c * 100) / 100;

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .upsert(payload, { onConflict: "recorded_at,city_id" })
      .select("id, recorded_at")
      .single();

    if (error) {
      console.error("[Supabase] historical_trends (city-temps) upsert error:", error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true, id: data?.id, recorded_at: data?.recorded_at };
  } catch (err) {
    console.error("[Supabase] historical_trends (city-temps) upsert exception:", err?.message ?? err);
    return { ok: false, error: err?.message ?? "Unknown error" };
  }
}

/**
 * Get historical_trends rows for a city (city temps), most recent first.
 * @param {string} cityId
 * @param {{ limit?: number, offset?: number }} [opts]
 * @returns {Promise<{ rows: Array<object>, error?: string }>}
 */
export async function getHistoricalCityTemperaturesForCity(cityId, opts = {}) {
  if (!supabase) {
    console.error("[Supabase] historical_trends (city-temps): client not configured.");
    return { rows: [], error: "Supabase not configured" };
  }
  const id = String(cityId ?? "").trim();
  if (!id) return { rows: [] };
  const limit = Math.min(90, Math.max(1, Number(opts.limit) || 30));
  const offset = Math.max(0, Number(opts.offset) || 0);
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("id, city_id, city_avg_temp_c, city_max_temp_c, city_min_temp_c, recorded_at, created_at")
      .eq("city_id", id)
      .order("recorded_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error("[Supabase] historical_trends (city-temps) query error:", error.message);
      return { rows: [], error: error.message };
    }
    const rows = (data ?? []).map((r) => ({
      id: r.id,
      city_id: String(r.city_id),
      avg_temp_c: Number(r.city_avg_temp_c),
      city_avg_temp_c: Number(r.city_avg_temp_c),
      city_max_temp_c: r.city_max_temp_c != null ? Number(r.city_max_temp_c) : undefined,
      city_min_temp_c: r.city_min_temp_c != null ? Number(r.city_min_temp_c) : undefined,
      recorded_at: r.recorded_at,
      created_at: r.created_at,
    }));
    return { rows };
  } catch (err) {
    console.error("[Supabase] historical_trends (city-temps) query exception:", err?.message ?? err);
    return { rows: [], error: err?.message ?? "Unknown error" };
  }
}

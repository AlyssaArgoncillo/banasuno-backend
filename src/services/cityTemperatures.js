/**
 * City temperatures: insert and query Supabase city_temperatures table.
 * Table: city_temperatures (id, city_id, avg_temp_c, source, recorded_at, created_at).
 * 7-day retention: call deleteOlderThan7Days() after sync (e.g. in heat risk job).
 */

import { supabase } from "../lib/supabase.js";

const TABLE = "city_temperatures";
const RETENTION_DAYS = 7;

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Insert one row into city_temperatures.
 * @param {object} row - { city_id, avg_temp_c, [recorded_at], [source] }
 * @returns {Promise<{ ok: boolean, id?: string, recorded_at?: string, error?: string }>}
 */
export async function insertCityTemperature(row) {
  if (!supabase) {
    console.error("[Supabase] city_temperatures: client not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).");
    return { ok: false, error: "Supabase not configured" };
  }

  const city_id = row?.city_id ?? null;
  const avg_temp_c = row?.avg_temp_c != null ? Number(row.avg_temp_c) : null;

  if (city_id == null || avg_temp_c == null) {
    console.warn("[Supabase] city_temperatures insert skipped: missing city_id or avg_temp_c.");
    return { ok: false, error: "Missing required fields: city_id, avg_temp_c" };
  }

  const recorded_at = row?.recorded_at ?? formatDate(new Date());

  try {
    const payload = {
      city_id: String(city_id),
      avg_temp_c: Math.round(Number(avg_temp_c) * 10) / 10,
      source: row?.source ?? "weatherapi",
      recorded_at,
    };

    const { data, error } = await supabase
      .from(TABLE)
      .upsert(payload, { onConflict: "city_id,recorded_at" })
      .select("id, recorded_at")
      .single();

    if (error) {
      console.error("[Supabase] city_temperatures insert error:", error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true, id: data?.id, recorded_at: data?.recorded_at };
  } catch (err) {
    console.error("[Supabase] city_temperatures insert exception:", err?.message ?? err);
    return { ok: false, error: err?.message ?? "Unknown error" };
  }
}

/**
 * Get city_temperatures rows for a city, most recent first.
 * @param {string} cityId
 * @param {{ limit?: number }} [opts] - limit (default 30, max 90)
 * @returns {Promise<Array<{ id?: number, city_id: string, avg_temp_c: number, source?: string, recorded_at: string, created_at?: string }>>}
 */
export async function getCityTemperaturesForCity(cityId, opts = {}) {
  if (!supabase) {
    console.error("[Supabase] city_temperatures: client not configured.");
    return [];
  }
  const id = String(cityId ?? "").trim();
  if (!id) return [];
  const limit = Math.min(90, Math.max(1, Number(opts.limit) || 30));
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("id, city_id, avg_temp_c, source, recorded_at, created_at")
      .eq("city_id", id)
      .order("recorded_at", { ascending: false })
      .limit(limit);
    if (error) {
      console.error("[Supabase] city_temperatures query error:", error.message);
      return [];
    }
    return (data ?? []).map((r) => ({
      id: r.id,
      city_id: String(r.city_id),
      avg_temp_c: Number(r.avg_temp_c),
      source: r.source ?? undefined,
      recorded_at: r.recorded_at,
      created_at: r.created_at,
    }));
  } catch (err) {
    console.error("[Supabase] city_temperatures query exception:", err?.message ?? err);
    return [];
  }
}

/**
 * Get city_temperatures row for a city on a specific date (UTC day).
 * @param {string} cityId
 * @param {string} dateStr - YYYY-MM-DD
 * @returns {Promise<{ city_id: string, avg_temp_c: number, recorded_at: string } | null>}
 */
export async function getCityTemperatureForDate(cityId, dateStr) {
  if (!supabase) return null;
  const id = String(cityId ?? "").trim();
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr))) return null;
  const from = `${dateStr}T00:00:00.000Z`;
  const nextDay = new Date(Date.UTC(
    parseInt(dateStr.slice(0, 4), 10),
    parseInt(dateStr.slice(5, 7), 10) - 1,
    parseInt(dateStr.slice(8, 10), 10) + 1
  ));
  const to = nextDay.toISOString();
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("city_id, avg_temp_c, recorded_at")
      .eq("city_id", id)
      .gte("recorded_at", from)
      .lt("recorded_at", to)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return {
      city_id: String(data.city_id),
      avg_temp_c: Number(data.avg_temp_c),
      recorded_at: data.recorded_at ? new Date(data.recorded_at).toISOString() : null,
    };
  } catch (err) {
    console.error("[Supabase] city_temperatures getCityTemperatureForDate:", err?.message ?? err);
    return null;
  }
}

/**
 * Get the most recent city_temperatures row for a city (by recorded_at).
 * @param {string} cityId
 * @returns {Promise<{ city_id: string, avg_temp_c: number, recorded_at: string } | null>}
 */
export async function getLatestCityTemperature(cityId) {
  if (!supabase) {
    console.error("[Supabase] city_temperatures: client not configured.");
    return null;
  }

  const id = String(cityId ?? "").trim();
  if (!id) {
    console.warn("[Supabase] city_temperatures getLatest: missing cityId.");
    return null;
  }

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("city_id, avg_temp_c, recorded_at")
      .eq("city_id", id)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[Supabase] city_temperatures query error:", error.message);
      return null;
    }

    if (!data) return null;
    return {
      city_id: String(data.city_id),
      avg_temp_c: Number(data.avg_temp_c),
      recorded_at: data.recorded_at ? new Date(data.recorded_at).toISOString() : null,
    };
  } catch (err) {
    console.error("[Supabase] city_temperatures query exception:", err?.message ?? err);
    return null;
  }
}

/**
 * Delete rows older than 7 days. Run after sync (e.g. in heat risk job).
 * DELETE FROM city_temperatures WHERE recorded_at < CURRENT_DATE - INTERVAL '7 days'
 * @returns {Promise<{ ok: boolean, deleted?: number, error?: string }>}
 */
export async function deleteOlderThan7Days() {
  if (!supabase) {
    console.error("[Supabase] city_temperatures: client not configured.");
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
      console.error("[Supabase] city_temperatures cleanup error:", error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true, deleted: Array.isArray(data) ? data.length : 0 };
  } catch (err) {
    console.error("[Supabase] city_temperatures cleanup exception:", err?.message ?? err);
    return { ok: false, error: err?.message ?? "Unknown error" };
  }
}

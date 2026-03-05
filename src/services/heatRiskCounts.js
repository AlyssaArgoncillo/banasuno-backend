/**
 * Heat risk counts: insert into and query Supabase heat_risk_counts table.
 * Table: heat_risk_counts (id, barangay_psgc, city_id, risk_level, risk_label, heat_index_c, source, recorded_at, created_at).
 * 7-day retention: call deleteOlderThan7Days() after sync (e.g. in heat risk job).
 */

import { supabase } from "../lib/supabase.js";
import { getLatestCityTemperature, getCityTemperatureForDate } from "./cityTemperatures.js";

const TABLE = "heat_risk_counts";
const RETENTION_DAYS = 7;

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** PAGASA levels 1–5. Map string risk_level to integer for DB (risk_level column is integer). */
const RISK_LEVEL_MAP = {
  low: 1,
  "not hazardous": 1,
  moderate: 2,
  medium: 2,
  caution: 2,
  high: 3,
  "extreme caution": 3,
  very_high: 4,
  "very high": 4,
  danger: 4,
  extreme: 5,
  "extreme danger": 5,
};

function normalizeRiskLevel(value) {
  if (value == null) return null;
  const n = Number(value);
  if (Number.isInteger(n) && n >= 1 && n <= 5) return n;
  const key = String(value).toLowerCase().trim();
  if (RISK_LEVEL_MAP[key] != null) return RISK_LEVEL_MAP[key];
  return null;
}

/**
 * Insert one record into heat_risk_counts.
 * @param {object} barangay - { barangay_psgc, risk_level, risk_label, heat_index_c, [city_id], [source] }
 * @returns {Promise<{ ok: boolean, id?: string, error?: string }>}
 */
export async function insertHeatRisk(barangay) {
  if (!supabase) {
    console.error("[Supabase] heat_risk_counts: client not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).");
    return { ok: false, error: "Supabase not configured" };
  }

  const barangay_psgc = barangay?.barangay_psgc ?? barangay?.barangay_id ?? null;
  const risk_level = barangay?.risk_level ?? null;
  const risk_label = barangay?.risk_label ?? null;
  const heat_index_c = barangay?.heat_index_c != null ? Number(barangay.heat_index_c) : null;
  const city_id = barangay?.city_id ?? "davao";
  const source = barangay?.source ?? "open-meteo";

  const risk_level_num = normalizeRiskLevel(risk_level);
  if (barangay_psgc == null || risk_level_num == null || risk_label == null) {
    console.warn("[Supabase] heat_risk_counts insert skipped: missing barangay_psgc, risk_level, or risk_label.");
    return { ok: false, error: "Missing required fields: barangay_psgc, risk_level (1-5 or low/moderate/high/very_high/extreme), risk_label" };
  }

  const recorded_at = barangay?.recorded_at ?? formatDate(new Date());
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .insert({
        barangay_psgc: String(barangay_psgc),
        city_id: String(city_id),
        risk_level: risk_level_num,
        risk_label: String(risk_label),
        heat_index_c: heat_index_c,
        source: String(source),
        recorded_at,
      })
      .select("id")
      .single();

    if (error) {
      console.error("[Supabase] heat_risk_counts insert error:", error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true, id: data?.id };
  } catch (err) {
    console.error("[Supabase] heat_risk_counts insert exception:", err?.message ?? err);
    return { ok: false, error: err?.message ?? "Unknown error" };
  }
}

/**
 * Get heat_risk_counts rows for a city, most recent first.
 * @param {string} cityId
 * @param {{ limit?: number }} [opts] - limit (default 100, max 500)
 * @returns {Promise<Array<{ id?: number, barangay_psgc: string, city_id: string, risk_level: string, risk_label: string, heat_index_c?: number, source?: string, recorded_at: string, created_at?: string }>>}
 */
export async function getHeatRiskCountsForCity(cityId, opts = {}) {
  if (!supabase) {
    console.error("[Supabase] heat_risk_counts: client not configured.");
    return [];
  }
  const id = String(cityId ?? "").trim();
  if (!id) return [];
  const limit = Math.min(500, Math.max(1, Number(opts.limit) || 100));
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("id, barangay_psgc, city_id, risk_level, risk_label, heat_index_c, source, recorded_at")
      .eq("city_id", id)
      .order("recorded_at", { ascending: false })
      .limit(limit);
    if (error) {
      console.error("[Supabase] heat_risk_counts query error:", error.message);
      return [];
    }
    return (data ?? []).map((r) => ({
      id: r.id,
      barangay_psgc: String(r.barangay_psgc),
      city_id: String(r.city_id),
      risk_level: r.risk_level,
      risk_label: String(r.risk_label),
      heat_index_c: r.heat_index_c != null ? Number(r.heat_index_c) : undefined,
      source: r.source ?? undefined,
      recorded_at: r.recorded_at,
    }));
  } catch (err) {
    console.error("[Supabase] heat_risk_counts query exception:", err?.message ?? err);
    return [];
  }
}

/**
 * Get today's per-barangay heat_risk_counts for a city (for building barangays list from Supabase).
 * @param {string} cityId - e.g. "davao"
 * @returns {Promise<Array<{ barangay_psgc: string, risk_level: number, risk_label: string, heat_index_c?: number }>>}
 */
export async function getHeatRiskCountsForTodayByBarangay(cityId) {
  if (!supabase) return [];
  const id = String(cityId ?? "").trim();
  if (!id) return [];
  const now = new Date();
  const todayStr = formatDate(now);
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("barangay_psgc, risk_level, risk_label, heat_index_c")
      .eq("city_id", id)
      .eq("recorded_at", todayStr);
    if (error) {
      console.error("[Supabase] heat_risk_counts getHeatRiskCountsForTodayByBarangay error:", error.message);
      return [];
    }
    return (data ?? []).map((r) => ({
      barangay_psgc: String(r.barangay_psgc),
      risk_level: Number(r.risk_level),
      risk_label: String(r.risk_label ?? ""),
      heat_index_c: r.heat_index_c != null ? Number(r.heat_index_c) : undefined,
    }));
  } catch (err) {
    console.error("[Supabase] getHeatRiskCountsForTodayByBarangay exception:", err?.message ?? err);
    return [];
  }
}

/**
 * Get counts grouped by risk_level and risk_label for records on a given date (UTC).
 * @param {string} dateStr - YYYY-MM-DD
 * @returns {Promise<Array<{ risk_level: number, risk_label: string, total: number }>>}
 */
export async function getHeatRiskCountsForDate(dateStr) {
  if (!supabase) {
    console.error("[Supabase] heat_risk_counts: client not configured.");
    return [];
  }
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr))) return [];
  const [y, m, d] = dateStr.split("-").map(Number);
  const startOfDay = new Date(Date.UTC(y, m - 1, d));
  const startOfNext = new Date(Date.UTC(y, m - 1, d + 1));
  const from = startOfDay.toISOString();
  const to = startOfNext.toISOString();

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("risk_level, risk_label")
      .gte("recorded_at", from)
      .lt("recorded_at", to);

    if (error) {
      console.error("[Supabase] heat_risk_counts query error:", error.message);
      return [];
    }

    const counts = new Map();
    const sep = "\t";
    for (const row of data ?? []) {
      const level = Number(row.risk_level);
      const label = String(row.risk_label ?? "");
      const key = `${level}${sep}${label}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const result = [];
    for (const [key, total] of counts) {
      const i = key.indexOf(sep);
      const risk_level = Number(i > 0 ? key.slice(0, i) : key);
      const risk_label = i > 0 ? key.slice(i + sep.length) : "";
      result.push({ risk_level, risk_label, total });
    }
    result.sort((a, b) => a.risk_level - b.risk_level);
    return result;
  } catch (err) {
    console.error("[Supabase] heat_risk_counts getHeatRiskCountsForDate exception:", err?.message ?? err);
    return [];
  }
}

/**
 * Get counts grouped by risk_level and risk_label for records recorded today (UTC).
 * @returns {Promise<Array<{ risk_level: number, risk_label: string, total: number }>>}
 */
export async function getHeatRiskCountsForToday() {
  if (!supabase) {
    console.error("[Supabase] heat_risk_counts: client not configured.");
    return [];
  }

  const now = new Date();
  const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setUTCDate(startOfTomorrow.getUTCDate() + 1);
  const from = startOfToday.toISOString();
  const to = startOfTomorrow.toISOString();

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("risk_level, risk_label")
      .gte("recorded_at", from)
      .lt("recorded_at", to);

    if (error) {
      console.error("[Supabase] heat_risk_counts query error:", error.message);
      return [];
    }

    const counts = new Map();
    const sep = "\t";
    for (const row of data ?? []) {
      const level = Number(row.risk_level);
      const label = String(row.risk_label ?? "");
      const key = `${level}${sep}${label}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const result = [];
    for (const [key, total] of counts) {
      const i = key.indexOf(sep);
      const risk_level = Number(i > 0 ? key.slice(0, i) : key);
      const risk_label = i > 0 ? key.slice(i + sep.length) : "";
      result.push({ risk_level, risk_label, total });
    }
    result.sort((a, b) => a.risk_level - b.risk_level);
    return result;
  } catch (err) {
    console.error("[Supabase] heat_risk_counts query exception:", err?.message ?? err);
    return [];
  }
}

/**
 * Get heat summary for API: risk counts (today) + latest city average temperature.
 * With format 'rows', returns a unified CSV-friendly array instead of separate sections.
 * @param {string} [cityId] - City for city_avg_temp (default "davao").
 * @param {{ format?: 'default' | 'rows' }} [opts] - 'rows' returns unified array of rows for CSV.
 * @returns {Promise<{ risk_counts: Array<{ risk_level: number, risk_label: string, total: number }>, city_avg_temp: { city_id: string, avg_temp_c: number, recorded_at: string } | null } | Array<{ city_id: string, recorded_at: string | null, risk_level: number, risk_label: string, total: number, avg_temp_c: number | null }>>}
 */
export async function getHeatSummary(cityId = "davao", opts = {}) {
  const risk_counts = await getHeatRiskCountsForToday();
  let city_avg_temp = null;
  try {
    city_avg_temp = await getLatestCityTemperature(cityId);
  } catch (err) {
    console.error("[Supabase] getHeatSummary city_temperatures error:", err?.message ?? err);
  }
  if (opts.format === "rows") {
    return getHeatSummaryRowsFromData(risk_counts, city_avg_temp, cityId);
  }
  return {
    risk_counts,
    city_avg_temp,
  };
}

/**
 * Build unified CSV-friendly rows: one per risk count, with city_id, recorded_at, avg_temp_c repeated.
 * @param {Array<{ risk_level: number, risk_label: string, total: number }>} risk_counts
 * @param {{ city_id: string, avg_temp_c: number, recorded_at: string } | null} city_avg_temp
 * @param {string} cityId - Fallback city_id when city_avg_temp is null.
 * @returns {Array<{ city_id: string, recorded_at: string | null, risk_level: number, risk_label: string, total: number, avg_temp_c: number | null }>}
 */
function getHeatSummaryRowsFromData(risk_counts, city_avg_temp, cityId) {
  const city_id = city_avg_temp?.city_id ?? cityId ?? "davao";
  const recorded_at = city_avg_temp?.recorded_at ?? null;
  const avg_temp_c = city_avg_temp?.avg_temp_c ?? null;
  const rows = (risk_counts ?? []).map((r) => ({
    city_id,
    recorded_at,
    risk_level: r.risk_level,
    risk_label: r.risk_label,
    total: r.total,
    avg_temp_c,
  }));
  return rows;
}

/**
 * Get heat summary as a unified array of rows (CSV-friendly).
 * Each row has city_id, recorded_at, risk_level, risk_label, total, avg_temp_c (same value on every row).
 * @param {string} [cityId] - City for city_avg_temp (default "davao").
 * @returns {Promise<Array<{ city_id: string, recorded_at: string | null, risk_level: number, risk_label: string, total: number, avg_temp_c: number | null }>>}
 */
export async function getHeatSummaryRows(cityId = "davao") {
  const risk_counts = await getHeatRiskCountsForToday();
  let city_avg_temp = null;
  try {
    city_avg_temp = await getLatestCityTemperature(cityId);
  } catch (err) {
    console.error("[Supabase] getHeatSummaryRows city_temperatures error:", err?.message ?? err);
  }
  return getHeatSummaryRowsFromData(risk_counts, city_avg_temp, cityId);
}

/**
 * Get heat summary rows for a specific date (for CSV export).
 * @param {string} [cityId] - City (default "davao").
 * @param {string} dateStr - YYYY-MM-DD.
 * @returns {Promise<Array<{ city_id: string, recorded_at: string | null, risk_level: number, risk_label: string, total: number, avg_temp_c: number | null }>>}
 */
export async function getHeatSummaryRowsForDate(cityId = "davao", dateStr) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr))) return [];
  const risk_counts = await getHeatRiskCountsForDate(dateStr);
  let city_avg_temp = null;
  try {
    city_avg_temp = await getCityTemperatureForDate(cityId, dateStr);
  } catch (err) {
    console.error("[Supabase] getHeatSummaryRowsForDate city_temperatures error:", err?.message ?? err);
  }
  return getHeatSummaryRowsFromData(risk_counts, city_avg_temp, cityId);
}

/**
 * Delete rows older than 7 days. Run after sync (e.g. in heat risk job).
 * DELETE FROM heat_risk_counts WHERE recorded_at < CURRENT_DATE - INTERVAL '7 days'
 * @returns {Promise<{ ok: boolean, deleted?: number, error?: string }>}
 */
export async function deleteOlderThan7Days() {
  if (!supabase) {
    console.error("[Supabase] heat_risk_counts: client not configured.");
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
      console.error("[Supabase] heat_risk_counts cleanup error:", error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true, deleted: Array.isArray(data) ? data.length : 0 };
  } catch (err) {
    console.error("[Supabase] heat_risk_counts cleanup exception:", err?.message ?? err);
    return { ok: false, error: err?.message ?? "Unknown error" };
  }
}

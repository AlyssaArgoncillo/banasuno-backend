/**
 * Historical heat risk counts: upsert and query heat_risk_counts (same table as daily).
 * API mounted at /api/historical/heat-risk-counts. Uses heat_risk_counts so GET/POST have correct columns (barangay_psgc, risk_level, etc.). historical_trends is city-level only.
 */

import { supabase } from "../lib/supabase.js";

const TABLE = "heat_risk_counts";

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const RISK_LEVEL_MAP = {
  low: 1, "not hazardous": 1,
  moderate: 2, medium: 2, caution: 2,
  high: 3, "extreme caution": 3,
  very_high: 4, "very high": 4, danger: 4,
  extreme: 5, "extreme danger": 5,
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
 * Upsert one record into historical_heat_risk_counts (same logic as daily).
 * heat_risk_counts must have UNIQUE(barangay_psgc, recorded_at) for upsert; else use insert.
 * @param {object} barangay - { barangay_psgc, city_id?, risk_level, risk_label, heat_index_c?, source?, recorded_at? }
 * @returns {Promise<{ ok: boolean, id?: number, error?: string }>}
 */
export async function upsertHistoricalHeatRisk(barangay) {
  if (!supabase) {
    console.error("[Supabase] heat_risk_counts (historical): client not configured.");
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
    return { ok: false, error: "Missing required fields: barangay_psgc, risk_level (1-5 or low/moderate/high/very_high/extreme), risk_label" };
  }

  const recorded_at = barangay?.recorded_at ?? formatDate(new Date());
  const payload = {
    barangay_psgc: String(barangay_psgc),
    city_id: String(city_id),
    risk_level: risk_level_num,
    risk_label: String(risk_label),
    heat_index_c: heat_index_c,
    source: String(source),
    recorded_at,
  };

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .upsert(payload, { onConflict: "barangay_psgc,recorded_at" })
      .select("id")
      .single();

    if (error) {
      console.error("[Supabase] heat_risk_counts (historical) upsert error:", error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true, id: data?.id };
  } catch (err) {
    console.error("[Supabase] heat_risk_counts (historical) upsert exception:", err?.message ?? err);
    return { ok: false, error: err?.message ?? "Unknown error" };
  }
}

/**
 * Get heat_risk_counts rows for a city, most recent first (with optional offset).
 * @param {string} cityId
 * @param {{ limit?: number, offset?: number }} [opts]
 * @returns {Promise<{ rows: Array<object>, error?: string }>}
 */
export async function getHistoricalHeatRiskCountsForCity(cityId, opts = {}) {
  if (!supabase) {
    console.error("[Supabase] heat_risk_counts (historical): client not configured.");
    return { rows: [], error: "Supabase not configured" };
  }
  const id = String(cityId ?? "").trim();
  if (!id) return { rows: [] };
  const limit = Math.min(500, Math.max(1, Number(opts.limit) || 100));
  const offset = Math.max(0, Number(opts.offset) || 0);
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("id, barangay_psgc, city_id, risk_level, risk_label, heat_index_c, source, recorded_at")
      .eq("city_id", id)
      .order("recorded_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) {
      console.error("[Supabase] heat_risk_counts (historical) query error:", error.message);
      return { rows: [], error: error.message };
    }
    const rows = (data ?? []).map((r) => ({
      id: r.id,
      barangay_psgc: String(r.barangay_psgc),
      city_id: String(r.city_id),
      risk_level: r.risk_level,
      risk_label: String(r.risk_label),
      heat_index_c: r.heat_index_c != null ? Number(r.heat_index_c) : undefined,
      source: r.source ?? undefined,
      recorded_at: r.recorded_at,
    }));
    return { rows };
  } catch (err) {
    console.error("[Supabase] heat_risk_counts (historical) query exception:", err?.message ?? err);
    return { rows: [], error: err?.message ?? "Unknown error" };
  }
}

/**
 * App storage backed by Supabase (Postgres). Replaces Redis for facilities and pipeline report.
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */

import { supabase } from "./supabase.js";

const FACILITIES_ROW_ID = "default";

function requireSupabase() {
  if (!supabase) {
    throw new Error("Store requires Supabase: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  }
  return supabase;
}

/**
 * Get Davao health facilities (JSON array). Returns [] if none or error.
 * @returns {Promise<Array<object>>}
 */
export async function getFacilities() {
  const db = requireSupabase();
  const { data, error } = await db.from("health_facilities_davao").select("data").eq("id", FACILITIES_ROW_ID).maybeSingle();
  if (error) {
    console.error("[store] getFacilities:", error.message);
    return [];
  }
  if (!data || data.data == null) return [];
  return Array.isArray(data.data) ? data.data : [];
}

/**
 * Set Davao health facilities (full replacement).
 * @param {Array<object>} facilities
 */
export async function setFacilities(facilities) {
  const db = requireSupabase();
  const { error } = await db
    .from("health_facilities_davao")
    .upsert({ id: FACILITIES_ROW_ID, data: facilities ?? [], updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) throw new Error(error.message);
}

/**
 * Get pipeline report CSV and updated_at for a city.
 * @param {string} cityId - e.g. 'davao'
 * @returns {Promise<{ csv: string, updatedAt: string | null }>}
 */
export async function getPipelineReport(cityId) {
  const db = requireSupabase();
  const { data, error } = await db.from("pipeline_report").select("csv, updated_at").eq("city_id", cityId).maybeSingle();
  if (error) {
    console.error("[store] getPipelineReport:", error.message);
    return { csv: "", updatedAt: null };
  }
  return {
    csv: data?.csv ?? "",
    updatedAt: data?.updated_at ?? null,
  };
}

/**
 * Get pipeline report meta (for /pipeline-report/meta).
 * @param {string} cityId
 * @returns {Promise<{ available: boolean, updatedAt: string | null }>}
 */
export async function getPipelineReportMeta(cityId) {
  const { csv, updatedAt } = await getPipelineReport(cityId);
  return { available: csv != null && csv.length > 0, updatedAt };
}

/**
 * Set pipeline report for a city (upsert). Optional TTL not enforced in Postgres; app can ignore old rows if needed.
 * @param {string} cityId
 * @param {string} csv
 */
export async function setPipelineReport(cityId, csv) {
  const db = requireSupabase();
  const now = new Date().toISOString();
  const { error } = await db.from("pipeline_report").upsert({ city_id: cityId, csv, updated_at: now }, { onConflict: "city_id" });
  if (error) throw new Error(error.message);
  return now;
}

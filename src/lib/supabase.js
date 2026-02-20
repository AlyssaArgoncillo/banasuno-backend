/**
 * Supabase (Postgres) client for backend use.
 * Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env (do not commit the key).
 * Use for heat_snapshots, heat_snapshot_barangays, or other Supabase tables.
 */

import { createClient } from "@supabase/supabase-js";

const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

/** Supabase client when env is set; null otherwise. */
export const supabase =
  url && serviceRoleKey
    ? createClient(url, serviceRoleKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      })
    : null;

/** True if SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set. */
export const isSupabaseConfigured = Boolean(supabase);

/**
 * Test database connection (e.g. for /health).
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function pingSupabase() {
  if (!supabase) return { ok: false, error: "not_configured" };
  try {
    const { error } = await supabase.from("health_facilities_davao").select("id").limit(1);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message ?? "unknown" };
  }
}

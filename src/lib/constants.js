/**
 * Shared constants used by routes and scripts.
 * Single source of truth to avoid drift (e.g. Redis key, URLs).
 */

/** Redis key for Davao health facilities list (JSON array). */
export const FACILITIES_KEY = "health:facilities:davao";

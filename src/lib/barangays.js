/**
 * Davao City barangays: only lat/lon per barangay (one point per barangay).
 * We load GeoJSON only to extract id + centroid (lat, lon); no polygon/boundary is used.
 */

import { getFeatureCentroid } from "./geo.js";

const DAVAO_BARANGAYS_URL =
  "https://raw.githubusercontent.com/faeldon/philippines-json-maps/master/2023/geojson/municities/lowres/bgysubmuns-municity-1130700000.0.001.json";

/** Timeout for geo fetch (ms). Slow WiFi may need longer. */
const GEO_FETCH_TIMEOUT_MS = 30000;
/** Retries on ECONNRESET / network errors. */
const GEO_FETCH_RETRIES = 3;
const GEO_FETCH_RETRY_DELAY_MS = 2000;

let cachedGeo = null;

/**
 * Clear the in-memory GeoJSON cache (e.g. after a bad load). Next request will re-fetch.
 */
export function clearBarangayGeoCache() {
  cachedGeo = null;
}

/**
 * Fetch Davao barangay GeoJSON (cached in memory).
 * Uses timeout and retries to cope with slow/unstable networks (ECONNRESET, fetch failed).
 * @returns {Promise<{ type: string, features: import('geojson').Feature[] }>}
 */
export async function getDavaoBarangayGeo() {
  if (cachedGeo) return cachedGeo;

  let lastErr;
  for (let attempt = 1; attempt <= GEO_FETCH_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), GEO_FETCH_TIMEOUT_MS);
      const res = await fetch(DAVAO_BARANGAYS_URL, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!res.ok) {
        throw new Error("Failed to load barangay boundaries: " + res.status + " " + res.statusText);
      }

      const geo = await res.json();

      if (!geo?.features?.length) {
        throw new Error("Barangay boundaries returned no features. Check: " + DAVAO_BARANGAYS_URL);
      }

      cachedGeo = geo;
      return cachedGeo;
    } catch (err) {
      lastErr = err;
      const isRetryable =
        err?.name === "AbortError" ||
        err?.message === "terminated" ||
        err?.code === "ECONNRESET" ||
        (err?.cause && (err.cause.code === "ECONNRESET" || err.cause.message === "fetch failed"));
      if (isRetryable && attempt < GEO_FETCH_RETRIES) {
        console.warn("[getDavaoBarangayGeo] Attempt", attempt, "failed:", err.message, "- retrying in", GEO_FETCH_RETRY_DELAY_MS, "ms");
        await new Promise((r) => setTimeout(r, GEO_FETCH_RETRY_DELAY_MS));
      } else {
        break;
      }
    }
  }

  console.error("[getDavaoBarangayGeo] Error:", lastErr?.message);
  throw lastErr;
}

function getBarangayId(feature) {
  if (!feature) return null;
  const id = feature.id ?? feature.properties?.adm4_psgc ?? feature.properties?.ADM4_PSGC;
  return id != null ? String(id) : null;
}

/**
 * Get barangay display name by ID from GeoJSON features.
 * @param {{ features: import('geojson').Feature[] }} geo
 * @param {string} barangayId
 * @returns {string}
 */
export function getBarangayNameById(geo, barangayId) {
  if (!geo?.features?.length || !barangayId) return String(barangayId ?? "");
  const id = String(barangayId).trim();
  for (const f of geo.features) {
    if (getBarangayId(f) === id) {
      return (f.properties?.adm4_en ?? f.properties?.name ?? f.properties?.ADM4_EN ?? id) || id;
    }
  }
  return id;
}

/**
 * Get list of barangays with only id and centroid (lat, lon). One point per barangay.
 * @param {{ features: import('geojson').Feature[] }} geo
 * @returns {Array<{ barangayId: string, lat: number, lng: number }>}
 */
export function getBarangayCentroids(geo) {
  if (!geo?.features?.length) return [];
  const list = [];
  for (const f of geo.features) {
    const id = getBarangayId(f);
    const centroid = getFeatureCentroid(f);
    if (id == null || !centroid) continue;
    const [lng, lat] = centroid;
    list.push({ barangayId: id, lat, lng });
  }
  if (geo.features.length > 0 && list.length === 0) {
    console.warn("Barangay GeoJSON has", geo.features.length, "features but none had valid id+centroid; check geometry/properties.");
  }
  return list;
}

/**
 * Get list of barangays with id, centroid (lat, lng), and area_km2 from GeoJSON properties.
 * @param {{ features: import('geojson').Feature[] }} geo
 * @returns {Array<{ barangayId: string, lat: number, lng: number, area_km2: number }>}
 */
export function getBarangayCentroidsWithArea(geo) {
  if (!geo?.features?.length) return [];
  const list = [];
  for (const f of geo.features) {
    const id = getBarangayId(f);
    const centroid = getFeatureCentroid(f);
    const areaKm2 = Number(f.properties?.area_km2) || 0;
    if (id == null || !centroid) continue;
    const [lng, lat] = centroid;
    list.push({ barangayId: id, lat, lng, area_km2: areaKm2 });
  }
  return list;
}


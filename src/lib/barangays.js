/**
 * Davao City barangays: only lat/lon per barangay (one point per barangay).
 * We load GeoJSON only to extract id + centroid (lat, lon); no polygon/boundary is used.
 */

import { getFeatureCentroid } from "./geo.js";

const DAVAO_BARANGAYS_URL =
  "https://raw.githubusercontent.com/faeldon/philippines-json-maps/master/2023/geojson/municities/lowres/bgysubmuns-municity-1130700000.0.001.json";

let cachedGeo = null;

/**
 * Fetch Davao barangay GeoJSON (cached in memory).
 * @returns {Promise<{ type: string, features: import('geojson').Feature[] }>}
 */
export async function getDavaoBarangayGeo() {
  if (cachedGeo) return cachedGeo;
  const res = await fetch(DAVAO_BARANGAYS_URL);
  if (!res.ok) throw new Error("Failed to load barangay boundaries");
  cachedGeo = await res.json();
  return cachedGeo;
}

function getBarangayId(feature) {
  if (!feature) return null;
  const id = feature.id ?? feature.properties?.adm4_psgc ?? feature.properties?.ADM4_PSGC;
  return id != null ? String(id) : null;
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
  return list;
}


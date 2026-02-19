/**
 * Logic model: assess Davao health facilities within a barangay.
 * Barangays have only lat/lon (centroid). A facility is assigned to the nearest barangay by distance.
 */

import { getDavaoBarangayGeo, getBarangayCentroids } from "../lib/barangays.js";

/**
 * Squared distance in lat/lng (no sqrt needed for comparison).
 * @param {number} lat1
 * @param {number} lng1
 * @param {number} lat2
 * @param {number} lng2
 * @returns {number}
 */
function distSq(lat1, lng1, lat2, lng2) {
  const dlat = lat1 - lat2;
  const dlng = lng1 - lng2;
  return dlat * dlat + dlng * dlng;
}

/**
 * Find barangay id whose centroid is nearest to (lat, lng).
 * @param {number} lat
 * @param {number} lng
 * @param {Array<{ barangayId: string, lat: number, lng: number }>} centroids
 * @returns {string | null}
 */
function nearestBarangayId(lat, lng, centroids) {
  if (!centroids.length) return null;
  let best = centroids[0];
  let bestD = distSq(lat, lng, best.lat, best.lng);
  for (let i = 1; i < centroids.length; i++) {
    const d = distSq(lat, lng, centroids[i].lat, centroids[i].lng);
    if (d < bestD) {
      bestD = d;
      best = centroids[i];
    }
  }
  return best.barangayId;
}

/**
 * Assign each facility to its nearest barangay (by barangay lat/lon only), then return facilities for one barangay.
 * @param {string} barangayId - Barangay id (e.g. PSGC adm4_psgc 1130700001)
 * @param {Array<{ latitude?: number, longitude?: number, [key: string]: unknown }>} facilities - Full list from Redis
 * @returns {Promise<{ barangayId: string, facilities: Array, total: number, found: boolean }>}
 */
export async function assessFacilitiesInBarangay(barangayId, facilities) {
  const id = String(barangayId).trim();
  const geo = await getDavaoBarangayGeo();
  const centroids = getBarangayCentroids(geo);
  const hasBarangay = centroids.some((c) => c.barangayId === id);
  if (!hasBarangay) {
    return { barangayId: id, facilities: [], total: 0, found: false };
  }

  const list = (facilities || []).filter((f) => {
    const lat = f.latitude;
    const lng = f.longitude;
    if (typeof lat !== "number" || typeof lng !== "number") return false;
    return nearestBarangayId(lat, lng, centroids) === id;
  });

  return {
    barangayId: id,
    facilities: list,
    total: list.length,
    found: true,
  };
}

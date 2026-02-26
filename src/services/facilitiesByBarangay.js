/**
 * Logic model: assess Davao health facilities for a barangay.
 * Uses OpenRoute driving-car matrix for distance_meters and travel_time_seconds.
 * Fallback thresholds: 2 km → 5 km → 10 km. Results sorted by distance_meters.
 */

import { getDavaoBarangayGeo, getBarangayCentroids } from "../lib/barangays.js";
import { getBatchTravelTimes } from "./openRoute.js";

/** OpenRoute matrix allows limited locations per request; we send centroid + facilities. */
const MAX_FACILITIES_PER_MATRIX = 49;

/** Straight-line pre-filter: only consider facilities within this many meters (to limit API size). */
const PRE_FILTER_STRAIGHT_LINE_M = 15000;

/** Fallback distance thresholds (meters): try 2 km, then 5 km, then 10 km. */
const THRESHOLDS_M = [2000, 5000, 10000];

/**
 * Approximate distance in meters between two points (Haversine).
 * @param {number} lat1
 * @param {number} lng1
 * @param {number} lat2
 * @param {number} lng2
 * @returns {number}
 */
function straightLineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Get facilities for a barangay using OpenRoute driving distance/duration.
 * Applies fallback thresholds (2 km → 5 km → 10 km), then sorts by distance_meters.
 * Each facility in the result includes distance_meters and travel_time_seconds.
 *
 * @param {string} barangayId - Barangay id (e.g. PSGC adm4_psgc 1130700001)
 * @param {Array<{ latitude?: number, longitude?: number, [key: string]: unknown }>} facilities - Full list from store (Postgres)
 * @returns {Promise<{ barangayId: string, facilities: Array, total: number, found: boolean }>}
 */
export async function assessFacilitiesInBarangay(barangayId, facilities) {
  const id = String(barangayId).trim();
  const geo = await getDavaoBarangayGeo();
  const centroids = getBarangayCentroids(geo);
  const centroid = centroids.find((c) => c.barangayId === id);

  if (!centroid) {
    return { barangayId: id, facilities: [], total: 0, found: false };
  }

  const withCoords = (facilities || []).filter((f) => {
    const lat = f.latitude;
    const lng = f.longitude;
    return typeof lat === "number" && typeof lng === "number";
  });

  // Pre-filter by straight-line distance and cap for matrix API
  const withStraightM = withCoords.map((f) => ({
    facility: f,
    straightM: straightLineMeters(centroid.lat, centroid.lng, f.latitude, f.longitude),
  }));
  const candidates = withStraightM
    .filter(({ straightM }) => straightM <= PRE_FILTER_STRAIGHT_LINE_M)
    .sort((a, b) => a.straightM - b.straightM)
    .slice(0, MAX_FACILITIES_PER_MATRIX)
    .map(({ facility }) => facility);

  if (candidates.length === 0) {
    return { barangayId: id, facilities: [], total: 0, found: true };
  }

  const apiKey = process.env.OPEN_ROUTE_API_KEY?.trim();
  let withTravel = [];

  if (apiKey) {
    try {
      const locations = [
        [centroid.lng, centroid.lat],
        ...candidates.map((f) => [Number(f.longitude), Number(f.latitude)]),
      ];
      const matrix = await getBatchTravelTimes(apiKey, locations);
      const durations = matrix.durations?.[0];
      const distances = matrix.distances?.[0];

      withTravel = candidates.map((f, i) => {
        const distM = distances && typeof distances[i + 1] === "number" ? Math.round(distances[i + 1]) : null;
        const durS = durations && typeof durations[i + 1] === "number" ? Math.round(durations[i + 1]) : null;
        return {
          ...f,
          distance_meters: distM,
          travel_time_seconds: durS,
        };
      });
    } catch (err) {
      console.warn("[assessFacilitiesInBarangay] OpenRoute failed, using straight-line fallback:", err?.message);
    }
  }

  // Fallback: no API or API failed – use straight-line distance only (no travel_time_seconds)
  if (withTravel.length === 0) {
    withTravel = candidates.map((f) => ({
      ...f,
      distance_meters: Math.round(straightLineMeters(centroid.lat, centroid.lng, f.latitude, f.longitude)),
      travel_time_seconds: null,
    }));
  }

  // Apply fallback thresholds: 2 km, then 5 km, then 10 km
  let list = [];
  for (const threshold of THRESHOLDS_M) {
    list = withTravel.filter((f) => f.distance_meters != null && f.distance_meters <= threshold);
    if (list.length > 0) break;
  }

  list.sort((a, b) => (a.distance_meters ?? 0) - (b.distance_meters ?? 0));

  return {
    barangayId: id,
    facilities: list,
    total: list.length,
    found: true,
  };
}

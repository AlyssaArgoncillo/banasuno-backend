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

/** Cache TTL for facility-by-barangay results (avoids repeated ORS calls for same barangay). 5 min. */
const CACHE_TTL_MS = 5 * 60 * 1000;
/** In-memory cache: key = barangayId (or barangayId:skipOrs), value = { result, ts }. */
const facilityByBarangayCache = new Map();

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
 * Get facilities for a barangay using OpenRoute driving distance/duration (or straight-line only if skipOrs).
 * Applies fallback thresholds (2 km → 5 km → 10 km). Results are cached for CACHE_TTL_MS to reduce ORS 429s.
 *
 * @param {string} barangayId - Barangay id (e.g. PSGC adm4_psgc 1130700001)
 * @param {Array<{ latitude?: number, longitude?: number, [key: string]: unknown }>} facilities - Full list from store (Postgres)
 * @param {{ skipOrs?: boolean }} [opts] - skipOrs: true = use straight-line only (for batch counts; avoids ORS rate limit)
 * @returns {Promise<{ barangayId: string, facilities: Array, total: number, found: boolean }>}
 */
export async function assessFacilitiesInBarangay(barangayId, facilities, opts = {}) {
  const id = String(barangayId).trim();
  const skipOrs = opts.skipOrs === true;
  const cacheKey = `${id}:${skipOrs}`;
  const now = Date.now();
  const cached = facilityByBarangayCache.get(cacheKey);
  if (cached && now - cached.ts < CACHE_TTL_MS) {
    return cached.result;
  }

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
    const result = { barangayId: id, facilities: [], total: 0, found: true };
    facilityByBarangayCache.set(cacheKey, { result, ts: now });
    return result;
  }

  let withTravel = [];

  if (!skipOrs && process.env.OPEN_ROUTE_API_KEY?.trim()) {
    try {
      const locations = [
        [centroid.lng, centroid.lat],
        ...candidates.map((f) => [Number(f.longitude), Number(f.latitude)]),
      ];
      const matrix = await getBatchTravelTimes(process.env.OPEN_ROUTE_API_KEY.trim(), locations);
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

  if (withTravel.length === 0) {
    withTravel = candidates.map((f) => ({
      ...f,
      distance_meters: Math.round(straightLineMeters(centroid.lat, centroid.lng, f.latitude, f.longitude)),
      travel_time_seconds: null,
    }));
  }

  let list = [];
  for (const threshold of THRESHOLDS_M) {
    list = withTravel.filter((f) => f.distance_meters != null && f.distance_meters <= threshold);
    if (list.length > 0) break;
  }

  list.sort((a, b) => (a.distance_meters ?? 0) - (b.distance_meters ?? 0));

  const result = {
    barangayId: id,
    facilities: list,
    total: list.length,
    found: true,
    fallbackNearest: false,
  };
  facilityByBarangayCache.set(cacheKey, { result, ts: now });
  return result;
}

/** Default number of nearest facilities to return when no facilities are within threshold. */
const NEAREST_FALLBACK_LIMIT = 10;

/**
 * Get nearest facilities for a barangay (with distance_meters), when no facilities are within threshold.
 * Used as fallback for GET /api/facilities/by-barangay/:id so the frontend always gets a list with distance.
 *
 * @param {string} barangayId - Barangay id (PSGC)
 * @param {Array<{ latitude?: number, longitude?: number, [key: string]: unknown }>} facilities - Full list from store
 * @param {{ limit?: number }} [opts] - limit (default 10)
 * @returns {Promise<{ barangayId: string, facilities: Array<{ ...facility, distance_meters: number, travel_time_seconds?: number | null }>, total: number, found: boolean, fallbackNearest: true }>}
 */
export async function getNearestFacilitiesForBarangay(barangayId, facilities, opts = {}) {
  const id = String(barangayId).trim();
  const limit = Math.min(50, Math.max(1, Number(opts.limit) || NEAREST_FALLBACK_LIMIT));
  const geo = await getDavaoBarangayGeo();
  const centroids = getBarangayCentroids(geo);
  const centroid = centroids.find((c) => c.barangayId === id);

  if (!centroid) {
    return { barangayId: id, facilities: [], total: 0, found: false, fallbackNearest: true };
  }

  const withCoords = (facilities || []).filter((f) => {
    const lat = f.latitude;
    const lng = f.longitude;
    return typeof lat === "number" && typeof lng === "number";
  });

  const withStraightM = withCoords.map((f) => ({
    facility: f,
    straightM: straightLineMeters(centroid.lat, centroid.lng, f.latitude, f.longitude),
  }));
  const sorted = withStraightM.sort((a, b) => a.straightM - b.straightM).slice(0, limit);

  const apiKey = process.env.OPEN_ROUTE_API_KEY?.trim();
  const maxForMatrix = Math.min(MAX_FACILITIES_PER_MATRIX, sorted.length);
  let withTravel = sorted.slice(0, maxForMatrix).map(({ facility, straightM }) => ({
    ...facility,
    distance_meters: Math.round(straightM),
    travel_time_seconds: null,
  }));

  if (apiKey && withTravel.length > 0) {
    try {
      const locations = [
        [centroid.lng, centroid.lat],
        ...withTravel.map((f) => [Number(f.longitude), Number(f.latitude)]),
      ];
      const matrix = await getBatchTravelTimes(apiKey, locations);
      const durations = matrix.durations?.[0];
      const distances = matrix.distances?.[0];
      withTravel = withTravel.map((f, i) => {
        const distM = distances && typeof distances[i + 1] === "number" ? Math.round(distances[i + 1]) : f.distance_meters;
        const durS = durations && typeof durations[i + 1] === "number" ? Math.round(durations[i + 1]) : null;
        return { ...f, distance_meters: distM, travel_time_seconds: durS };
      });
    } catch (err) {
      console.warn("[getNearestFacilitiesForBarangay] OpenRoute failed, using straight-line:", err?.message);
    }
  }

  return {
    barangayId: id,
    facilities: withTravel,
    total: withTravel.length,
    found: true,
    fallbackNearest: true,
  };
}

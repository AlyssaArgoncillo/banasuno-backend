/**
 * OpenRouteService API routes – batch travel times (matrix).
 * Accepts frontend body: { barangayIds: string[], facilities: [{ id, lon, lat }] }.
 * Resolves barangay IDs to centroids from Davao GeoJSON, calls ORS matrix, returns results and summary.
 */

import { Router } from "express";
import { getBatchTravelTimes, getDirections } from "../services/openRoute.js";
import { getDavaoBarangayGeo, getBarangayCentroids } from "../lib/barangays.js";

const router = Router();

/**
 * Normalize facility coordinate: accept lon or lng, lat.
 * @param {object} f - { id, lon?, lng?, lat }
 * @returns {{ id: string, lng: number, lat: number } | null}
 */
function normalizeFacility(f) {
  if (!f || (f.id !== 0 && (f.id === undefined || f.id === null || (typeof f.id === "string" && !f.id.trim())))) return null;
  const lng = f.lon ?? f.longitude ?? f.lng;
  const lat = f.lat ?? f.latitude;
  if (typeof lng !== "number" || typeof lat !== "number") return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { id: String(f.id), lng, lat };
}

/**
 * POST /api/ors/batch-travel-times
 *
 * Request body (frontend shape):
 *   { barangayIds: string[], facilities: [{ id, lon, lat }] }
 *
 * Response:
 *   { results: [{ barangay_id, facility_id, travel_time_seconds, distance_metres }], summary: { total_pairs, errors, nearest_per_barangay } }
 *
 * - Empty barangayIds or facilities → 200 with empty results and summary (no 400).
 * - Barangays not found in GeoJSON are skipped; partial results returned.
 * - ORS key missing → 503. ORS API error → 502 with error body.
 */
router.post("/batch-travel-times", async (req, res) => {
  try {
    const body = req.body ?? {};
    let { barangayIds, facilities } = body;

    if (!Array.isArray(barangayIds)) barangayIds = [];
    if (!Array.isArray(facilities)) facilities = [];
    barangayIds = barangayIds.map((id) => (id != null ? String(id).trim() : "")).filter(Boolean);
    const normalizedFacilities = facilities.map(normalizeFacility).filter(Boolean);

    const emptyResults = {
      results: [],
      summary: {
        total_pairs: 0,
        errors: 0,
        nearest_per_barangay: [],
      },
    };

    if (barangayIds.length === 0 || normalizedFacilities.length === 0) {
      return res.status(200).json(emptyResults);
    }

    const apiKey = process.env.OPEN_ROUTE_API_KEY?.trim();
    if (!apiKey) {
      return res.status(503).json({
        error: "OpenRoute not configured",
        details: "Set OPEN_ROUTE_API_KEY in .env (https://openrouteservice.org/dev/)",
      });
    }

    const geo = await getDavaoBarangayGeo();
    const centroids = getBarangayCentroids(geo);
    const centroidByBarangayId = new Map(centroids.map((c) => [c.barangayId, [c.lng, c.lat]]));

    const resolvedBarangays = [];
    const barangayCoords = [];
    for (const bid of barangayIds) {
      const coord = centroidByBarangayId.get(bid);
      if (coord) {
        resolvedBarangays.push({ barangay_id: bid, coord });
        barangayCoords.push(coord);
      }
    }

    if (resolvedBarangays.length === 0) {
      return res.status(200).json({
        ...emptyResults,
        summary: {
          ...emptyResults.summary,
          errors: 1,
          message: "No barangay IDs could be resolved to centroids",
        },
      });
    }

    const facilityCoords = normalizedFacilities.map((f) => [f.lng, f.lat]);
    const locations = [...barangayCoords, ...facilityCoords];

    if (locations.length < 2) {
      return res.status(200).json(emptyResults);
    }

    const matrix = await getBatchTravelTimes(apiKey, locations);
    const durations = matrix.durations ?? [];
    const distances = matrix.distances ?? [];

    const N = resolvedBarangays.length;
    const results = [];
    const nearestByBarangay = new Map();

    for (let i = 0; i < N; i++) {
      const { barangay_id } = resolvedBarangays[i];
      let nearestSeconds = Infinity;
      let nearestFacilityId = null;
      let nearestDistance = null;

      for (let j = 0; j < normalizedFacilities.length; j++) {
        const facilityId = normalizedFacilities[j].id;
        const dur = durations[i]?.[N + j];
        const dist = distances[i]?.[N + j];
        const travel_time_seconds = typeof dur === "number" && dur >= 0 ? Math.round(dur) : null;
        const distance_metres = typeof dist === "number" && dist >= 0 ? Math.round(dist) : null;

        if (travel_time_seconds != null) {
          results.push({
            barangay_id,
            facility_id: facilityId,
            travel_time_seconds,
            distance_metres,
          });
          if (travel_time_seconds < nearestSeconds) {
            nearestSeconds = travel_time_seconds;
            nearestFacilityId = facilityId;
            nearestDistance = distance_metres;
          }
        }
      }

      if (nearestFacilityId != null) {
        nearestByBarangay.set(barangay_id, {
          barangay_id,
          facility_id: nearestFacilityId,
          travel_time_seconds: nearestSeconds,
          travel_time_minutes: Math.round((nearestSeconds / 60) * 10) / 10,
          distance_metres: nearestDistance,
        });
      }
    }

    const summary = {
      total_pairs: results.length,
      errors: resolvedBarangays.length < barangayIds.length ? 1 : 0,
      nearest_per_barangay: Array.from(nearestByBarangay.values()),
    };

    return res.status(200).json({
      results,
      summary,
    });
  } catch (err) {
    console.error("[ORS] batch-travel-times error:", err?.message ?? err);
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    const isServerError = status >= 500;
    return res.status(isServerError ? (status === 503 ? 503 : 502) : status).json({
      error: err.message || "OpenRoute request failed",
      details: err.details ?? undefined,
    });
  }
});

/** Allowed profiles for directions (ORS v2). */
const DIRECTIONS_PROFILES = ["driving-car", "foot-walking", "cycling-regular"];

function parseCoord(v) {
  if (Array.isArray(v) && v.length >= 2) {
    const lng = Number(v[0]);
    const lat = Number(v[1]);
    if (Number.isFinite(lng) && Number.isFinite(lat) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return [lng, lat];
    }
  }
  if (v && typeof v === "object" && (typeof v.lng === "number" || typeof v.lon === "number") && typeof v.lat === "number") {
    const lng = v.lng ?? v.lon;
    const lat = v.lat;
    if (Number.isFinite(lng) && Number.isFinite(lat) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return [lng, lat];
    }
  }
  return null;
}

/**
 * POST /api/ors/directions
 *
 * Request body:
 *   { start: [lng, lat] | { lng, lat }, end: [lng, lat] | { lng, lat }, profile?: "driving-car" | "foot-walking" | "cycling-regular" }
 *
 * Returns ORS Directions API GeoJSON: route geometry (LineString) and summary (distance in metres, duration in seconds).
 * Frontend uses this for "Show Route" (barangay → facility) with dropdown profile; draw polyline and show distance/travel time.
 */
router.post("/directions", async (req, res) => {
  try {
    const body = req.body ?? {};
    const start = parseCoord(body.start);
    const end = parseCoord(body.end);
    const profile = DIRECTIONS_PROFILES.includes(body.profile) ? body.profile : "driving-car";

    if (!start || !end) {
      return res.status(400).json({
        error: "Invalid coordinates",
        details: "start and end are required; each must be [lng, lat] or { lng, lat }",
      });
    }

    const apiKey = process.env.OPEN_ROUTE_API_KEY?.trim();
    if (!apiKey) {
      return res.status(503).json({
        error: "OpenRoute not configured",
        details: "Set OPEN_ROUTE_API_KEY in .env (https://openrouteservice.org/dev/)",
      });
    }

    const geojson = await getDirections(apiKey, profile, [start, end]);
    return res.status(200).json(geojson);
  } catch (err) {
    console.error("[ORS] directions error:", err?.message ?? err);
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    if (status === 404) {
      // Temporary diagnostics for frontend/backend alignment on ORS errors
      console.error("[ORS] directions 404 diagnostics:", {
        start: req.body?.start,
        end: req.body?.end,
        profile: req.body?.profile,
        details: err.details,
      });
    }
    return res.status(status >= 500 ? 502 : status).json({
      error: err.message || "OpenRoute directions request failed",
      details: err.details ?? undefined,
    });
  }
});

export default router;

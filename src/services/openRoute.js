/**
 * OpenRouteService matrix API – batch travel times (driving-car).
 * Locations as [lng, lat][] per OpenRoute convention.
 * API key: OPEN_ROUTE_API_KEY (https://openrouteservice.org/dev/).
 */

const MATRIX_URL = "https://api.openrouteservice.org/v2/matrix/driving-car";

/**
 * Get distance and duration matrix from OpenRouteService.
 * @param {string} apiKey - OpenRoute API key
 * @param {[number, number][]} locations - List of [lng, lat] coordinates
 * @returns {Promise<{ durations?: number[][], distances?: number[][] }>} Parsed JSON response
 * @throws {Error} If response not ok or body invalid
 */
export async function getBatchTravelTimes(apiKey, locations) {
  if (!apiKey || !Array.isArray(locations) || locations.length === 0) {
    throw new Error("apiKey and non-empty locations array required");
  }

  const body = {
    locations,
    metrics: ["distance", "duration"],
  };

  const res = await fetch(MATRIX_URL, {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    let details;
    try {
      details = JSON.parse(text);
    } catch {
      details = text || res.statusText;
    }
    const err = new Error(`OpenRoute matrix failed: ${res.status}`);
    err.status = res.status;
    err.details = details;
    throw err;
  }

  const data = await res.json();
  return data;
}

/** Allowed profiles for ORS Directions API (v2). */
const DIRECTIONS_PROFILES = ["driving-car", "foot-walking", "cycling-regular"];
const DIRECTIONS_BASE = "https://api.openrouteservice.org/v2/directions";

/**
 * Get route geometry and summary from OpenRouteService Directions API (GeoJSON).
 * Use for "Show Route" from barangay to facility with profile (walking, driving, cycling).
 * @param {string} apiKey - OpenRoute API key
 * @param {string} profile - One of: driving-car, foot-walking, cycling-regular
 * @param {[number, number][]} coordinates - [[lng1, lat1], [lng2, lat2]] (start, end)
 * @returns {Promise<object>} GeoJSON FeatureCollection with route geometry and properties.summary (distance in m, duration in s)
 * @throws {Error} If response not ok or invalid
 */
export async function getDirections(apiKey, profile, coordinates) {
  if (!apiKey || !coordinates || coordinates.length < 2) {
    throw new Error("apiKey and at least two coordinates [lng, lat] required");
  }
  const normalized = DIRECTIONS_PROFILES.includes(profile) ? profile : "driving-car";
  const url = `${DIRECTIONS_BASE}/${normalized}/geojson`;

  const body = { coordinates: coordinates.slice(0, 2) };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    let details;
    try {
      details = JSON.parse(text);
    } catch {
      details = text || res.statusText;
    }
    const err = new Error(`OpenRoute directions failed: ${res.status}`);
    err.status = res.status;
    err.details = details;
    throw err;
  }

  return res.json();
}

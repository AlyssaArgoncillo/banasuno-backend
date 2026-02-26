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

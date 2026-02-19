/**
 * Diagnostic: call WeatherAPI for several different barangay centroids and print
 * what the API returns (location name, lat, lon, temp). Use this to see whether
 * WeatherAPI returns different data per point or the same regional data.
 *
 * Run: node scripts/check-weatherapi-per-barangay.js
 * Requires: .env with WEATHER_API_KEY, or set it in the environment.
 */

import "dotenv/config";
import { getCurrentWeather } from "../src/services/weatherService.js";
import { getFeatureCentroid } from "../src/lib/geo.js";

const DAVAO_GEOJSON =
  "https://raw.githubusercontent.com/faeldon/philippines-json-maps/master/2023/geojson/municities/lowres/bgysubmuns-municity-1130700000.0.001.json";

async function main() {
  const apiKey = process.env.WEATHER_API_KEY;
  if (!apiKey) {
    console.error("Set WEATHER_API_KEY in .env or environment.");
    process.exit(1);
  }

  const res = await fetch(DAVAO_GEOJSON);
  if (!res.ok) {
    console.error("Failed to fetch barangay GeoJSON");
    process.exit(1);
  }
  const geo = await res.json();
  const features = geo?.features || [];
  if (features.length === 0) {
    console.error("No features in GeoJSON");
    process.exit(1);
  }

  // Pick several barangays spread across the list (and thus geography)
  const indices = [0, Math.floor(features.length * 0.25), Math.floor(features.length * 0.5), Math.floor(features.length * 0.75), features.length - 1];
  const toCheck = indices
    .map((i) => ({ feature: features[i], index: i }))
    .filter(({ feature }) => getFeatureCentroid(feature));

  console.log("Requesting WeatherAPI for", toCheck.length, "different barangay centroids (lat,lon)...\n");

  for (const { feature, index } of toCheck) {
    const centroid = getFeatureCentroid(feature);
    const [lng, lat] = centroid;
    const id = feature.id ?? feature.properties?.adm4_psgc ?? feature.properties?.ADM4_PSGC;
    const name = feature.properties?.name ?? feature.properties?.BGY ?? id;
    const q = `${lat},${lng}`;
    const weather = await getCurrentWeather(apiKey, q);
    const loc = weather?.location;
    console.log(`Barangay #${index} (id=${id}, name=${name})`);
    console.log(`  Requested:  lat=${lat.toFixed(4)}, lon=${lng.toFixed(4)}  (q="${q}")`);
    if (weather) {
      console.log(`  Response:   location.name="${loc?.name ?? ""}", location.lat=${loc?.lat}, location.lon=${loc?.lon}, temp_c=${weather.temp_c}`);
    } else {
      console.log(`  Response:   (no data)`);
    }
    console.log("");
  }

  console.log("If 'location.name' and/or location.lat/lon are identical for all, WeatherAPI is returning regional data, not per-point.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

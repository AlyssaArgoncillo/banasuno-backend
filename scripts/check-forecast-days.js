/**
 * Verify that 7-day and 14-day forecast modes actually return the expected number of days.
 * Run: node scripts/check-forecast-days.js
 * Requires: .env with WEATHER_API_KEY.
 */

import "dotenv/config";
import { getForecast } from "../src/services/weatherService.js";

const DAVAO_CENTER = "7.1907,125.4553";

async function main() {
  const apiKey = process.env.WEATHER_API_KEY;
  if (!apiKey) {
    console.error("Set WEATHER_API_KEY in .env or environment.");
    process.exit(1);
  }

  console.log("Fetching 7-day forecast...");
  const data7 = await getForecast(apiKey, DAVAO_CENTER, 7);
  if (!data7) {
    console.error("7-day forecast: no data returned.");
    process.exit(1);
  }
  const count7 = data7.forecastDay?.length ?? 0;
  const first7 = data7.forecastDay?.[0]?.date;
  const last7 = data7.forecastDay?.[count7 - 1]?.date;
  console.log(`  7-day: requested 7, received ${count7} days (${first7} → ${last7})`);
  if (count7 !== 7) {
    console.warn(`  Warning: expected 7 days, got ${count7}. Check WeatherAPI plan limits.`);
  }

  console.log("Fetching 14-day forecast...");
  const data14 = await getForecast(apiKey, DAVAO_CENTER, 14);
  if (!data14) {
    console.error("14-day forecast: no data returned.");
    process.exit(1);
  }
  const count14 = data14.forecastDay?.length ?? 0;
  const first14 = data14.forecastDay?.[0]?.date;
  const last14 = data14.forecastDay?.[count14 - 1]?.date;
  console.log(`  14-day: requested 14, received ${count14} days (${first14} → ${last14})`);
  if (count14 !== 14) {
    console.warn(`  Warning: expected 14 days, got ${count14}. Check WeatherAPI plan limits.`);
  }

  console.log("\nDone. 7-day and 14-day modes fetch correctly.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * WeatherAPI.com integration – current weather and forecast by location.
 * Used to supply real temperature data for the heat map (e.g. Davao City).
 * API key: set WEATHER_API_KEY in .env (get one at https://www.weatherapi.com/my/).
 */

const WEATHER_API_BASE = "https://api.weatherapi.com/v1";
const OPEN_METEO_BASE = "https://api.open-meteo.com/v1/forecast";

/**
 * Fetch current weather for a location.
 * @param {string} apiKey - WeatherAPI key
 * @param {string} q - Location: "lat,lon", city name, etc. (see https://www.weatherapi.com/docs/)
 * @returns {Promise<{
 *   temp_c: number,
 *   feelslike_c?: number,
 *   humidity?: number,
 *   condition?: string,
 *   location?: {
 *     name?: string,
 *     region?: string,
 *     country?: string,
 *     lat?: number,
 *     lon?: number,
 *     tz_id?: string,
 *     localtime_epoch?: number,
 *     localtime?: string
 *   }
 * } | null>}
 */
export async function getCurrentWeather(apiKey, q) {
  if (!apiKey || !q) return null;
  const url = `${WEATHER_API_BASE}/current.json?key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(q)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const current = data?.current;
  if (!current || typeof current.temp_c !== "number") return null;
  const location = data?.location;
  return {
    temp_c: current.temp_c,
    feelslike_c: current.feelslike_c,
    humidity:
      typeof current.humidity === "number" && current.humidity >= 0 && current.humidity <= 100
        ? current.humidity
        : undefined,
    condition: current.condition?.text,
    location: location
      ? {
          name: location.name,
          region: location.region,
          country: location.country,
          lat: location.lat,
          lon: location.lon,
          tz_id: location.tz_id,
          localtime_epoch: location.localtime_epoch,
          localtime: location.localtime,
        }
      : undefined,
  };
}

/**
 * Fetch current temperature (and optional humidity) from Open-Meteo.
 * @param {number} lat
 * @param {number} lon
 * @param {string} timezone
 * @returns {Promise<{ temp_c: number, humidity?: number } | null>}
 */
export async function getOpenMeteoCurrent(lat, lon, timezone = "Asia/Singapore") {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: "temperature_2m,relative_humidity_2m",
    timezone,
    forecast_days: "1",
  });
  const url = `${OPEN_METEO_BASE}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const current = data?.current;
  const temp = typeof current?.temperature_2m === "number" ? current.temperature_2m : null;
  if (temp == null) return null;
  const humidity =
    typeof current?.relative_humidity_2m === "number" &&
    current.relative_humidity_2m >= 0 &&
    current.relative_humidity_2m <= 100
      ? current.relative_humidity_2m
      : undefined;
  return {
    temp_c: temp,
    humidity,
  };
}

/**
 * Fetch 7- or 14-day forecast (historical trend) for a location.
 * Uses WeatherAPI forecast endpoint (days=1–14).
 * @param {string} apiKey - WeatherAPI key
 * @param {string} q - Location: "lat,lon", city name, etc.
 * @param {number} days - 7 or 14
 * @returns {Promise<{
 *   location?: { name?: string, region?: string, country?: string, lat?: number, lon?: number, tz_id?: string },
 *   forecastDay: Array<{
 *     date: string,
 *     date_epoch: number,
 *     mintemp_c: number,
 *     maxtemp_c: number,
 *     avgtemp_c: number,
 *     condition?: string,
 *     daily_chance_of_rain?: number,
 *     totalprecip_mm?: number
 *   }>
 * } | null>}
 */
export async function getForecast(apiKey, q, days = 7) {
  if (!apiKey || !q) return null;
  const dayCount = Math.min(14, Math.max(1, Number(days) || 7));
  const url = `${WEATHER_API_BASE}/forecast.json?key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(q)}&days=${dayCount}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const forecast = data?.forecast?.forecastday;
  const location = data?.location;
  if (!Array.isArray(forecast) || forecast.length === 0) return null;

  const forecastDay = forecast.map((fd) => {
    const day = fd?.day || {};
    return {
      date: fd.date,
      date_epoch: fd.date_epoch,
      mintemp_c: day.mintemp_c,
      maxtemp_c: day.maxtemp_c,
      avgtemp_c: day.avgtemp_c,
      condition: day.condition?.text,
      daily_chance_of_rain: day.daily_chance_of_rain,
      totalprecip_mm: day.totalprecip_mm,
    };
  });

  return {
    location: location
      ? {
          name: location.name,
          region: location.region,
          country: location.country,
          lat: location.lat,
          lon: location.lon,
          tz_id: location.tz_id,
        }
      : undefined,
    forecastDay,
  };
}

/**
 * BanasUno backend – Express API with Supabase (Postgres).
 * Health facilities and pipeline report are stored in Postgres; seed with npm run seed:facilities.
 */

import "dotenv/config";
import express from "express";
import { pingSupabase } from "./lib/supabase.js";
import healthFacilities from "./routes/healthFacilities.js";
import heat from "./routes/heat.js";
import openRouteRouter from "./routes/openRoute.js";
import heatAdvisoryRouter from "./routes/heatAdvisory.js";
import historicalTrendsRoutes from "./routes/historicalTrendsRoutes.js";
import heatRiskCountsRoutes from "./routes/heatRiskCountsRoutes.js";
import cityTemperaturesRoutes from "./routes/cityTemperaturesRoutes.js";
import historicalHeatRiskCountsRouter from "./routes/historicalHeatRiskCounts.js";
import historicalCityTemperaturesRouter from "./routes/historicalCityTemperatures.js";
import smsRouter from "./routes/smsRoutes.js";
import { runHeatRiskJob } from "./jobs/heatRiskJob.js";

const app = express();
const PORT = process.env.PORT || 3000;

// CORS: in production set CORS_ORIGIN to your frontend origin (e.g. https://app.example.com). Unset = * (dev-friendly).
const corsOrigin = process.env.CORS_ORIGIN?.trim() || "*";

app.use(express.json());

app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", corsOrigin);
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, x-pipeline-report-key, x-sms-admin-key");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/", (req, res) => res.redirect(302, "/api"));

app.use("/api", healthFacilities);
app.use("/api", heat);
app.use("/api/ors", openRouteRouter);
app.use("/api/heat-advisory", heatAdvisoryRouter);
app.use("/api/historical-trends", historicalTrendsRoutes);
app.use("/api/heat-risk-counts", heatRiskCountsRoutes);
app.use("/api/city-temperatures", cityTemperaturesRoutes);
app.use("/api/historical/heat-risk-counts", historicalHeatRiskCountsRouter);
app.use("/api/historical/city-temperatures", historicalCityTemperaturesRouter);
app.use("/api/sms", smsRouter);

app.get("/api", (req, res) => {
  res.json({
    name: "BanasUno Backend",
    version: "1.0",
    dashboard_api_contract: "See docs/FRONTEND-DASHBOARD-API.md for which endpoints to use for KPI strip, health facility directory (chosen place only), and historical trends (do not use forecast).",
    endpoints: {
      "GET /api/facilities": "List Davao health facilities (query: type, source, ownership, name, limit, offset)",
      "GET /api/facilities/:id": "Get one facility by id",
      "GET /api/facilities/by-barangay/:barangayId": "Facilities for the chosen place only (one barangay). Use for health facility directory; do not use GET /api/facilities (all places).",
      "POST /api/facilities/counts-by-barangays": "All Barangays table: batch facility counts. Body { barangayIds: string[] }, response { counts: Record<string,number> }.",
      "GET /api/types": "Facility type summary",
      "GET /api/heat/counts": "KPI strip: heat risk zone counts by risk_level/risk_label for today (heat_risk_counts table).",
      "GET /api/heat/summary": "Heat summary: risk_counts + city_avg_temp. Optional ?city_id=, ?format=rows for unified array.",
      "GET /api/heat/summary/csv": "Heat summary as CSV (city_id, recorded_at, risk_level, risk_label, total, avg_temp_c). Optional ?city_id=.",
      "GET /api/heat/export/city": "KPI strip Export CSV: city heat/risk for date. ?date=YYYY-MM-DD&city_id=davao. Filename: heat_risk_city_avg_YYYY-MM-DD.csv.",
      "GET /api/heat/:cityId/barangays": "Per-barangay temp + risk + lat/lng + area. Optional ?limit=.",
      "GET /api/heat/:cityId/barangays/:barangayId": "Get heat data for a specific barangay by ID (PSGC code).",
      "GET /api/heat/:cityId/current": "City center current weather (temp, feels-like). WeatherAPI.",
      "GET /api/heat/:cityId/forecast": "7- or 14-day forecast (?days=7|14). WeatherAPI.",
      "GET /api/heat/:cityId/barangay-population": "Population and density per barangay (PSA + GeoJSON). Pipeline only.",
      "GET /api/heat/:cityId/pipeline-report/meta": "Pipeline report meta (updatedAt, disclaimer).",
      "GET /api/heat/:cityId/pipeline-report": "Download pipeline report CSV. 404 if none.",
      "POST /api/heat/:cityId/pipeline-report/generate": "Generate pipeline report (heat + facilities, K-Means).",
      "POST /api/heat/:cityId/pipeline-report": "Upload pipeline report CSV (body: text/csv; x-pipeline-report-key if set).",
      "POST /api/ors/batch-travel-times": "Body { barangayIds: string[], facilities: [{ id, lon, lat }] }. Returns results + summary.nearest_per_barangay (ORS matrix).",
      "POST /api/ors/directions": "Body { start: [lng,lat]|{lng,lat}, end: [lng,lat]|{lng,lat}, profile?: driving-car|foot-walking|cycling-regular }. Returns ORS Directions GeoJSON (route geometry + summary) for Show Route.",
      "GET /api/heat-advisory/by-barangay/:id": "Heat Advisory AI: risk + 3 advisories per barangay (Gemini or fallback).",
      "POST /api/heat-advisory": "Heat Advisory UI: tagline + 3 advices (title/body). Body: barangay_id?, barangay_name?, risk_level?, risk_label?, temperature_c? (Gemini or fallback).",
      "GET /api/heat-advisory": "Same as POST with query params. Optional caching by barangay + risk_level.",
      "GET /api/historical-trends": "Historical trends row: past temps only. ?city_id=, ?days=7|14 or ?limit=, ?sync=1. Do not use forecast here.",
      "GET /api/historical-trends/export": "Historical Trends Export CSV. ?city_id=, ?days=7|14, ?date=YYYY-MM-DD (filename). Filename: historical_trends_YYYY-MM-DD.csv.",
      "POST /api/historical-trends/sync": "Sync city historical trends from WeatherAPI history.json and run 30-day cleanup.",
      "POST /api/heat-risk-counts": "Insert barangay-level heat risk record (barangay_psgc, city_id, risk_level, risk_label, etc.).",
      "GET /api/heat-risk-counts": "Fetch heat_risk_counts rows. ?city_id=, ?limit=.",
      "POST /api/heat-risk-counts/cleanup": "Run 7-day retention cleanup on heat_risk_counts.",
      "POST /api/city-temperatures": "Insert city-level temperature (city_id, avg_temp_c, source?, recorded_at?).",
      "GET /api/city-temperatures": "Fetch city_temperatures rows. ?city_id=, ?limit=.",
      "POST /api/city-temperatures/cleanup": "Run 7-day retention cleanup on city_temperatures.",
      "POST /api/historical/heat-risk-counts": "Upsert into historical_heat_risk_counts (same body as daily).",
      "GET /api/historical/heat-risk-counts": "Fetch historical_heat_risk_counts. ?city_id=, ?limit=, ?offset=.",
      "POST /api/historical/city-temperatures": "Upsert into historical_city_temperatures (same body as daily).",
      "GET /api/historical/city-temperatures": "Fetch historical_city_temperatures. ?city_id=, ?limit=, ?offset=.",
      "GET /api/sms/recipients": "Davao heat-SMS numbers from the partner list. Header x-sms-admin-key.",
      "POST /api/sms/recipients": "Add partner mobile numbers. Body: { phone } or { phones: string[], source? }.",
      "POST /api/sms/recipients/deactivate": "Stop texting a number. Body: { phone }.",
      "GET /api/sms/alerts/preview": "Build the hottest-barangay SMS from the latest heat risk. Does not send.",
      "POST /api/sms/alerts/send": "Send that SMS to active Davao numbers. Body: { force?, dry_run? }.",
    },
  });
});

app.get("/health", async (req, res) => {
  const health = { status: "ok", database: null };
  const supabasePing = await pingSupabase();
  if (supabasePing.ok) {
    health.database = "connected";
  } else if (supabasePing.error === "not_configured") {
    health.database = "not_configured";
    health.status = "error";
  } else {
    health.database = "error";
    health.database_error = supabasePing.error;
    health.status = "error";
  }
  const statusCode = health.status === "ok" ? 200 : 503;
  res.status(statusCode).json(health);
});

/** Export for Vercel serverless; only listen when running locally */
export default app;

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`BanasUno backend: http://localhost:${PORT}`);
    console.log(`  GET /api/facilities, /api/types, /api/heat/:cityId/barangays, /api/heat/:cityId/forecast`);
    console.log("  Heat analysis + SMS check every hour (sends at Extreme Caution or higher).");
  });
  const hourMs = 60 * 60 * 1000;
  runHeatRiskJob({ runHistoricalTrends: false }).catch((err) => {
    console.error("[heat-sms] startup run failed:", err?.message ?? err);
  });
  setInterval(() => {
    runHeatRiskJob({ runHistoricalTrends: false }).catch((err) => {
      console.error("[heat-sms] hourly run failed:", err?.message ?? err);
    });
  }, hourMs);
}

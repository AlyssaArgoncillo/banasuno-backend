/**
 * BanasUno backend – Express API with Supabase (Postgres).
 * Health facilities and pipeline report are stored in Postgres; seed with npm run seed:facilities.
 */

import "dotenv/config";
import express from "express";
import { pingSupabase } from "./lib/supabase.js";
import healthFacilities from "./routes/healthFacilities.js";
import heat from "./routes/heat.js";

const app = express();
const PORT = process.env.PORT || 3000;

// CORS: in production set CORS_ORIGIN to your frontend origin (e.g. https://app.example.com). Unset = * (dev-friendly).
const corsOrigin = process.env.CORS_ORIGIN?.trim() || "*";

app.use(express.json());

app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", corsOrigin);
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, x-pipeline-report-key");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/", (req, res) => res.redirect(302, "/api"));

app.use("/api", healthFacilities);
app.use("/api", heat);

app.get("/api", (req, res) => {
  res.json({
    name: "BanasUno Backend",
    version: "1.0",
    endpoints: {
      "GET /api/facilities": "List Davao health facilities (query: type, source, ownership, name, limit, offset)",
      "GET /api/facilities/:id": "Get one facility by id",
      "GET /api/facilities/by-barangay/:barangayId": "Facilities assigned to barangay by nearest barangay lat/lon only",
      "POST /api/facilities/counts-by-barangays": "Batch facility counts for many barangay IDs (body: { barangayIds: [] }, for AI pipeline)",
      "GET /api/types": "Facility type summary",
      "GET /api/heat/:cityId/barangays": "Per-barangay temp + risk + lat/lng + area. Optional ?limit=.",
      "GET /api/heat/:cityId/current": "City center current weather (temp, feels-like). WeatherAPI.",
      "GET /api/heat/:cityId/forecast": "7- or 14-day forecast (?days=7|14). WeatherAPI.",
      "GET /api/heat/:cityId/barangay-population": "Population and density per barangay (PSA + GeoJSON). Pipeline only.",
      "GET /api/heat/:cityId/pipeline-report/meta": "Pipeline report meta (updatedAt, disclaimer).",
      "GET /api/heat/:cityId/pipeline-report": "Download pipeline report CSV. 404 if none.",
      "POST /api/heat/:cityId/pipeline-report/generate": "Generate pipeline report (heat + facilities, K-Means).",
      "POST /api/heat/:cityId/pipeline-report": "Upload pipeline report CSV (body: text/csv; x-pipeline-report-key if set).",
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
  });
}

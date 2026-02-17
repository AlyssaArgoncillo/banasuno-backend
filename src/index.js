/**
 * BanasUno backend – Express API with Redis.
 * Health facilities (Davao City) are served from Redis; seed with npm run seed:facilities.
 */

import express from "express";
import { redis } from "./lib/redis.js";
import healthFacilities from "./routes/healthFacilities.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use("/api", healthFacilities);

app.get("/api", (req, res) => {
  res.json({
    name: "BanasUno Backend",
    version: "1.0",
    endpoints: {
      "GET /api/facilities": "List Davao health facilities (query: type, source, ownership, name, limit, offset)",
      "GET /api/facilities/:id": "Get one facility by id",
      "GET /api/types": "Facility type summary",
    },
  });
});

app.get("/health", async (req, res) => {
  try {
    await redis.ping();
    res.json({ status: "ok", redis: "connected" });
  } catch (e) {
    res.status(503).json({ status: "error", redis: "disconnected" });
  }
});

app.listen(PORT, () => {
  console.log(`BanasUno backend: http://localhost:${PORT}`);
  console.log(`  GET /api/facilities, /api/facilities/:id, /api/types`);
});

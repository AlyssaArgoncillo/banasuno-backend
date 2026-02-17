/**
 * Davao City health facilities API – reads from Redis.
 * Data is stored at key health:facilities:davao (JSON array).
 * Seed with: npm run seed:facilities
 */

import { Router } from "express";
import { redis } from "../lib/redis.js";

const FACILITIES_KEY = "health:facilities:davao";
const router = Router();

async function getFacilities() {
  const raw = await redis.get(FACILITIES_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/** GET /api/facilities – list with optional filters */
router.get("/facilities", async (req, res) => {
  try {
    let list = await getFacilities();
    const { type, source, ownership, name, limit = "100", offset = "0" } = req.query;

    if (type) {
      const t = String(type).toLowerCase();
      list = list.filter((f) => (f.facility_type || "").toLowerCase().includes(t));
    }
    if (source) {
      list = list.filter((f) => (f.source || "").toLowerCase() === String(source).toLowerCase());
    }
    if (ownership) {
      list = list.filter((f) => (f.ownership || "").toLowerCase() === String(ownership).toLowerCase());
    }
    if (name) {
      const n = String(name).toLowerCase();
      list = list.filter((f) => (f.name || "").toLowerCase().includes(n));
    }

    const total = list.length;
    const off = Math.max(0, parseInt(offset, 10) || 0);
    const lim = Math.min(500, Math.max(1, parseInt(limit, 10) || 100));
    const facilities = list.slice(off, off + lim);

    res.json({ total, offset: off, limit: lim, facilities });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch facilities" });
  }
});

/** GET /api/facilities/:id */
router.get("/facilities/:id", async (req, res) => {
  try {
    const list = await getFacilities();
    const id = req.params.id;
    const facility = list.find((f) => String(f.id) === String(id));
    if (!facility) return res.status(404).json({ error: "Facility not found", id });
    res.json(facility);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch facility" });
  }
});

/** GET /api/types – facility type summary */
router.get("/types", async (req, res) => {
  try {
    const list = await getFacilities();
    const counts = {};
    list.forEach((f) => {
      const t = (f.facility_type || "unknown").trim();
      counts[t] = (counts[t] || 0) + 1;
    });
    const by_type = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({ type, count }));
    res.json({ total: list.length, by_type });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch types" });
  }
});

export default router;

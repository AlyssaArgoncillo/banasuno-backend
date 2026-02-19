/**
 * Davao City health facilities API – reads from Redis.
 * Data is stored at key health:facilities:davao (JSON array).
 * Seed with: npm run seed:facilities
 */

import { Router } from "express";
import { redis } from "../lib/redis.js";
import { assessFacilitiesInBarangay } from "../services/facilitiesByBarangay.js";
import { FACILITIES_KEY } from "../lib/constants.js";

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

/** POST /api/facilities/counts-by-barangays – batch facility counts for many barangays (e.g. for AI pipeline). Body: { "barangayIds": ["id1", "id2", ...] }. Response: { "counts": { "id1": 3, "id2": 0, ... } }. */
router.post("/facilities/counts-by-barangays", async (req, res) => {
  try {
    const ids = req.body?.barangayIds;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "barangayIds array required and non-empty" });
    }
    const facilities = await getFacilities();
    const counts = {};
    for (const barangayId of ids) {
      const bid = String(barangayId ?? "").trim();
      if (!bid) continue;
      const result = await assessFacilitiesInBarangay(bid, facilities);
      counts[bid] = result.found ? result.total : 0;
    }
    return res.json({ counts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch facility counts" });
  }
});

/** GET /api/facilities/by-barangay/:barangayId – must be before /facilities/:id so "by-barangay" is not matched as id */
router.get("/facilities/by-barangay/:barangayId", async (req, res) => {
  try {
    const barangayId = req.params.barangayId?.trim();
    if (!barangayId) {
      return res.status(400).json({ error: "barangayId required" });
    }
    const facilities = await getFacilities();
    const result = await assessFacilitiesInBarangay(barangayId, facilities);
    if (!result.found) {
      return res.status(404).json({
        error: "Barangay not found",
        barangayId: result.barangayId,
        hint: "Use a Davao barangay id (e.g. PSGC adm4_psgc from the heat map GeoJSON)",
      });
    }
    res.json({
      barangayId: result.barangayId,
      total: result.total,
      facilities: result.facilities,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to assess facilities in barangay" });
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

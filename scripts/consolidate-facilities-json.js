/**
 * Consolidate data/davao-health-facilities.json:
 * - Sort by id (numeric)
 * - Trim string values
 * - Fix address_other.addr_stree → addr_street
 * - Deduplicate by id (keep first)
 * - Consistent key order
 *
 * Run: node scripts/consolidate-facilities-json.js
 */

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const path = join(__dirname, "..", "data", "davao-health-facilities.json");

const KEY_ORDER = [
  "id", "source", "name", "facility_type", "ownership",
  "latitude", "longitude", "address", "address_street", "address_house_number",
  "address_postcode", "barangay", "district", "city", "address_other",
  "phone", "operator", "opening_hours", "beds", "emergency", "url"
];

function trimString(v) {
  return typeof v === "string" ? v.trim() : v;
}

function fixAddressOther(obj) {
  if (obj && typeof obj === "object" && "addr_stree" in obj) {
    obj.addr_street = trimString(obj.addr_stree);
    delete obj.addr_stree;
  }
  return obj;
}

function consolidateItem(item) {
  const out = {};
  for (const key of KEY_ORDER) {
    if (!(key in item)) continue;
    let v = item[key];
    if (typeof v === "string") v = trimString(v);
    else if (key === "address_other" && v && typeof v === "object") {
      v = fixAddressOther({ ...v });
    }
    out[key] = v;
  }
  // any extra keys
  for (const key of Object.keys(item)) {
    if (!(key in out)) {
      let v = item[key];
      if (typeof v === "string") v = trimString(v);
      out[key] = v;
    }
  }
  return out;
}

const raw = readFileSync(path, "utf8");
let data = JSON.parse(raw);
if (!Array.isArray(data)) {
  console.error("JSON root must be an array");
  process.exit(1);
}

const seen = new Set();
data = data.filter((item) => {
  const id = item && item.id;
  if (seen.has(id)) return false;
  seen.add(id);
  return true;
});

data = data.map(consolidateItem);
data.sort((a, b) => {
  const na = Number(a.id);
  const nb = Number(b.id);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return String(a.id).localeCompare(String(b.id));
});

writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
console.log("Consolidated:", data.length, "facilities written to", path);

/**
 * Combine facility_type into five categories; exclude facilities that don't match.
 *
 * Categories:
 *   health_center ← health_center, health_post
 *   hospital      ← hospital, hospital (public), hospital (private), general_hospital, medical_center
 *   clinic        ← clinic, clinic (public), medical_clinic
 *   pharmacy      ← pharmacy, pharmacy (private)
 *   doctors       ← doctors, doctors (private), doctors (public)
 *
 * All other types are excluded (e.g. blood_donation, dentist, laboratory).
 *
 * Run: node scripts/combine-facility-types.js
 */

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const path = join(__dirname, "..", "data", "davao-health-facilities.json");

const TYPE_TO_CATEGORY = {
  health_center: "health_center",
  health_post: "health_center",
  hospital: "hospital",
  "hospital (public)": "hospital",
  "hospital (private)": "hospital",
  general_hospital: "hospital",
  medical_center: "hospital",
  clinic: "clinic",
  "clinic (public)": "clinic",
  medical_clinic: "clinic",
  pharmacy: "pharmacy",
  "pharmacy (private)": "pharmacy",
  doctors: "doctors",
  "doctors (private)": "doctors",
  "doctors (public)": "doctors",
};

const data = JSON.parse(readFileSync(path, "utf8"));
if (!Array.isArray(data)) {
  console.error("JSON root must be an array");
  process.exit(1);
}

const before = data.length;
const combined = [];
const excluded = [];

for (const f of data) {
  const raw = (f.facility_type || "").trim();
  const category = TYPE_TO_CATEGORY[raw];
  if (category) {
    combined.push({ ...f, facility_type: category });
  } else {
    excluded.push({ id: f.id, name: f.name, facility_type: raw });
  }
}

writeFileSync(path, JSON.stringify(combined, null, 2), "utf8");
console.log("Combined facility types:");
console.log("  Included:", combined.length, "(health_center, hospital, clinic, pharmacy, doctors)");
console.log("  Excluded:", excluded.length);
if (excluded.length) {
  console.log("  Excluded facilities:", excluded.map((e) => `${e.facility_type}: ${e.name || e.id}`).join("; "));
}
console.log("Written to", path);

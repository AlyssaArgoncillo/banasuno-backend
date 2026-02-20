/**
 * Seed Supabase (Postgres) with Davao City health facilities from JSON.
 *
 * Set FACILITIES_JSON_PATH to the path to davao-health-facilities.json, e.g.:
 *   - Linux/macOS (bash/zsh): FACILITIES_JSON_PATH=/path/to/davao-health-facilities.json
 *   - Windows (PowerShell):  $env:FACILITIES_JSON_PATH="C:\path\to\davao-health-facilities.json"
 *   - Windows (cmd):         set FACILITIES_JSON_PATH=C:\path\to\davao-health-facilities.json
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.
 *
 * Run: npm run seed:facilities
 */

import "dotenv/config";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { setFacilities } from "../src/lib/store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const defaultPath = join(__dirname, "..", "data", "davao-health-facilities.json");
const jsonPath = process.env.FACILITIES_JSON_PATH || defaultPath;

async function main() {
  let facilities;
  try {
    const raw = readFileSync(jsonPath, "utf8");
    facilities = JSON.parse(raw);
  } catch (err) {
    console.error("Failed to read facilities JSON:", err.message);
    console.error("Path used:", jsonPath);
    console.error("Set FACILITIES_JSON_PATH to your Philippines repo JSON, e.g.:");
    console.error("  Linux/macOS (bash/zsh): export FACILITIES_JSON_PATH=/path/to/davao-health-facilities.json");
    console.error('  Windows (PowerShell):  $env:FACILITIES_JSON_PATH="C:\\path\\to\\davao-health-facilities.json"');
    console.error("  Windows (cmd):         set FACILITIES_JSON_PATH=C:\\path\\to\\davao-health-facilities.json");
    process.exit(1);
  }

  if (!Array.isArray(facilities)) {
    console.error("JSON must be an array of facilities.");
    process.exit(1);
  }

  try {
    await setFacilities(facilities);
    console.log("Seeded Supabase (health_facilities_davao):", facilities.length, "facilities");
  } catch (err) {
    console.error("Failed to write to Supabase:", err.message);
    console.error("Ensure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set and the migration has been run.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

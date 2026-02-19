/**
 * Seed Redis with Davao City health facilities from JSON.
 *
 * Set FACILITIES_JSON_PATH to the path to davao-health-facilities.json, e.g.:
 *   - Linux/macOS (bash/zsh): FACILITIES_JSON_PATH=/path/to/davao-health-facilities.json
 *   - Windows (PowerShell):  $env:FACILITIES_JSON_PATH="C:\path\to\davao-health-facilities.json"
 *   - Windows (cmd):         set FACILITIES_JSON_PATH=C:\path\to\davao-health-facilities.json
 *
 * Or copy/link the file into this repo and point to it.
 *
 * Run: npm run seed:facilities
 */

import "dotenv/config";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import Redis from "ioredis";
import { FACILITIES_KEY } from "../src/lib/constants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
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

  const redis = new Redis(redisUrl);
  try {
    await redis.set(FACILITIES_KEY, JSON.stringify(facilities));
    const len = await redis.strlen(FACILITIES_KEY);
    console.log("Seeded Redis:", facilities.length, "facilities");
    console.log("Key:", FACILITIES_KEY, "(", len, "bytes )");
  } finally {
    redis.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

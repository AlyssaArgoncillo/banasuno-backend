/**
 * Test pushing data into Supabase (heat_snapshots + heat_snapshot_barangays).
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.
 *
 * Run from repo root: node scripts/test-supabase-push.js
 */

import "dotenv/config";
import { supabase, isSupabaseConfigured } from "../src/lib/supabase.js";

async function main() {
  if (!isSupabaseConfigured) {
    console.error("Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env");
    process.exit(1);
  }

  const recordedAt = new Date().toISOString();

  // 1. Insert summary row into heat_snapshots
  const summary = {
    city_id: "davao",
    recorded_at: recordedAt,
    temp_min: 25.0,
    temp_max: 32.5,
    temp_avg: 28.2,
    count_not_hazardous: 2,
    count_caution: 1,
    count_extreme_caution: 0,
    count_danger: 0,
    count_extreme_danger: 0,
    source: "test-script",
  };

  const { data: snapshotRow, error: snapError } = await supabase
    .from("heat_snapshots")
    .insert(summary)
    .select("id")
    .single();

  if (snapError) {
    console.error("Insert into heat_snapshots failed:", snapError.message);
    console.error("Hint: ensure tables exist (see docs/DATA_EXPORT.md §3).");
    process.exit(1);
  }

  const snapshotId = snapshotRow.id;
  console.log("Inserted heat_snapshots row:", snapshotId);

  // 2. Insert per-barangay rows into heat_snapshot_barangays
  const barangays = [
    {
      snapshot_id: snapshotId,
      barangay_id: "1130700001",
      barangay_name: "Test Barangay 1",
      temperature_c: 26.2,
      heat_index_level: 1,
      heat_index_label: "Not Hazardous",
    },
    {
      snapshot_id: snapshotId,
      barangay_id: "1130700002",
      barangay_name: "Test Barangay 2",
      temperature_c: 30.1,
      heat_index_level: 2,
      heat_index_label: "Caution",
    },
  ];

  const { data: barangayRows, error: barError } = await supabase
    .from("heat_snapshot_barangays")
    .insert(barangays)
    .select("id, barangay_id, temperature_c");

  if (barError) {
    console.error("Insert into heat_snapshot_barangays failed:", barError.message);
    process.exit(1);
  }

  console.log("Inserted heat_snapshot_barangays rows:", barangayRows.length);
  console.log("Done. Check Supabase Table Editor for heat_snapshots and heat_snapshot_barangays.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

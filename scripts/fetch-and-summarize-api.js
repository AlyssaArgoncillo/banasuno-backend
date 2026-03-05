/**
 * Fetch main API endpoints and print an organized summary.
 * Run: node scripts/fetch-and-summarize-api.js [BASE_URL]
 * Default BASE_URL: http://localhost:3000
 */

const BASE = process.argv[2] || "http://localhost:3000";

async function fetchJSON(path) {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json();
}

async function postJSON(path, body) {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json();
}

function section(title) {
  console.log("\n" + "=".repeat(60));
  console.log(title);
  console.log("=".repeat(60));
}

function table(headers, rows) {
  const widths = headers.map((h, i) =>
    Math.max(String(h).length, ...rows.map((r) => String(r[i] ?? "").length))
  );
  const line = widths.map((w) => "-".repeat(w)).join("-+-");
  console.log(headers.map((h, i) => String(h).padEnd(widths[i])).join(" | "));
  console.log(line);
  rows.forEach((row) =>
    console.log(row.map((c, i) => String(c ?? "").padEnd(widths[i])).join(" | "))
  );
}

async function main() {
  console.log("\nBanasUno API – organized summary");
  console.log("Base URL:", BASE);

  try {
    // --- Facilities ---
    section("1. Facilities (GET /api/facilities)");
    const facilities = await fetchJSON("/api/facilities");
    console.log("Total:", facilities.total);
    console.log("Offset:", facilities.offset, "| Limit:", facilities.limit);
    console.log("Sample (first 3):");
    (facilities.facilities || []).slice(0, 3).forEach((f, i) => {
      console.log(`  ${i + 1}. ${f.name} (${f.facility_type}) – ${f.barangay || f.city}`);
    });

    // --- Types ---
    section("2. Facility types (GET /api/types)");
    const types = await fetchJSON("/api/types");
    console.log("Total facilities:", types.total);
    const byType = types.by_type || [];
    table(["Type", "Count"], byType.map((t) => [t.type, t.count]));

    // --- Barangays heat ---
    section("3. Heat – Barangays (GET /api/heat/davao/barangays)");
    const barangays = await fetchJSON("/api/heat/davao/barangays");
    const list = barangays.barangays || [];
    console.log("Barangays count:", list.length);
    console.log("Updated at:", barangays.updatedAt);
    if (barangays.meta?.legend) {
      console.log("\nRisk legend:");
      barangays.meta.legend.forEach((l) =>
        console.log(`  Level ${l.level}: ${l.label} (${l.range})`)
      );
    }
    console.log("\nSample (first 5):");
    table(
      ["barangay_id", "temp_c", "risk.level", "risk.label", "area_km2"],
      list.slice(0, 5).map((b) => [
        b.barangay_id,
        b.temp_c,
        b.risk?.level,
        b.risk?.label,
        b.area_km2,
      ])
    );

    // --- Forecast ---
    section("4. Heat – Forecast (GET /api/heat/davao/forecast)");
    const forecast = await fetchJSON("/api/heat/davao/forecast");
    const days = forecast.forecastDay || [];
    console.log("City:", forecast.cityId);
    console.log("Location:", forecast.location?.name, forecast.location?.region);
    console.log("Days:", days.length);
    console.log("\nForecast:");
    table(
      ["date", "avgtemp_c", "condition", "chance_of_rain"],
      days.map((d) => [
        d.date,
        d.avgtemp_c,
        (d.condition || "").slice(0, 20),
        d.daily_chance_of_rain,
      ])
    );

    // --- Historical sync (optional; comment out if you don't want to run sync)
    section("5. Historical trends sync (POST /api/historical-trends/sync)");
    console.log("Skipping POST in summary (use curl to run sync).");
    console.log("Example: curl -X POST " + BASE + "/api/historical-trends/sync \\");
    console.log('  -H "Content-Type: application/json" -d \'{"city_id":"davao","days":14}\'');

    console.log("\n" + "=".repeat(60));
    console.log("Done.");
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
}

main();

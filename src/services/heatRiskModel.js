/**
 * Heuristic heat-risk model (rule-based "AI").
 * Uses PAGASA heat index categories (temperature °C) as the basis for risk levels.
 * Source: https://www.pagasa.dost.gov.ph/weather/heat-index
 *
 * PAGASA categories:
 *   Not Hazardous:  < 27°C
 *   Caution:        27–32°C
 *   Extreme Caution: 33–41°C
 *   Danger:         42–51°C
 *   Extreme Danger: ≥ 52°C
 *
 * Temperature input: barangay-level temperatures (e.g. from Meteosource per centroid).
 */

function clamp(x, min, max) {
  return Math.min(max, Math.max(min, x));
}

function round1(x) {
  return Math.round(x * 10) / 10;
}

/** PAGASA-based heat index levels (5 categories). Source: https://www.pagasa.dost.gov.ph/weather/heat-index */
export const HEAT_LEVELS = [
  { level: 1, label: "Not Hazardous", range: "< 27°C", color: "#48bb78" },
  { level: 2, label: "Caution", range: "27–32°C", color: "#ecc94b" },
  { level: 3, label: "Extreme Caution", range: "33–41°C", color: "#ed8936" },
  { level: 4, label: "Danger", range: "42–51°C", color: "#f97316" },
  { level: 5, label: "Extreme Danger", range: "≥ 52°C", color: "#dc2626" },
];

/**
 * Map air temperature (°C) to PAGASA category and a normalized score [0, 1].
 * Bands: <27, 27–32, 33–41, 42–51, ≥52.
 */
function tempToPAGASALevel(tempC) {
  const t = tempC;
  if (t < 27) return { level: 1, label: "Not Hazardous", score: 0.1 };
  if (t <= 32) return { level: 2, label: "Caution", score: 0.2 + ((t - 27) / 5) * 0.2 };
  if (t <= 41) return { level: 3, label: "Extreme Caution", score: 0.4 + ((t - 33) / 8) * 0.2 };
  if (t <= 51) return { level: 4, label: "Danger", score: 0.6 + ((t - 42) / 9) * 0.2 };
  return { level: 5, label: "Extreme Danger", score: 0.8 + Math.min(0.2, (t - 52) / 20) };
}

/**
 * Assess heat risk per barangay using PAGASA heat index categories.
 * Uses barangay-level temperatures (e.g. from Meteosource per centroid).
 *
 * @param {{ [barangayId: string]: number }} temperatures - Barangay-level temps (°C), e.g. from Meteosource
 * @param {{ averageTemp?: number }} opts - Optional city average (e.g. from WeatherAPI) for delta adjustment
 * @returns {{
 *   risks: { [barangayId: string]: { score: number, level: number, label: string, temp_c: number, delta_c: number } },
 *   averageTemp: number | undefined,
 *   minScore: number | undefined,
 *   maxScore: number | undefined,
 *   counts: { not_hazardous: number, caution: number, extreme_caution: number, danger: number, extreme_danger: number },
 *   legend: Array<{ level: number, label: string, range: string, color: string }>,
 *   basis: string
 * }}
 */
export function assessBarangayHeatRisk(temperatures, opts = {}) {
  const entries = Object.entries(temperatures || {}).filter(([, v]) => typeof v === "number");
  const computedAvg =
    entries.length ? entries.reduce((sum, [, v]) => sum + v, 0) / entries.length : undefined;
  const avg = typeof opts.averageTemp === "number" ? opts.averageTemp : computedAvg;

  const risks = {};
  const counts = { not_hazardous: 0, caution: 0, extreme_caution: 0, danger: 0, extreme_danger: 0 };
  const countKey = (label) => label.toLowerCase().replace(/\s+/g, "_");
  let minScore;
  let maxScore;

  for (const [id, temp] of entries) {
    const pagasa = tempToPAGASALevel(temp);
    const delta = typeof avg === "number" ? temp - avg : 0;
    const deltaAdj = typeof avg === "number" ? clamp(delta * 0.03, -0.15, 0.15) : 0;
    const score = clamp(pagasa.score + deltaAdj, 0, 1);

    risks[id] = {
      score: round1(score),
      level: pagasa.level,
      label: pagasa.label,
      temp_c: round1(temp),
      delta_c: round1(delta),
    };

    counts[countKey(pagasa.label)] += 1;
    minScore = minScore == null ? score : Math.min(minScore, score);
    maxScore = maxScore == null ? score : Math.max(maxScore, score);
  }

  return {
    risks,
    averageTemp: typeof avg === "number" ? round1(avg) : undefined,
    minScore: minScore == null ? undefined : round1(minScore),
    maxScore: maxScore == null ? undefined : round1(maxScore),
    counts,
    legend: HEAT_LEVELS,
    basis: "PAGASA heat index (https://www.pagasa.dost.gov.ph/weather/heat-index)",
  };
}


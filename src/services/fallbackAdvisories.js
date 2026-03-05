/**
 * Static fallback advisories when Gemini AI is unavailable.
 * Three advisories per PAGASA level: primary health guidance, preventive measure, support resource.
 * PAGASA: https://www.pagasa.dost.gov.ph/weather/heat-index
 */

/** @type {Record<string, [string, string, string]>} PAGASA label → [primary, preventive, support] */
export const FALLBACK_ADVISORIES = {
  "Not Hazardous": [
    "Conditions are comfortable; no heat-related health advisory. Stay hydrated and dress for the weather.",
    "Continue normal outdoor activity. Use sunscreen and take breaks in shade if spending long periods outside.",
    "For heat information: PAGASA heat index bulletins and local health offices (DOH).",
  ],
  Caution: [
    "Heat stress is possible with prolonged exposure. Increase fluid intake and limit strenuous activity during the hottest hours.",
    "Wear light, loose clothing; seek shade; avoid prolonged sun exposure between 10 AM and 4 PM.",
    "Contact barangay health station or nearest health facility if you feel dizzy, weak, or unusually tired.",
  ],
  "Extreme Caution": [
    "Heat cramps and heat exhaustion are possible. Stay in cool or air-conditioned spaces when possible and drink water regularly.",
    "Reduce outdoor work and exercise; take frequent rest in shade; never leave children or pets in parked vehicles.",
    "Seek medical advice if you experience heavy sweating, weakness, nausea, or headache. Call local health hotline or visit nearest clinic.",
  ],
  Danger: [
    "Heat exhaustion likely and heat stroke possible with prolonged exposure. Move to a cool place immediately if you feel unwell.",
    "Avoid outdoor activities during peak heat. Use fans, cool showers, and stay hydrated. Check on elderly and vulnerable neighbors.",
    "In case of heat stroke (high body temperature, confusion, loss of consciousness): call emergency services and cool the person while waiting.",
  ],
  "Extreme Danger": [
    "Heat stroke is imminent. Outdoor exposure is dangerous. Remain indoors in air conditioning or cool, shaded areas.",
    "Do not engage in outdoor work or exercise. Keep windows/curtains closed during day; use fans and cool compresses. Ensure adequate drinking water.",
    "Emergency: If someone shows signs of heat stroke (hot skin, confusion, seizures), call 911 or emergency services and start cooling measures immediately.",
  ],
};

/**
 * Get exactly three advisories for a PAGASA level.
 * @param {string} pagasaLabel - One of: Not Hazardous, Caution, Extreme Caution, Danger, Extreme Danger
 * @returns {[string, string, string]} [primary health guidance, preventive measure, support resource]
 */
export function getFallbackAdvisories(pagasaLabel) {
  const key = String(pagasaLabel || "").trim();
  const set = FALLBACK_ADVISORIES[key] ?? FALLBACK_ADVISORIES["Not Hazardous"];
  return [...set];
}

/** Canonical PAGASA labels (must match keys in FALLBACK_TAGLINE_AND_ADVICES). Used for case-insensitive lookup. */
const PAGASA_LABELS = [
  "Not Hazardous",
  "Caution",
  "Extreme Caution",
  "Danger",
  "Extreme Danger",
];

/** risk_level 1–5 → canonical label (same order as PAGASA). */
const LEVEL_TO_LABEL = {
  1: "Not Hazardous",
  2: "Caution",
  3: "Extreme Caution",
  4: "Danger",
  5: "Extreme Danger",
};

/** Tagline + advices (title + body) per PAGASA level for Heat Advisory UI (Gemini fallback). */
const FALLBACK_TAGLINE_AND_ADVICES = {
  "Not Hazardous": {
    tagline: "Conditions are comfortable. Stay hydrated and dress for the weather.",
    advices: [
      { title: "Stay Hydrated", body: "Conditions are comfortable; no heat-related health advisory. Continue normal fluid intake and dress for the weather." },
      { title: "Normal Outdoor Activity", body: "Continue normal outdoor activity. Use sunscreen and take breaks in shade if spending long periods outside." },
      { title: "Heat Information", body: "For heat information: PAGASA heat index bulletins and local health offices (DOH)." },
    ],
  },
  Caution: {
    tagline: "Heat is noticeable. Make smart choices throughout the day.",
    advices: [
      { title: "Stay Hydrated", body: "Heat stress is possible with prolonged exposure. Increase fluid intake and limit strenuous activity during the hottest hours." },
      { title: "Limit Outdoor Exposure", body: "Wear light, loose clothing; seek shade; avoid prolonged sun exposure between 10 AM and 4 PM." },
      { title: "Know When to Seek Help", body: "Contact barangay health station or nearest health facility if you feel dizzy, weak, or unusually tired." },
    ],
  },
  "Extreme Caution": {
    tagline: "Heat cramps and exhaustion are possible. Stay cool and drink water regularly.",
    advices: [
      { title: "Stay Hydrated", body: "Heat cramps and heat exhaustion are possible. Stay in cool or air-conditioned spaces when possible and drink water regularly." },
      { title: "Limit Outdoor Exposure", body: "Reduce outdoor work and exercise; take frequent rest in shade; never leave children or pets in parked vehicles." },
      { title: "Seek Medical Advice", body: "Seek medical advice if you experience heavy sweating, weakness, nausea, or headache. Call local health hotline or visit nearest clinic." },
    ],
  },
  Danger: {
    tagline: "Heat exhaustion likely; heat stroke possible. Avoid peak heat and stay in cool places.",
    advices: [
      { title: "Move to a Cool Place", body: "Heat exhaustion likely and heat stroke possible with prolonged exposure. Move to a cool place immediately if you feel unwell." },
      { title: "Limit Outdoor Exposure", body: "Avoid outdoor activities during peak heat. Use fans, cool showers, and stay hydrated. Check on elderly and vulnerable neighbors." },
      { title: "Emergency: Heat Stroke", body: "In case of heat stroke (high body temperature, confusion, loss of consciousness): call emergency services and cool the person while waiting." },
    ],
  },
  "Extreme Danger": {
    tagline: "Heat stroke is imminent. Remain indoors in cool or air-conditioned areas.",
    advices: [
      { title: "Remain Indoors", body: "Heat stroke is imminent. Outdoor exposure is dangerous. Remain indoors in air conditioning or cool, shaded areas." },
      { title: "Keep Your Space Cool", body: "Do not engage in outdoor work or exercise. Keep windows/curtains closed during day; use fans and cool compresses. Ensure adequate drinking water." },
      { title: "Emergency", body: "If someone shows signs of heat stroke (hot skin, confusion, seizures), call 911 or emergency services and start cooling measures immediately." },
    ],
  },
};

/**
 * Resolve canonical PAGASA label for lookup (case-insensitive, or by level 1–5).
 * @param {string} [riskLabel]
 * @param {number} [riskLevel] - Optional 1–5; takes precedence if valid
 * @returns {string} Canonical key for FALLBACK_TAGLINE_AND_ADVICES
 */
function resolveCanonicalLabel(riskLabel, riskLevel) {
  const level = riskLevel != null ? Number(riskLevel) : NaN;
  if (level >= 1 && level <= 5 && Number.isInteger(level)) {
    const byLevel = LEVEL_TO_LABEL[level];
    if (byLevel) return byLevel;
  }
  const label = String(riskLabel || "").trim();
  if (!label) return "Caution";
  const lower = label.toLowerCase();
  const found = PAGASA_LABELS.find((l) => l.toLowerCase() === lower);
  return found || "Caution";
}

/**
 * Get tagline + advices (title + body) for the Heat Advisory UI when Gemini is unavailable.
 * @param {string} [riskLabel] - e.g. "Not Hazardous", "Caution", "Extreme Caution", "Danger", "Extreme Danger (case-insensitive)
 * @param {number} [riskLevel] - Optional 1–5; if provided and valid, used to select the level (overrides riskLabel)
 * @returns {{ tagline: string, advices: Array<{ title: string, body: string }> }}
 */
export function getFallbackAdvisoryForFrontend(riskLabel, riskLevel) {
  const key = resolveCanonicalLabel(riskLabel, riskLevel);
  const data = FALLBACK_TAGLINE_AND_ADVICES[key] ?? FALLBACK_TAGLINE_AND_ADVICES["Caution"];
  return { tagline: data.tagline, advices: [...data.advices] };
}

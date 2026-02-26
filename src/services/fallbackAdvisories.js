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

/**
 * Heat Advisory AI: Gemini-generated advisories with static fallback.
 * Uses GEMINI_API_KEY from env via @google/genai SDK. Returns exactly three advisories per barangay.
 * Also supports frontend contract: tagline + advices (title + body) via getHeatAdvisoryForFrontend.
 */

import { GoogleGenAI } from "@google/genai";
import { getFallbackAdvisories, getFallbackAdvisoryForFrontend } from "./fallbackAdvisories.js";

function getAI() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  return new GoogleGenAI(apiKey ? { apiKey } : {});
}

const ai = getAI();

function buildPrompt(barangayName, heatIndexC, pagasaLabel) {
  return `You are a public health advisor for the Philippines (PAGASA heat index guidelines).

Barangay: ${barangayName}
Current heat index: ${heatIndexC}°C
PAGASA category: ${pagasaLabel}

Generate exactly 3 short advisories for residents of this barangay. Use this exact order and format — one line per advisory, no numbering or bullets:
1) Primary health guidance
2) Preventive measure
3) Support resource

Write in clear, concise English. Each line must be one complete sentence or short paragraph. Output only these 3 lines, nothing else.`;
}

function parseAdvisoriesFromResponse(text) {
  if (!text || typeof text !== "string") return null;
  const lines = text
    .split(/\n/)
    .map((s) => s.replace(/^\s*[\d•\-*.]+\s*/, "").trim())
    .filter(Boolean);
  if (lines.length < 3) return null;
  return [lines[0], lines[1], lines[2]];
}

async function generateAdvisoriesWithGemini(barangayName, heatIndexC, pagasaLabel) {
  const prompt = buildPrompt(barangayName, heatIndexC, pagasaLabel);

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview", // or "gemini-1.5-flash"
      contents: prompt,
    });

    const text = response.text;
    const parsed = parseAdvisoriesFromResponse(text);
    return parsed ?? null;
  } catch (err) {
    console.error("[advisoryAI] Gemini API error:", err);
    return null;
  }
}

export async function getHeatAdvisories(barangayName, heatIndexC, pagasaLabel) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (apiKey) {
    const geminiAdvisories = await generateAdvisoriesWithGemini(barangayName, heatIndexC, pagasaLabel);
    if (geminiAdvisories) {
      return {
        advisories: geminiAdvisories,
        source: "Gemini AI",
        fallbackUsed: false,
      };
    }
  }

  const fallback = getFallbackAdvisories(pagasaLabel);
  return {
    advisories: fallback,
    source: "Fallback",
    fallbackUsed: true,
  };
}

// --- Frontend contract: tagline + advices (title + body) ---

function buildPromptForFrontend(barangayName, riskLevel, riskLabel, temperatureC) {
  const area = barangayName ? `Barangay/area: ${barangayName}.` : "No specific barangay selected (city-level advisory).";
  const temp = temperatureC != null && !Number.isNaN(Number(temperatureC))
    ? ` Current temperature: ${Number(temperatureC)}°C.`
    : "";
  return `You are a public health advisor for the Philippines using PAGASA heat index guidelines.

${area}
PAGASA risk level: ${riskLevel} (${riskLabel}).${temp}

Do NOT recalculate heat index. Use the provided risk level as authoritative.

Output a JSON object with exactly this structure (no markdown, no code fence):
{"tagline":"One short sentence summarizing the advisory for this risk level.","advices":[{"title":"Short title","body":"One to three sentences of recommendation."},{"title":"...","body":"..."},{"title":"...","body":"..."}]}

Rules:
- "tagline": one short sentence (e.g. "Heat is noticeable. Make smart choices throughout the day.").
- "advices": exactly 3 items. Each has "title" (e.g. "Stay Hydrated") and "body" (1–3 sentences).
- Write in clear, concise English. Align with PAGASA safety guidance for this risk level.
- Output only the JSON object, nothing else.`;
}

function parseTaglineAndAdvicesFromResponse(text) {
  if (!text || typeof text !== "string") return null;
  let raw = text.trim();
  const codeFence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeFence) raw = codeFence[1].trim();
  const start = raw.indexOf("{");
  if (start !== -1) {
    const end = raw.lastIndexOf("}");
    if (end > start) raw = raw.slice(start, end + 1);
  }
  try {
    const data = JSON.parse(raw);
    if (typeof data.tagline !== "string" || !Array.isArray(data.advices) || data.advices.length < 3) return null;
    const advices = data.advices.slice(0, 3).filter((a) => a && typeof a.title === "string" && typeof a.body === "string");
    if (advices.length < 3) return null;
    return { tagline: data.tagline.trim(), advices: advices.map((a) => ({ title: a.title.trim(), body: a.body.trim() })) };
  } catch {
    return null;
  }
}

/** After a Gemini 429, skip calling Gemini for this many ms to avoid burst of requests. */
const GEMINI_429_COOLDOWN_MS = 90 * 1000; // 90 seconds
let geminiCooldownUntil = 0;

async function generateAdvisoryForFrontendWithGemini(barangayName, riskLevel, riskLabel, temperatureC) {
  const prompt = buildPromptForFrontend(barangayName, riskLevel, riskLabel, temperatureC);
  const client = getAI();
  try {
    const response = await client.models.generateContent({
      model: "gemini-2.0-flash",
      contents: prompt,
    });
    const text = response?.text;
    if (!text) return null;
    return parseTaglineAndAdvicesFromResponse(text);
  } catch (err) {
    if (err?.status === 429) {
      geminiCooldownUntil = Date.now() + GEMINI_429_COOLDOWN_MS;
      console.warn("[advisoryAI] Gemini rate limit (429); serving static advisories for 90 s. Response matches requested risk level.");
    } else {
      console.error("[advisoryAI] Gemini API error (frontend advisory):", err?.message ?? err);
    }
    return null;
  }
}

/**
 * Get heat advisory for the frontend Heat Advisory UI: tagline + 3 advices (title + body).
 * Uses Gemini when GEMINI_API_KEY is set and Gemini succeeds; otherwise always returns static fallback.
 * @param {object} opts - { barangayId?, barangayName?, riskLevel?, riskLabel?, temperatureC? }
 * @returns {Promise<{ tagline: string, advices: Array<{ title: string, body: string }> }>}
 */
export async function getHeatAdvisoryForFrontend(opts = {}) {
  const defaultLabel = "Caution";
  const barangayName = opts.barangayName != null ? String(opts.barangayName).trim() : "";
  let riskLevel = opts.riskLevel != null ? Number(opts.riskLevel) : 2;
  if (!Number.isInteger(riskLevel) || riskLevel < 1 || riskLevel > 5) riskLevel = 2;
  const riskLabel = opts.riskLabel != null ? String(opts.riskLabel).trim() : defaultLabel;
  const temperatureC = opts.temperatureC != null ? Number(opts.temperatureC) : undefined;

  try {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    const inCooldown = Date.now() < geminiCooldownUntil;
    if (apiKey && !inCooldown) {
      const result = await generateAdvisoryForFrontendWithGemini(barangayName, riskLevel, riskLabel, temperatureC);
      if (result && typeof result.tagline === "string" && Array.isArray(result.advices) && result.advices.length >= 3) {
        return result;
      }
    }
    return getFallbackAdvisoryForFrontend(riskLabel, riskLevel);
  } catch (err) {
    console.error("[advisoryAI] Fallback used after error:", err?.message ?? err);
    try {
      return getFallbackAdvisoryForFrontend(riskLabel, riskLevel);
    } catch (fallbackErr) {
      console.error("[advisoryAI] Fallback failed, using default:", fallbackErr?.message ?? fallbackErr);
      return getFallbackAdvisoryForFrontend("Caution", 2);
    }
  }
}

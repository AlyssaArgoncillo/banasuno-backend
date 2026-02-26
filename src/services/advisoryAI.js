/**
 * Heat Advisory AI: Gemini-generated advisories with static fallback.
 * Uses GEMINI_API_KEY from env via @google/genai SDK. Returns exactly three advisories per barangay.
 */

import { GoogleGenAI } from "@google/genai";
import { getFallbackAdvisories } from "./fallbackAdvisories.js";

const ai = new GoogleGenAI({}); // GEMINI_API_KEY is read from .env

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

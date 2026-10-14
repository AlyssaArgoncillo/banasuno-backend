/**
 * City heat SMS.
 * After the hourly heat job, text the Davao numbers stored in sms_recipients
 * about the hottest barangay. The link (HEAT_ALERT_PAGE_URL) is the page the
 * other developer is building, which asks for the person's current location.
 *
 * Gateway: TextBee (https://textbee.dev). The Android app sends the SMS from your SIM.
 * Set TEXTBEE_API_KEY. Optional TEXTBEE_DEVICE_ID picks the phone.
 * Sends only at Extreme Caution or above (level 3), once per barangay + level
 * per Manila date, unless force is set.
 */

import { supabase } from "../lib/supabase.js";
import { getDavaoBarangayGeo, getBarangayCentroids, getBarangayNameById } from "../lib/barangays.js";
import { getOpenMeteoCurrent } from "../services/weatherService.js";
import { assessBarangayHeatRisk } from "../services/heatRiskModel.js";

const RECIPIENTS = "sms_recipients";
const ALERT_LOG = "sms_alert_log";
const TEXTBEE_SEND_URL = "https://api.textbee.dev/api/v1/gateway/send-sms";

const SMS_COPY = {
  1: {
    range: "below 27C",
    effect: "Normal conditions. Little to no heat effect on the body.",
    action: "Stay hydrated and dress for the weather.",
  },
  2: {
    range: "27-32C",
    effect: "You may feel tired after a long time outside. Keep going and heat cramps can start.",
    action: "Drink more water and limit hard activity during the hottest hours.",
  },
  3: {
    range: "33-41C",
    effect: "Heat cramps and heat exhaustion can happen: heavy sweating, dizziness, headache, weakness. Staying active in the heat can lead to heat stroke.",
    action: "Drink water. Limit outdoor work from 10AM to 4PM. Rest in shade.",
  },
  4: {
    range: "42-51C",
    effect: "Heat cramps and heat exhaustion are likely. Heat stroke is probable if you stay out in the heat.",
    action: "Stay cool, drink water, and check on elderly neighbors.",
  },
  5: {
    range: "52C and above",
    effect: "Heat stroke is imminent. The body can overheat quickly: hot skin, confusion, fainting.",
    action: "Stay indoors. Call emergency services if someone is confused or very hot.",
  },
};

function manilaDateString(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(date);
}

function minAlertLevel() {
  const n = parseInt(process.env.SMS_ALERT_MIN_LEVEL ?? "3", 10);
  if (!Number.isInteger(n) || n < 1 || n > 5) return 3;
  return n;
}

function alertPageUrl() {
  const url = process.env.HEAT_ALERT_PAGE_URL?.trim();
  return url || "";
}

/**
 * Normalize a Philippine mobile number to 63XXXXXXXXXX.
 * Accepts 09..., 9..., +63..., or 63....
 * @param {string} raw
 * @returns {string | null}
 */
export function normalizePhMobile(raw) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  let local = digits;
  if (local.startsWith("63") && local.length === 12) local = local.slice(2);
  else if (local.startsWith("0") && local.length === 11) local = local.slice(1);
  if (local.length !== 10 || !local.startsWith("9")) return null;
  return `63${local}`;
}

function heatValue(risk) {
  if (typeof risk?.heat_index_c === "number" && !Number.isNaN(risk.heat_index_c)) return risk.heat_index_c;
  if (typeof risk?.temp_c === "number" && !Number.isNaN(risk.temp_c)) return risk.temp_c;
  return null;
}

/**
 * Pick the barangay with the highest heat index (level breaks ties).
 * @param {Record<string, { level?: number, risk_level?: number, label?: string, risk_label?: string, heat_index_c?: number, temp_c?: number }>} risks
 */
export function pickHottestBarangay(risks) {
  let best = null;
  for (const [barangayId, risk] of Object.entries(risks || {})) {
    if (!risk) continue;
    const level = Number(risk.level ?? risk.risk_level);
    const hi = heatValue(risk);
    if (!Number.isInteger(level) || level < 1) continue;
    const candidate = {
      barangayId: String(barangayId),
      level,
      label: String(risk.label ?? risk.risk_label ?? ""),
      heatIndex: hi,
    };
    if (!best) {
      best = candidate;
      continue;
    }
    const bestHi = best.heatIndex;
    const candHi = candidate.heatIndex;
    const hotter =
      candHi != null && bestHi != null
        ? candHi > bestHi || (candHi === bestHi && candidate.level > best.level)
        : candHi != null && bestHi == null
          ? true
          : candHi == null && bestHi != null
            ? false
            : candidate.level > best.level;
    if (hotter) best = candidate;
  }
  return best;
}

/**
 * Heat alert SMS. One labeled line per fact so it stays readable on a phone.
 * @param {{ barangayName: string, label: string, level: number, heatIndex: number | null }} hottest
 */
export function buildHeatSms(hottest) {
  const copy = SMS_COPY[hottest.level] || SMS_COPY[2];
  const label = String(hottest.label || "").toUpperCase();
  const hi = hottest.heatIndex != null ? `${Math.round(hottest.heatIndex)}C` : null;
  const lines = [
    "!!! HEAT ALERT !!!",
    `${label} - DAVAO CITY`,
    "",
    `Hottest area: Brgy. ${hottest.barangayName}`,
  ];
  if (hi) lines.push(`Heat index: ${hi} (${label} range: ${copy.range})`);
  lines.push(
    "",
    `WHAT HAPPENS AT ${hi || "THIS LEVEL"}:`,
    copy.effect,
    "",
    `DO THIS: ${copy.action}`
  );

  const link = alertPageUrl();
  if (link) {
    lines.push(
      "",
      "CHECK YOUR LOCATION NOW:",
      "Tap the link and allow location to see the heat index where you are.",
      link
    );
  }
  lines.push("", "Stay safe! - BanasUno");
  return lines.join("\n");
}

async function listActivePhones(cityId) {
  if (!supabase) return { ok: false, error: "Supabase not configured", phones: [] };
  const { data, error } = await supabase
    .from(RECIPIENTS)
    .select("phone")
    .eq("city_id", cityId)
    .eq("active", true);
  if (error) return { ok: false, error: error.message, phones: [] };
  return { ok: true, phones: (data || []).map((row) => row.phone).filter(Boolean) };
}

async function alreadySentToday(cityId, barangayId, level, alertDate) {
  const { data, error } = await supabase
    .from(ALERT_LOG)
    .select("id")
    .eq("city_id", cityId)
    .eq("alert_date", alertDate)
    .eq("barangay_psgc", barangayId)
    .eq("risk_level", level)
    .eq("status", "sent")
    .limit(1);
  if (error) throw new Error(error.message);
  return (data || []).length > 0;
}

function toE164(phone) {
  const normalized = normalizePhMobile(phone);
  return normalized ? `+${normalized}` : null;
}

function textbeeKey() {
  return process.env.TEXTBEE_API_KEY?.trim() || "";
}

/**
 * Send through TextBee. The registered Android phone delivers the SMS.
 * @param {string[]} numbers
 * @param {string} message
 */
async function sendViaTextBee(numbers, message) {
  const apiKey = textbeeKey();
  if (!apiKey) {
    const err = new Error("Set TEXTBEE_API_KEY");
    err.code = "not_configured";
    throw err;
  }
  const recipients = [...new Set(numbers.map(toE164).filter(Boolean))];
  if (recipients.length === 0) throw new Error("No valid Philippine mobile numbers");
  const deviceId = process.env.TEXTBEE_DEVICE_ID?.trim();
  const body = { recipients, message };
  if (deviceId) body.deviceId = deviceId;
  const res = await fetch(TEXTBEE_SEND_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const detail = json?.message || json?.error || text || res.statusText;
    throw new Error(`TextBee ${res.status}: ${detail}`);
  }
}

/** Sample alert. Not used for a real send. */
export function demoHeatMessage() {
  return buildHeatSms({
    barangayName: "Calinan",
    label: "EXTREME CAUTION",
    level: 3,
    heatIndex: 36,
  });
}

/**
 * Same analysis as the heat map: Open-Meteo temperature and humidity per barangay,
 * then the PAGASA heat-index model.
 */
export async function loadLiveDavaoRisks() {
  const geo = await getDavaoBarangayGeo();
  const list = getBarangayCentroids(geo);
  const timezone = process.env.HEAT_OPEN_METEO_TIMEZONE || "Asia/Singapore";
  const temperatures = {};
  const humidityByBarangay = {};
  let index = 0;
  async function worker() {
    while (index < list.length) {
      const item = list[index++];
      try {
        const weather = await getOpenMeteoCurrent(item.lat, item.lng, timezone);
        if (!weather || typeof weather.temp_c !== "number") continue;
        temperatures[item.barangayId] = Math.round(weather.temp_c * 10) / 10;
        if (typeof weather.humidity === "number" && weather.humidity >= 0 && weather.humidity <= 100) {
          humidityByBarangay[item.barangayId] = weather.humidity;
        }
      } catch {
        // One barangay failing does not stop the city assessment.
      }
    }
  }
  const workers = Math.min(5, list.length);
  if (workers > 0) await Promise.all(Array.from({ length: workers }, () => worker()));
  const { risks } = assessBarangayHeatRisk(temperatures, { humidityByBarangay });
  return { risks, geo };
}

/**
 * Send the current hottest barangay, computed live, to one phone.
 * Sends only at Extreme Caution or above, the same rule as the hourly job.
 * @param {string} [rawPhone] - defaults to SMS_DEMO_PHONE
 */
export async function sendDemoSms(rawPhone) {
  const phone = normalizePhMobile(rawPhone || process.env.SMS_DEMO_PHONE);
  if (!phone) {
    return { ok: false, status: "failed", reason: "Set SMS_DEMO_PHONE to your mobile number" };
  }
  const { risks, geo } = await loadLiveDavaoRisks();
  return sendDavaoHeatSms({ risks, geo, phones: [phone], force: true });
}

/**
 * Text active Davao recipients about the hottest barangay in `risks`.
 * @param {{
 *   risks: Record<string, object>,
 *   geo?: { features: object[] } | null,
 *   cityId?: string,
 *   force?: boolean,
 *   dryRun?: boolean,
 *   phones?: string[],
 * }} opts
 */
export async function sendDavaoHeatSms(opts = {}) {
  const cityId = opts.cityId || "davao";
  const force = opts.force === true;
  const dryRun = opts.dryRun === true || process.env.SMS_DRY_RUN === "1";
  const hottest = pickHottestBarangay(opts.risks);
  if (!hottest) {
    return { ok: true, status: "skipped", reason: "no_risk_data" };
  }

  const barangayName = getBarangayNameById(opts.geo, hottest.barangayId) || hottest.barangayId;
  const message = buildHeatSms({ ...hottest, barangayName });
  const base = {
    ok: true,
    barangayPsgc: hottest.barangayId,
    barangayName,
    riskLevel: hottest.level,
    riskLabel: hottest.label,
    heatIndexC: hottest.heatIndex,
    message,
  };

  if (hottest.level < minAlertLevel()) {
    return { ...base, status: "skipped", reason: "below_threshold", recipientCount: 0 };
  }
  if (!supabase) {
    return { ...base, ok: false, status: "skipped", reason: "supabase_not_configured", recipientCount: 0 };
  }

  const alertDate = manilaDateString();
  if (!force && supabase) {
    try {
      const sent = await alreadySentToday(cityId, hottest.barangayId, hottest.level, alertDate);
      if (sent) {
        return { ...base, status: "skipped", reason: "already_sent_today", recipientCount: 0 };
      }
    } catch (err) {
      console.warn("[sms] Could not read the alert log, sending anyway:", err?.message ?? err);
    }
  }

  const recipients = await listActivePhones(cityId);
  const phones = new Set(recipients.ok ? recipients.phones.map((p) => normalizePhMobile(p)).filter(Boolean) : []);
  for (const raw of opts.phones || []) {
    const phone = normalizePhMobile(raw);
    if (phone) phones.add(phone);
  }
  const demoPhone = normalizePhMobile(process.env.SMS_DEMO_PHONE);
  if (demoPhone) phones.add(demoPhone);
  if (!recipients.ok && phones.size === 0) {
    return { ...base, ok: false, status: "failed", reason: recipients.error, recipientCount: 0 };
  }
  if (phones.size === 0) {
    return { ...base, status: "skipped", reason: "no_recipients", recipientCount: 0 };
  }
  const phoneList = [...phones];

  if (dryRun) {
    return {
      ...base,
      status: "skipped",
      reason: "dry_run",
      recipientCount: phoneList.length,
    };
  }
  if (!textbeeKey()) {
    return {
      ...base,
      ok: false,
      status: "failed",
      reason: "textbee_not_configured",
      recipientCount: phoneList.length,
    };
  }

  try {
    await sendViaTextBee(phoneList, message);
  } catch (err) {
    return {
      ...base,
      ok: false,
      status: "failed",
      reason: err?.message ?? "send_failed",
      recipientCount: phoneList.length,
    };
  }

  const { error } = await supabase.from(ALERT_LOG).insert({
    city_id: cityId,
    alert_date: alertDate,
    barangay_psgc: hottest.barangayId,
    barangay_name: barangayName,
    risk_level: hottest.level,
    risk_label: hottest.label,
    heat_index_c: hottest.heatIndex,
    message,
    recipient_count: phoneList.length,
    status: "sent",
  });
  if (error) {
    return {
      ...base,
      ok: false,
      status: "sent",
      reason: `sent_but_log_failed: ${error.message}`,
      recipientCount: phoneList.length,
    };
  }

  return { ...base, status: "sent", recipientCount: phoneList.length };
}

/**
 * Build the alert from the latest heat_risk_counts rows (one newest row per barangay).
 * @param {{ force?: boolean, dryRun?: boolean, cityId?: string }} [opts]
 */
export async function sendDavaoHeatSmsFromLatest(opts = {}) {
  const cityId = opts.cityId || "davao";
  if (!supabase) {
    return { ok: false, status: "failed", reason: "supabase_not_configured" };
  }
  const { data, error } = await supabase
    .from("heat_risk_counts")
    .select("barangay_psgc, risk_level, risk_label, heat_index_c, created_at")
    .eq("city_id", cityId)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) return { ok: false, status: "failed", reason: error.message };

  const risks = {};
  for (const row of data || []) {
    const id = row.barangay_psgc != null ? String(row.barangay_psgc) : "";
    if (!id || risks[id]) continue;
    risks[id] = {
      level: row.risk_level,
      label: row.risk_label,
      heat_index_c: row.heat_index_c != null ? Number(row.heat_index_c) : null,
    };
  }

  let geo = null;
  try {
    geo = await getDavaoBarangayGeo();
  } catch (err) {
    console.warn("[sms] Barangay names unavailable:", err?.message ?? err);
  }
  return sendDavaoHeatSms({ risks, geo, cityId, force: opts.force, dryRun: opts.dryRun });
}

/**
 * Insert partner phone numbers. Existing numbers are reactivated.
 * @param {string[]} phones
 * @param {{ cityId?: string, source?: string }} [opts]
 */
export async function addSmsRecipients(phones, opts = {}) {
  if (!supabase) return { ok: false, error: "Supabase not configured", added: [], invalid: [] };
  const cityId = opts.cityId || "davao";
  const source = opts.source?.trim() || "partner";
  const added = [];
  const invalid = [];
  const seen = new Set();
  for (const raw of phones || []) {
    const phone = normalizePhMobile(raw);
    if (!phone) {
      invalid.push(String(raw ?? ""));
      continue;
    }
    if (seen.has(phone)) continue;
    seen.add(phone);
    added.push(phone);
  }
  if (added.length === 0) return { ok: true, added: [], invalid };

  const rows = added.map((phone) => ({ phone, city_id: cityId, active: true, source }));
  const { error } = await supabase.from(RECIPIENTS).upsert(rows, { onConflict: "phone,city_id" });
  if (error) return { ok: false, error: error.message, added: [], invalid };
  return { ok: true, added, invalid };
}

export async function listSmsRecipients(cityId = "davao") {
  if (!supabase) return { ok: false, error: "Supabase not configured", recipients: [] };
  const { data, error } = await supabase
    .from(RECIPIENTS)
    .select("id, phone, city_id, active, source, created_at")
    .eq("city_id", cityId)
    .order("created_at", { ascending: false });
  if (error) return { ok: false, error: error.message, recipients: [] };
  return { ok: true, recipients: data || [] };
}

export async function deactivateSmsRecipient(phone, cityId = "davao") {
  if (!supabase) return { ok: false, error: "Supabase not configured" };
  const normalized = normalizePhMobile(phone);
  if (!normalized) return { ok: false, error: "Invalid Philippine mobile number" };
  const { data, error } = await supabase
    .from(RECIPIENTS)
    .update({ active: false })
    .eq("phone", normalized)
    .eq("city_id", cityId)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "Number not found" };
  return { ok: true, phone: normalized };
}

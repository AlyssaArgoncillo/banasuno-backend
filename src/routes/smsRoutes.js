/**
 * Heat SMS admin routes.
 * Numbers come from the partner agency and live in sms_recipients.
 * If SMS_ADMIN_KEY is set, send x-sms-admin-key with the same value.
 */

import { Router } from "express";
import {
  addSmsRecipients,
  deactivateSmsRecipient,
  listSmsRecipients,
  sendDavaoHeatSmsFromLatest,
} from "../services/smsHeatAlert.js";

const router = Router();

function requireSmsAdmin(req, res) {
  const key = process.env.SMS_ADMIN_KEY?.trim();
  if (!key) {
    res.status(503).json({
      error: "SMS admin is not configured",
      hint: "Set SMS_ADMIN_KEY in the backend environment.",
    });
    return false;
  }
  if (req.get("x-sms-admin-key") !== key) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

/**
 * GET /api/sms/recipients
 * Active and inactive Davao numbers.
 */
router.get("/recipients", async (req, res) => {
  if (!requireSmsAdmin(req, res)) return;
  try {
    const result = await listSmsRecipients("davao");
    if (!result.ok) return res.status(500).json({ error: result.error });
    res.json({ recipients: result.recipients });
  } catch (err) {
    res.status(500).json({ error: err?.message ?? "Failed to list recipients" });
  }
});

/**
 * POST /api/sms/recipients
 * Body: { phone?: string, phones?: string[], source?: string }
 */
router.post("/recipients", async (req, res) => {
  if (!requireSmsAdmin(req, res)) return;
  try {
    const body = req.body || {};
    const phones = [];
    if (body.phone != null) phones.push(body.phone);
    if (Array.isArray(body.phones)) phones.push(...body.phones);
    if (phones.length === 0) {
      return res.status(400).json({ error: "Send phone or phones" });
    }
    const result = await addSmsRecipients(phones, { cityId: "davao", source: body.source });
    if (!result.ok) return res.status(500).json({ error: result.error });
    res.status(201).json({ added: result.added, invalid: result.invalid });
  } catch (err) {
    res.status(500).json({ error: err?.message ?? "Failed to add recipients" });
  }
});

/**
 * POST /api/sms/recipients/deactivate
 * Body: { phone: string }
 */
router.post("/recipients/deactivate", async (req, res) => {
  if (!requireSmsAdmin(req, res)) return;
  try {
    const phone = req.body?.phone;
    if (phone == null || String(phone).trim() === "") {
      return res.status(400).json({ error: "Send phone" });
    }
    const result = await deactivateSmsRecipient(phone, "davao");
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ phone: result.phone, active: false });
  } catch (err) {
    res.status(500).json({ error: err?.message ?? "Failed to deactivate recipient" });
  }
});

/**
 * GET /api/sms/alerts/preview
 * Builds the message from the latest stored heat risk. Does not send.
 */
router.get("/alerts/preview", async (req, res) => {
  if (!requireSmsAdmin(req, res)) return;
  try {
    const result = await sendDavaoHeatSmsFromLatest({ dryRun: true });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err?.message ?? "Failed to preview heat SMS" });
  }
});

/**
 * POST /api/sms/alerts/send
 * Body: { force?: boolean, dry_run?: boolean }
 * force resends even if this barangay and level were already texted today.
 */
router.post("/alerts/send", async (req, res) => {
  if (!requireSmsAdmin(req, res)) return;
  try {
    const force = req.body?.force === true;
    const dryRun = req.body?.dry_run === true || req.body?.dryRun === true;
    const result = await sendDavaoHeatSmsFromLatest({ force, dryRun });
    const status = result.ok ? 200 : 502;
    res.status(status).json(result);
  } catch (err) {
    res.status(500).json({ error: err?.message ?? "Failed to send heat SMS" });
  }
});

export default router;

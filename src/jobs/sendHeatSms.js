/**
 * Preview or send the Davao heat SMS from the latest stored barangay risk.
 *
 * Preview (no text):  node src/jobs/sendHeatSms.js
 * Send:               node src/jobs/sendHeatSms.js --send
 * Send again today:   node src/jobs/sendHeatSms.js --send --force
 */

import "dotenv/config";
import { sendDavaoHeatSmsFromLatest } from "../services/smsHeatAlert.js";

const send = process.argv.includes("--send");
const force = process.argv.includes("--force");

const result = await sendDavaoHeatSmsFromLatest({ dryRun: !send, force });
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.ok && (!send || result.status === "sent") ? 0 : 1;

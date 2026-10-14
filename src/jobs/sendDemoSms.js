/**
 * Send the live hottest-barangay alert to your phone.
 * Uses the same heat-index analysis as the map. Sends only at Extreme Caution or above.
 *
 * Put your number in SMS_DEMO_PHONE, or:
 *   node src/jobs/sendDemoSms.js 09171234567
 */

import "dotenv/config";
import { sendDemoSms } from "../services/smsHeatAlert.js";

const result = await sendDemoSms(process.argv[2]);
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.ok ? 0 : 1;

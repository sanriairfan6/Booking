/**
 * MSG91 SMS Service
 * Sends Tamil appointment confirmation SMS to patients
 *
 * Prerequisites:
 * 1. Register at https://msg91.com
 * 2. Complete DLT registration (mandatory for India)
 * 3. Create a transactional SMS template in Tamil
 * 4. Get template approved and note the Template ID
 */

const axios = require("axios");
const logger = require("./logger");

/**
 * Send appointment confirmation SMS
 * @param {string} phone - Patient phone (91XXXXXXXXXX format)
 * @param {object} booking - Booking details
 * @param {string} bookingId - Booking ID (APT-XXXXXXXX)
 */
async function sendConfirmationSMS(phone, booking, bookingId) {
  // Normalize phone number (ensure 91 prefix, no +)
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    logger.warn("Invalid phone number for SMS", { phone });
    return false;
  }

  // Build the SMS message
  // NOTE: In production, use a DLT-approved template
  // The variables below must match your MSG91 template exactly
  const message = buildTamilSMS(booking, bookingId);

  try {
    const payload = {
      sender: process.env.MSG91_SENDER_ID || "CLINIC",
      route: "4",          // Transactional route
      country: "91",
      sms: [
        {
          message,
          to: [normalizedPhone],
        },
      ],
    };

    // If using template-based SMS (recommended for DLT compliance)
    // Uncomment and use this instead:
    /*
    const payload = {
      template_id: process.env.MSG91_TEMPLATE_ID,
      sender: process.env.MSG91_SENDER_ID,
      short_url: "0",
      mobiles: normalizedPhone,
      var1: booking.name,
      var2: bookingId,
      var3: booking.date,
      var4: booking.time,
      var5: booking.department,
      var6: process.env.CLINIC_PHONE,
    };
    */

    const res = await axios.post("https://api.msg91.com/api/v5/flow/", payload, {
      headers: {
        authkey: process.env.MSG91_AUTH_KEY,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    });

    logger.info("SMS sent", { phone: normalizedPhone, bookingId, response: res.data });
    return true;
  } catch (err) {
    logger.error("SMS send error", { error: err.message, phone: normalizedPhone });
    return false;
  }
}

/**
 * Build Tamil SMS content
 * Keep under 160 chars for single SMS
 */
function buildTamilSMS(booking, bookingId) {
  return (
    `✅ Appointment Confirmed!\n` +
    `ID: ${bookingId}\n` +
    `பெயர்: ${booking.name}\n` +
    `தேதி: ${booking.date} | நேரம்: ${booking.time}\n` +
    `துறை: ${booking.department}\n` +
    `${process.env.CLINIC_NAME} | ${process.env.CLINIC_PHONE}`
  );
}

/**
 * Normalize phone to 91XXXXXXXXXX format
 */
function normalizePhone(phone) {
  if (!phone) return null;
  // Remove spaces, dashes, parentheses
  let p = phone.replace(/[\s\-()]/g, "");
  // Remove leading +
  p = p.replace(/^\+/, "");
  // If starts with 0, replace with 91
  if (p.startsWith("0")) p = "91" + p.slice(1);
  // If 10 digits, prepend 91
  if (p.length === 10) p = "91" + p;
  // Validate
  if (!/^91\d{10}$/.test(p)) return null;
  return p;
}

module.exports = { sendConfirmationSMS };

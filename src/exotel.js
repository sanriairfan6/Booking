/**
 * Exotel Webhook Handler
 *
 * Exotel calls your server at each step of the call:
 * 1. POST /exotel/inbound    — when someone calls your number
 * 2. POST /exotel/recording  — when the caller finishes speaking (recording ready)
 * 3. POST /exotel/hangup     — when call ends
 *
 * Your server responds with ExoML (Exotel's XML dialect, similar to TwiML)
 * to control the call flow: play audio, record speech, hang up, etc.
 */

const express = require("express");
const axios = require("axios");
const path = require("path");
const fs = require("fs");
const { speechToText, textToSpeech } = require("./sarvam");
const { processMessage, startCall, endSession } = require("./claude");
const { saveBooking } = require("./sheets");
const { sendConfirmationSMS } = require("./sms");
const logger = require("./logger");

const router = express.Router();

// Temp directory for audio files served back to Exotel
const AUDIO_DIR = path.join(__dirname, "../public/audio");
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });

// ─────────────────────────────────────────────────────────────────
// 1. INBOUND CALL — patient just called, greet them
// ─────────────────────────────────────────────────────────────────
router.post("/inbound", async (req, res) => {
  const { CallSid, From, To } = req.body;
  logger.info("Inbound call", { CallSid, From, To });

  try {
    // Generate greeting text
    const greetingText = await startCall(CallSid, From);

    // Convert to Tamil speech
    const audioBuffer = await textToSpeech(greetingText, "diya");
    const audioUrl = await saveAudioAndGetUrl(audioBuffer, CallSid, "greeting");

    // Respond with ExoML to play greeting + record patient response
    res.set("Content-Type", "text/xml");
    res.send(buildRecordXML(audioUrl, CallSid));
  } catch (err) {
    logger.error("Inbound handler error", { error: err.message, CallSid });
    res.set("Content-Type", "text/xml");
    res.send(buildErrorXML());
  }
});

// ─────────────────────────────────────────────────────────────────
// 2. RECORDING RECEIVED — patient spoke, process their speech
// ─────────────────────────────────────────────────────────────────
router.post("/recording", async (req, res) => {
  const { CallSid, RecordingUrl, From, RecordingDuration } = req.body;
  logger.info("Recording received", { CallSid, RecordingUrl, duration: RecordingDuration });

  // Short recordings (< 1 sec) = silence, ask to repeat
  if (parseInt(RecordingDuration) < 1) {
    const silenceText = "மன்னிக்கவும், உங்கள் குரல் கேட்கவில்லை. மீண்டும் சொல்லுங்களா?";
    const audioBuffer = await textToSpeech(silenceText);
    const audioUrl = await saveAudioAndGetUrl(audioBuffer, CallSid, "silence");
    res.set("Content-Type", "text/xml");
    return res.send(buildRecordXML(audioUrl, CallSid));
  }

  try {
    // Step 1: Download recording from Exotel
    const audioBuffer = await downloadExotelRecording(RecordingUrl);

    // Step 2: Convert Tamil speech to text via Sarvam
    const userText = await speechToText(audioBuffer, "audio/wav");

    if (!userText || userText.trim().length < 2) {
      const retryText = "மன்னிக்கவும், மீண்டும் தெளிவாக சொல்லுங்களா?";
      const audioBuffer2 = await textToSpeech(retryText);
      const audioUrl = await saveAudioAndGetUrl(audioBuffer2, CallSid, "retry");
      res.set("Content-Type", "text/xml");
      return res.send(buildRecordXML(audioUrl, CallSid));
    }

    // Step 3: Process with Claude
    const { replyText, isComplete, bookingData } = await processMessage(CallSid, userText, From);

    // Step 4: Convert reply to Tamil speech
    const replyAudio = await textToSpeech(replyText, "diya");
    const replyUrl = await saveAudioAndGetUrl(replyAudio, CallSid, `turn_${Date.now()}`);

    if (isComplete && bookingData) {
      // ── Booking complete — save + SMS + hang up ──
      const bookingId = await saveBooking(bookingData);
      logger.info("Booking complete!", { bookingId, name: bookingData.name });

      // Send SMS confirmation (non-blocking)
      sendConfirmationSMS(bookingData.phone || From, bookingData, bookingId).catch((e) =>
        logger.error("SMS error", { error: e.message })
      );

      res.set("Content-Type", "text/xml");
      res.send(buildHangupXML(replyUrl));
    } else {
      // ── Continue conversation ──
      res.set("Content-Type", "text/xml");
      res.send(buildRecordXML(replyUrl, CallSid));
    }
  } catch (err) {
    logger.error("Recording handler error", { error: err.message, CallSid });
    const errorText = "மன்னிக்கவும், தொழில்நுட்ப பிழை. சற்று நேரம் கழித்து மீண்டும் அழைக்கவும்.";
    const audioBuffer = await textToSpeech(errorText).catch(() => Buffer.alloc(0));
    const audioUrl = await saveAudioAndGetUrl(audioBuffer, CallSid, "error");
    res.set("Content-Type", "text/xml");
    res.send(buildHangupXML(audioUrl));
  }
});

// ─────────────────────────────────────────────────────────────────
// 3. HANGUP — clean up session
// ─────────────────────────────────────────────────────────────────
router.post("/hangup", (req, res) => {
  const { CallSid, CallStatus, CallDuration } = req.body;
  logger.info("Call ended", { CallSid, CallStatus, CallDuration });
  endSession(CallSid);
  res.sendStatus(200);
});

// ─────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────

/**
 * Download audio recording from Exotel
 * Exotel recordings require HTTP Basic Auth
 */
async function downloadExotelRecording(recordingUrl) {
  const res = await axios.get(recordingUrl, {
    auth: {
      username: process.env.EXOTEL_API_KEY,
      password: process.env.EXOTEL_API_TOKEN,
    },
    responseType: "arraybuffer",
    timeout: 15000,
  });
  return Buffer.from(res.data);
}

/**
 * Save audio buffer to disk and return public URL
 */
async function saveAudioAndGetUrl(audioBuffer, callSid, label) {
  const filename = `${callSid}_${label}.wav`;
  const filepath = path.join(AUDIO_DIR, filename);
  fs.writeFileSync(filepath, audioBuffer);
  const baseUrl = process.env.BASE_URL || "http://localhost:3000";
  return `${baseUrl}/audio/${filename}`;
}

/**
 * ExoML: Play audio + Record patient's response
 * Exotel records until silence (finishOnKey or timeout)
 */
function buildRecordXML(audioUrl, callSid) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${audioUrl}</Play>
  <Record
    action="${process.env.BASE_URL}/exotel/recording"
    method="POST"
    maxLength="15"
    finishOnKey="#"
    playBeep="false"
    timeout="5"
    transcribe="false"
  />
</Response>`;
}

/**
 * ExoML: Play final message and hang up
 */
function buildHangupXML(audioUrl) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${audioUrl}</Play>
  <Hangup/>
</Response>`;
}

/**
 * ExoML: Generic error — play a message and hang up
 */
function buildErrorXML() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="ta-IN">மன்னிக்கவும். தொழில்நுட்ப பிழை ஏற்பட்டது. மீண்டும் அழைக்கவும்.</Say>
  <Hangup/>
</Response>`;
}

module.exports = router;

/**
 * Claude AI Conversation Manager
 * Manages multi-turn Tamil booking conversation per call session
 */

const axios = require("axios");
const logger = require("./logger");

const SYSTEM_PROMPT = `நீங்கள் "பிரியா", ஒரு AI appointment booking assistant. நீங்கள் Tamil Nadu-ல் உள்ள ஒரு clinic-க்காக பணிபுரிகிறீர்கள்.

RULES:
1. Always respond ONLY in Tamil (தமிழ்). Short, clear sentences suitable for phone calls.
2. Max 2-3 short sentences per response. Phone callers need brevity.
3. Collect these details in order:
   - Patient full name (பெயர்)
   - Mobile number (தொலைபேசி எண்) — repeat back to confirm
   - Preferred date (தேதி) — suggest tomorrow if they say "நாளை"
   - Preferred time: காலை (9-12), மதியம் (12-3), மாலை (3-6)
   - Department: பொது மருத்துவம், இதயவியல், எலும்பியல், மகளிர் மருத்துவம், குழந்தை மருத்துவம்
   - Brief reason (காரணம்)
4. Use respectful language with "நீங்கள்".
5. When all 6 fields collected, confirm by reading them back, then output EXACTLY:
   BOOKING_COMPLETE|name|phone|date|time|department|reason
   (pipe-separated, single line, no spaces around pipes)
6. If caller says anything unclear, politely ask to repeat: "மன்னிக்கவும், மீண்டும் சொல்லுங்களா?"
7. For date, convert relative dates: நாளை = tomorrow, இன்று = today, etc.
8. Be warm and reassuring. This is a healthcare context.

Clinic: ${process.env.CLINIC_NAME || "Sri Kumaran Clinic"}
Available days: Monday to Saturday, 9 AM to 6 PM`;

// In-memory session store (call_sid → conversation history + booking data)
// For production, replace with Redis
const sessions = new Map();

/**
 * Get or create session for a call
 */
function getSession(callSid) {
  if (!sessions.has(callSid)) {
    sessions.set(callSid, {
      callSid,
      history: [],
      bookingData: {},
      isComplete: false,
      createdAt: new Date(),
      callerPhone: null,
    });
  }
  return sessions.get(callSid);
}

/**
 * Process user speech and get AI response
 * @param {string} callSid - Exotel call ID
 * @param {string} userText - Transcribed Tamil text from caller
 * @param {string} callerPhone - Caller's phone number
 * @returns {{ replyText: string, isComplete: boolean, bookingData: object }}
 */
async function processMessage(callSid, userText, callerPhone = null) {
  const session = getSession(callSid);

  if (callerPhone && !session.callerPhone) {
    session.callerPhone = callerPhone;
  }

  // Add user message to history
  session.history.push({ role: "user", content: userText });

  logger.info("Processing message", { callSid, userText, historyLength: session.history.length });

  try {
    const res = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-sonnet-4-20250514",
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages: session.history,
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        timeout: 20000,
      }
    );

    const fullReply = res.data?.content?.[0]?.text || "மன்னிக்கவும், மீண்டும் முயற்சிக்கவும்.";

    // Check if booking is complete
    let replyText = fullReply;
    let isComplete = false;
    let bookingData = null;

    if (fullReply.includes("BOOKING_COMPLETE|")) {
      const match = fullReply.match(/BOOKING_COMPLETE\|([^\n]+)/);
      if (match) {
        const parts = match[1].split("|");
        bookingData = {
          name: parts[0]?.trim(),
          phone: parts[1]?.trim() || callerPhone,
          date: parts[2]?.trim(),
          time: parts[3]?.trim(),
          department: parts[4]?.trim(),
          reason: parts[5]?.trim(),
          callerPhone,
          callSid,
        };
        session.bookingData = bookingData;
        isComplete = true;

        // Remove the BOOKING_COMPLETE line from spoken text
        replyText = fullReply.replace(/BOOKING_COMPLETE\|[^\n]+/, "").trim();
      }
    }

    // Add assistant reply to history
    session.history.push({ role: "assistant", content: fullReply });
    session.isComplete = isComplete;

    logger.info("AI reply", { callSid, replyText: replyText.slice(0, 100), isComplete });

    return { replyText, isComplete, bookingData };
  } catch (err) {
    logger.error("Claude API error", { error: err.message, callSid });
    const fallback = "மன்னிக்கவும், தொழில்நுட்ப பிழை. சற்று நேரம் கழித்து மீண்டும் அழைக்கவும்.";
    session.history.push({ role: "assistant", content: fallback });
    return { replyText: fallback, isComplete: false, bookingData: null };
  }
}

/**
 * Start a new call with a greeting
 */
async function startCall(callSid, callerPhone) {
  const greeting = "வணக்கம்! நான் பிரியா, உங்கள் AI appointment assistant. உங்கள் பெயரை சொல்லுங்களா?";
  const session = getSession(callSid);
  session.callerPhone = callerPhone;
  session.history.push({ role: "assistant", content: greeting });
  return greeting;
}

/**
 * Clean up session after call ends
 */
function endSession(callSid) {
  const session = sessions.get(callSid);
  sessions.delete(callSid);
  return session;
}

/**
 * Get all active sessions (for monitoring)
 */
function getActiveSessions() {
  return Array.from(sessions.values()).map((s) => ({
    callSid: s.callSid,
    callerPhone: s.callerPhone,
    turns: s.history.length,
    isComplete: s.isComplete,
    createdAt: s.createdAt,
  }));
}

module.exports = { processMessage, startCall, endSession, getActiveSessions };

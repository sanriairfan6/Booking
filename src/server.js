/**
 * Tamil Voice Agent — Main Server
 * Railway deployment entry point
 *
 * Stack:
 *  - Express (HTTP server)
 *  - Exotel (Indian telephony — receives calls, plays audio, records speech)
 *  - Sarvam AI (Tamil STT + TTS)
 *  - Claude (conversation AI)
 *  - Google Sheets (appointment storage)
 *  - MSG91 (SMS confirmations)
 */

require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const logger = require("./logger");
const exotelRouter = require("./exotel");
const adminRouter = require("./admin");
const { initSheet } = require("./sheets");
const { getActiveSessions } = require("./claude");

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────
app.use(bodyParser.urlencoded({ extended: true }));  // Exotel sends form-encoded
app.use(bodyParser.json());

// Serve generated audio files back to Exotel
app.use("/audio", express.static(path.join(__dirname, "../public/audio")));

// ── Routes ────────────────────────────────────────────────────────

// Exotel webhooks
app.use("/exotel", exotelRouter);

// Admin API
app.use("/admin", adminRouter);

// Admin Dashboard UI
app.get("/admin", (req, res) => {
  res.sendFile(require("path").join(__dirname, "../public/dashboard.html"));
});

// Health check (Railway pings this)
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "Tamil Voice Agent",
    timestamp: new Date().toISOString(),
    activeCalls: getActiveSessions().length,
  });
});

// Dashboard — active calls monitor
app.get("/dashboard", (req, res) => {
  const sessions = getActiveSessions();
  res.json({
    activeCalls: sessions.length,
    sessions,
    uptime: process.uptime(),
    env: {
      clinic: process.env.CLINIC_NAME,
      baseUrl: process.env.BASE_URL,
    },
  });
});

// Root
app.get("/", (req, res) => {
  res.json({
    name: "Tamil Voice Agent",
    version: "1.0.0",
    endpoints: {
      health: "GET /health",
      dashboard: "GET /dashboard",
      exotel_inbound: "POST /exotel/inbound",
      exotel_recording: "POST /exotel/recording",
      exotel_hangup: "POST /exotel/hangup",
    },
  });
});

// ── Start ─────────────────────────────────────────────────────────
async function start() {
  // Initialize Google Sheets (create tab + headers if needed)
  logger.info("Initializing Google Sheets...");
  await initSheet().catch((err) => {
    logger.warn("Sheet init failed (check credentials)", { error: err.message });
  });

  app.listen(PORT, () => {
    logger.info(`🎙️  Tamil Voice Agent running on port ${PORT}`);
    logger.info(`📋 Dashboard: ${process.env.BASE_URL}/dashboard`);
    logger.info(`📞 Exotel webhook: ${process.env.BASE_URL}/exotel/inbound`);
  });
}

start().catch((err) => {
  logger.error("Server failed to start", { error: err.message });
  process.exit(1);
});

/**
 * Admin Dashboard API Routes
 * Serves appointment data from Google Sheets
 * Mount at: /admin
 */

const express = require("express");
const { google } = require("googleapis");
const { updateBookingStatus } = require("./sheets");
const logger = require("./logger");
const { getActiveSessions } = require("./claude");

const router = express.Router();
const SHEET_NAME = "Appointments";

function getAuth() {
  return new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

async function getSheetsClient() {
  const auth = getAuth();
  await auth.authorize();
  return google.sheets({ version: "v4", auth });
}

// GET /admin/appointments — fetch all rows from Google Sheets
router.get("/appointments", async (req, res) => {
  try {
    const sheets = await getSheetsClient();
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEET_NAME}!A2:K`,
    });

    const rows = result.data.values || [];
    const appointments = rows
      .map((row, i) => ({
        id: row[0] || "",
        bookedAt: row[1] || "",
        name: row[2] || "",
        phone: row[3] || "",
        date: row[4] || "",
        time: row[5] || "",
        department: row[6] || "",
        reason: row[7] || "",
        callerPhone: row[8] || "",
        callSid: row[9] || "",
        status: row[10] || "Confirmed",
        rowIndex: i + 2,
      }))
      .filter((a) => a.id);

    // Stats
    const stats = {
      total: appointments.length,
      confirmed: appointments.filter((a) => a.status === "Confirmed").length,
      cancelled: appointments.filter((a) => a.status === "Cancelled").length,
      today: appointments.filter((a) => {
        const today = new Date().toLocaleDateString("en-IN");
        return a.bookedAt?.startsWith(new Date().toISOString().slice(0, 10));
      }).length,
      activeCalls: getActiveSessions().length,
      byDepartment: appointments.reduce((acc, a) => {
        acc[a.department] = (acc[a.department] || 0) + 1;
        return acc;
      }, {}),
    };

    res.json({ appointments, stats });
  } catch (err) {
    logger.error("Admin fetch error", { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// PATCH /admin/appointments/:id/cancel
router.patch("/appointments/:id/cancel", async (req, res) => {
  try {
    const { id } = req.params;
    const success = await updateBookingStatus(id, "Cancelled");
    if (success) {
      res.json({ ok: true, message: "Appointment cancelled" });
    } else {
      res.status(404).json({ error: "Appointment not found" });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /admin/appointments/:id/restore
router.patch("/appointments/:id/restore", async (req, res) => {
  try {
    const { id } = req.params;
    const success = await updateBookingStatus(id, "Confirmed");
    res.json({ ok: success });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/live — active calls
router.get("/live", (req, res) => {
  res.json({ activeCalls: getActiveSessions() });
});

// GET /admin/analytics — computed trends for charts
router.get("/analytics", async (req, res) => {
  try {
    const sheets = await getSheetsClient();
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEET_NAME}!A2:K`,
    });
    const rows = result.data.values || [];

    // Bookings per day (last 14 days)
    const dayMap = {};
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dayMap[d.toISOString().slice(0, 10)] = 0;
    }
    // Time-slot distribution + hour-of-day
    const slotMap = {};
    const hourMap = {};
    rows.forEach((row) => {
      const bookedAt = row[1] || "";
      const day = bookedAt.slice(0, 10);
      if (day in dayMap) dayMap[day]++;
      const slot = row[5] || "Unknown";
      slotMap[slot] = (slotMap[slot] || 0) + 1;
      const hour = bookedAt.slice(11, 13);
      if (hour) hourMap[hour] = (hourMap[hour] || 0) + 1;
    });

    res.json({
      bookingsPerDay: dayMap,
      timeSlots: slotMap,
      hourOfDay: hourMap,
    });
  } catch (err) {
    logger.error("Analytics error", { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/export — download CSV of all appointments
router.get("/export", async (req, res) => {
  try {
    const sheets = await getSheetsClient();
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEET_NAME}!A1:K`,
    });
    const rows = result.data.values || [];
    const csv = rows
      .map((r) => r.map((c) => `"${(c || "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    res.set("Content-Type", "text/csv");
    res.set("Content-Disposition", `attachment; filename="appointments-${Date.now()}.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

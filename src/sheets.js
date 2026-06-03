/**
 * Google Sheets Integration
 * Saves appointment bookings to a Google Sheet
 *
 * Sheet columns:
 * A: Booking ID | B: Timestamp | C: Patient Name | D: Phone
 * E: Date | F: Time | G: Department | H: Reason
 * I: Caller Phone | J: Call SID | K: Status
 */

const { google } = require("googleapis");
const dayjs = require("dayjs");
const { v4: uuidv4 } = require("uuid");
const logger = require("./logger");

const SHEET_NAME = "Appointments";
const HEADER_ROW = [
  "Booking ID",
  "Booked At",
  "Patient Name",
  "Phone",
  "Appointment Date",
  "Time Preference",
  "Department (Tamil)",
  "Reason",
  "Caller Phone",
  "Call SID",
  "Status",
];

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

/**
 * Ensure the sheet exists and has headers
 */
async function initSheet() {
  try {
    const sheets = await getSheetsClient();
    const sheetId = process.env.GOOGLE_SHEET_ID;

    // Check if sheet exists
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    const sheetList = meta.data.sheets.map((s) => s.properties.title);

    if (!sheetList.includes(SHEET_NAME)) {
      // Create the sheet
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: SHEET_NAME } } }],
        },
      });
      logger.info(`Created sheet: ${SHEET_NAME}`);
    }

    // Check if headers exist
    const headerCheck = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${SHEET_NAME}!A1:K1`,
    });

    if (!headerCheck.data.values || headerCheck.data.values.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `${SHEET_NAME}!A1`,
        valueInputOption: "RAW",
        requestBody: { values: [HEADER_ROW] },
      });

      // Format header row (bold + background)
      const sheetMeta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
      const sheet = sheetMeta.data.sheets.find((s) => s.properties.title === SHEET_NAME);
      if (sheet) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: sheetId,
          requestBody: {
            requests: [
              {
                repeatCell: {
                  range: {
                    sheetId: sheet.properties.sheetId,
                    startRowIndex: 0,
                    endRowIndex: 1,
                  },
                  cell: {
                    userEnteredFormat: {
                      backgroundColor: { red: 0.55, green: 0.15, blue: 0.21 },
                      textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
                    },
                  },
                  fields: "userEnteredFormat(backgroundColor,textFormat)",
                },
              },
            ],
          },
        });
      }
      logger.info("Sheet headers created");
    }
  } catch (err) {
    logger.error("Sheet init error", { error: err.message });
  }
}

/**
 * Save a booking to Google Sheets
 * @param {object} bookingData
 * @returns {string} Booking ID
 */
async function saveBooking(bookingData) {
  const bookingId = "APT-" + uuidv4().slice(0, 8).toUpperCase();
  const timestamp = dayjs().format("YYYY-MM-DD HH:mm:ss");

  const row = [
    bookingId,
    timestamp,
    bookingData.name || "",
    bookingData.phone || "",
    bookingData.date || "",
    bookingData.time || "",
    bookingData.department || "",
    bookingData.reason || "",
    bookingData.callerPhone || "",
    bookingData.callSid || "",
    "Confirmed",
  ];

  try {
    const sheets = await getSheetsClient();
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEET_NAME}!A:K`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });

    logger.info("Booking saved to Google Sheets", { bookingId, name: bookingData.name });
    return bookingId;
  } catch (err) {
    logger.error("Google Sheets save error", { error: err.message, bookingData });
    throw new Error("Failed to save booking");
  }
}

/**
 * Update booking status (e.g. cancelled)
 */
async function updateBookingStatus(bookingId, status) {
  try {
    const sheets = await getSheetsClient();
    const sheetId = process.env.GOOGLE_SHEET_ID;

    // Find the row
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${SHEET_NAME}!A:A`,
    });

    const rows = result.data.values || [];
    const rowIndex = rows.findIndex((r) => r[0] === bookingId);

    if (rowIndex === -1) {
      logger.warn("Booking not found for status update", { bookingId });
      return false;
    }

    // Update status column (K = index 10, column 11)
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${SHEET_NAME}!K${rowIndex + 1}`,
      valueInputOption: "RAW",
      requestBody: { values: [[status]] },
    });

    logger.info("Booking status updated", { bookingId, status });
    return true;
  } catch (err) {
    logger.error("Status update error", { error: err.message });
    return false;
  }
}

module.exports = { saveBooking, updateBookingStatus, initSheet };

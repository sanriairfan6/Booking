# 🎙️ Tamil Voice Agent — Automatic Appointment Booking

An AI-powered call center that automatically books appointments in Tamil. Patients call a number, speak naturally in Tamil, and the system books their appointment — no human agent needed.

---

## Architecture

```
Patient calls Exotel number
        ↓
Exotel → POST /exotel/inbound (your server)
        ↓
Server generates Tamil greeting via Sarvam TTS
        ↓
Exotel plays audio + records patient's reply
        ↓
Exotel → POST /exotel/recording (your server)
        ↓
Sarvam STT converts Tamil speech → text
        ↓
Claude understands + manages booking conversation
        ↓
Sarvam TTS converts reply → audio → Exotel plays it
        ↓
Loop until all booking details collected
        ↓
Google Sheets ← saves appointment
MSG91 → sends Tamil SMS confirmation to patient
Exotel hangs up
```

---

## Services Required

| Service | Purpose | Signup |
|---------|---------|--------|
| **Exotel** | Indian virtual phone number + call handling | exotel.com |
| **Sarvam AI** | Tamil STT + TTS (best for Indian languages) | sarvam.ai |
| **Anthropic** | Claude AI for conversation | console.anthropic.com |
| **Google Cloud** | Sheets API (service account) | console.cloud.google.com |
| **MSG91** | SMS confirmations (DLT registered) | msg91.com |
| **Railway** | Server hosting | railway.app |

---

## Setup Guide

### 1. Clone & install

```bash
git clone <your-repo>
cd tamil-voice-agent
npm install
```

### 2. Copy environment file

```bash
cp .env.example .env
```

### 3. Anthropic API Key
- Go to https://console.anthropic.com
- Create API key → paste as `ANTHROPIC_API_KEY`

### 4. Sarvam AI
- Sign up at https://sarvam.ai
- Get API key → paste as `SARVAM_API_KEY`

### 5. Exotel Setup
1. Sign up at https://exotel.com (India)
2. Purchase a virtual number
3. Go to **App → ExoPhone → your number → Settings**
4. Set Webhook URL to: `https://your-app.up.railway.app/exotel/inbound`
5. Set Method: **POST**
6. Copy SID, API Key, API Token → paste into `.env`

### 6. Google Sheets Setup
1. Go to https://console.cloud.google.com
2. Create a new project
3. Enable **Google Sheets API**
4. Go to **IAM → Service Accounts → Create Service Account**
5. Give it **Editor** role
6. Create JSON key → download it
7. From the JSON, copy:
   - `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `private_key` → `GOOGLE_PRIVATE_KEY`
8. Create a Google Sheet
9. Share the sheet with the service account email (Editor access)
10. Copy the Sheet ID from the URL:
    `https://docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`
11. Paste as `GOOGLE_SHEET_ID`

### 7. MSG91 SMS Setup
1. Sign up at https://msg91.com
2. Complete DLT registration (mandatory for Indian SMS)
3. Create a Tamil transactional template
4. Copy Auth Key and Template ID → paste into `.env`

---

## Deploy to Railway

### Option A: GitHub (recommended)
1. Push this repo to GitHub
2. Go to https://railway.app → New Project → Deploy from GitHub
3. Select your repo
4. Go to **Variables** tab → add all variables from `.env`
5. Railway auto-deploys on every push

### Option B: Railway CLI
```bash
npm install -g @railway/cli
railway login
railway init
railway up
railway variables set ANTHROPIC_API_KEY=xxx SARVAM_API_KEY=xxx ...
```

### After deploy:
1. Copy your Railway URL (e.g. `https://tamil-voice-agent.up.railway.app`)
2. Set it as `BASE_URL` in Railway variables
3. Update Exotel webhook to this URL + `/exotel/inbound`

---

## Project Structure

```
tamil-voice-agent/
├── src/
│   ├── server.js      # Express app + entry point
│   ├── exotel.js      # Call flow + Exotel webhooks
│   ├── claude.js      # AI conversation manager
│   ├── sarvam.js      # Tamil STT + TTS
│   ├── sheets.js      # Google Sheets integration
│   ├── sms.js         # MSG91 SMS confirmations
│   └── logger.js      # Winston logger
├── public/
│   └── audio/         # Temp audio files served to Exotel
├── .env.example
├── railway.toml
└── package.json
```

---

## Google Sheet Output

The system creates an **Appointments** tab with these columns:

| Booking ID | Booked At | Patient Name | Phone | Date | Time | Department | Reason | Caller Phone | Call SID | Status |
|-----------|-----------|--------------|-------|------|------|------------|--------|--------------|----------|--------|
| APT-A1B2C3D4 | 2025-06-01 10:32:00 | ரவி குமார் | 9876543210 | நாளை | காலை | பொது மருத்துவம் | காய்ச்சல் | 919876543210 | EX123456 | Confirmed |

---

## Departments Supported (Tamil)

- பொது மருத்துவம் (General Medicine)
- இதயவியல் (Cardiology)
- எலும்பியல் (Orthopaedics)
- மகளிர் மருத்துவம் (Gynaecology)
- குழந்தை மருத்துவம் (Paediatrics)

---

## Monitoring

- **Health check:** `GET /health`
- **Active calls:** `GET /dashboard`
- Logs available in Railway dashboard under **Deployments → Logs**

---

## Call Flow (Tamil)

```
பிரியா: வணக்கம்! நான் பிரியா, உங்கள் AI appointment assistant.
         உங்கள் பெயரை சொல்லுங்களா?

Patient: என் பெயர் ரவி குமார்.

பிரியா: ரவி குமார், உங்கள் தொலைபேசி எண்ணை சொல்லுங்களா?

Patient: 98765 43210

பிரியா: 9876543210, சரியா? எந்த தேதியில் appointment வேண்டும்?

... (continues until all details collected) ...

பிரியா: உங்கள் appointment confirmed! Booking ID APT-A1B2C3D4.
         SMS confirmation அனுப்பப்பட்டது. நன்றி!
```

---

## Cost Estimate (per month, ~500 calls)

| Service | Cost |
|---------|------|
| Exotel (virtual number + calls) | ₹2,000–5,000 |
| Sarvam AI (STT + TTS) | ₹1,000–3,000 |
| Claude API | $10–30 |
| MSG91 SMS | ₹500–1,000 |
| Railway | $5 |
| **Total** | **~₹5,000–10,000/month** |

---

## License
MIT

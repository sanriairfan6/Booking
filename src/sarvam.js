/**
 * Sarvam AI Service
 * Tamil Speech-to-Text (STT) and Text-to-Speech (TTS)
 * Docs: https://docs.sarvam.ai
 */

const axios = require("axios");
const FormData = require("form-data");
const logger = require("./logger");

const SARVAM_BASE = "https://api.sarvam.ai";

/**
 * Convert audio buffer to Tamil text
 * @param {Buffer} audioBuffer - Raw audio from Exotel (wav/mp3)
 * @param {string} mimeType - e.g. "audio/wav"
 * @returns {string} Transcribed Tamil text
 */
async function speechToText(audioBuffer, mimeType = "audio/wav") {
  try {
    const form = new FormData();
    form.append("file", audioBuffer, {
      filename: "audio.wav",
      contentType: mimeType,
    });
    form.append("language_code", "ta-IN");
    form.append("model", "saarika:v2");       // Sarvam's best Tamil model
    form.append("with_timestamps", "false");
    form.append("with_disfluencies", "false");

    const res = await axios.post(`${SARVAM_BASE}/speech-to-text`, form, {
      headers: {
        ...form.getHeaders(),
        "api-subscription-key": process.env.SARVAM_API_KEY,
      },
      timeout: 15000,
    });

    const transcript = res.data?.transcript || "";
    logger.info("STT result", { transcript });
    return transcript;
  } catch (err) {
    logger.error("Sarvam STT error", { error: err.message });
    throw new Error("Speech recognition failed");
  }
}

/**
 * Convert Tamil text to speech audio buffer
 * @param {string} text - Tamil text to speak
 * @param {string} speaker - Voice name (arjun, diya, etc.)
 * @returns {Buffer} Audio buffer (WAV)
 */
async function textToSpeech(text, speaker = "diya") {
  try {
    // Sarvam supports ~500 chars per request — chunk if needed
    const chunks = chunkText(text, 480);
    const audioBuffers = [];

    for (const chunk of chunks) {
      const res = await axios.post(
        `${SARVAM_BASE}/text-to-speech`,
        {
          inputs: [chunk],
          target_language_code: "ta-IN",
          speaker,                          // "diya" = female, "arjun" = male
          pitch: 0,
          pace: 1.1,                        // Slightly faster for phone clarity
          loudness: 1.5,
          speech_sample_rate: 8000,         // 8kHz for telephony
          enable_preprocessing: true,
          model: "bulbul:v1",
        },
        {
          headers: {
            "Content-Type": "application/json",
            "api-subscription-key": process.env.SARVAM_API_KEY,
          },
          timeout: 15000,
        }
      );

      // Sarvam returns base64-encoded audio
      const audioBase64 = res.data?.audios?.[0];
      if (audioBase64) {
        audioBuffers.push(Buffer.from(audioBase64, "base64"));
      }
    }

    return Buffer.concat(audioBuffers);
  } catch (err) {
    logger.error("Sarvam TTS error", { error: err.message });
    throw new Error("Text-to-speech failed");
  }
}

/**
 * Translate text if needed (Tamil <-> English)
 */
async function translate(text, sourceLang = "en-IN", targetLang = "ta-IN") {
  try {
    const res = await axios.post(
      `${SARVAM_BASE}/translate`,
      {
        input: text,
        source_language_code: sourceLang,
        target_language_code: targetLang,
        speaker_gender: "Female",
        mode: "formal",
        model: "mayura:v1",
        enable_preprocessing: false,
      },
      {
        headers: {
          "Content-Type": "application/json",
          "api-subscription-key": process.env.SARVAM_API_KEY,
        },
      }
    );
    return res.data?.translated_text || text;
  } catch (err) {
    logger.error("Sarvam translate error", { error: err.message });
    return text;
  }
}

function chunkText(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    // Try to break on sentence boundary
    let end = Math.min(i + maxLen, text.length);
    const lastPunct = text.lastIndexOf(".", end);
    if (lastPunct > i + 100) end = lastPunct + 1;
    chunks.push(text.slice(i, end).trim());
    i = end;
  }
  return chunks;
}

module.exports = { speechToText, textToSpeech, translate };

/**
 * Podcast Artwork Generator
 * POST /generate { sessionId, prompt } -> generates image with OpenAI and uploads to R2
 * GET  /health -> { status: "ok" }
 * GET  /image/:key -> returns JSON { url } (public R2 url) or 404
 *
 * Notes:
 * - Requires env vars (see .env.example)
 * - Uses OpenAI official SDK and @aws-sdk/client-s3 for R2
 */

import express from "express";
import dotenv from "dotenv";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import axios from "axios";
import OpenAI from "openai";

dotenv.config();

const {
  OPENAI_API_KEY,
  R2_ACCESS_KEY,
  R2_SECRET_KEY,
  R2_BUCKET_NAME,
  R2_ENDPOINT,
  R2_PUBLIC_BASE_URL,
  PORT = 3000
} = process.env;

if (!OPENAI_API_KEY) {
  console.warn("WARNING: OPENAI_API_KEY not set. /generate will fail without it.");
}
if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME || !R2_ENDPOINT || !R2_PUBLIC_BASE_URL) {
  console.warn("WARNING: R2 environment variables are not fully configured. Uploads will fail.");
}

const app = express();
app.use(express.json({ limit: "1mb" })); // keep request size small

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const s3 = new S3Client({
  region: "auto",
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY || "",
    secretAccessKey: R2_SECRET_KEY || ""
  },
  forcePathStyle: false // R2 works with virtual-host style
});

/** Helpers */
function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function retry(fn, attempts = 3, backoffMs = 500) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn(i);
    } catch (err) {
      lastErr = err;
      const delay = backoffMs * Math.pow(2, i);
      console.warn(`Attempt ${i + 1} failed. Retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }
  throw lastErr;
}

/**
 * Generate an image from OpenAI. Supports both:
 * - image returned as base64 in response.data[0].b64_json
 * - image returned as a remote URL in response.data[0].url
 *
 * Returns a Buffer with PNG (or other) bytes.
 */
async function generateImageBuffer(prompt, size = "1024x1024") {
  // We wrap call in retry for robustness
  const resp = await retry(async () => {
    // Use the official OpenAI images client; API surface might vary by version.
    // We'll call the images.generate endpoint via SDK.
    return await openai.images.generate({
      model: "gpt-image-1",
      prompt,
      size
    });
  }, 3, 700);

  if (!resp || !resp.data || !resp.data.length) {
    throw new Error("OpenAI returned empty image response.");
  }

  const imgEntry = resp.data[0];

  // If API returned base64 (b64_json)
  if (imgEntry.b64_json) {
    const b64 = imgEntry.b64_json;
    return Buffer.from(b64, "base64");
  }

  // If API returned a URL
  if (imgEntry.url) {
    const url = imgEntry.url;
    const imageResp = await axios.get(url, { responseType: "arraybuffer" });
    return Buffer.from(imageResp.data);
  }

  throw new Error("Unknown image format from OpenAI response.");
}

/** Upload buffer to R2 */
async function uploadToR2(buffer, key, contentType = "image/png") {
  const cmd = new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    ACL: undefined // R2 handles via public URL/web settings
  });

  return await s3.send(cmd);
}

/** Routes */
app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.post("/generate", async (req, res) => {
  const { sessionId, prompt } = req.body || {};

  if (!sessionId || !prompt) {
    return res.status(400).json({ error: "sessionId and prompt are required" });
  }

  try {
    // Generate image
    const buffer = await generateImageBuffer(prompt, "1024x1024");

    // Build filename
    const safeSession = String(sessionId).replace(/[^a-zA-Z0-9-_]/g, "_");
    const filename = `${safeSession}-${Date.now()}.png`;

    // Upload
    await uploadToR2(buffer, filename, "image/png");

    // Build public URL (user is responsible for correct R2_PUBLIC_BASE_URL)
    const publicUrl = `${R2_PUBLIC_BASE_URL.replace(/\/$/, "")}/${encodeURIComponent(filename)}`;

    // Return resulting url
    res.json({ url: publicUrl, key: filename });
  } catch (err) {
    console.error("Generation/upload error:", err?.message || err);
    res.status(500).json({ error: "Failed to generate or store image", details: err?.message });
  }
});

/**
 * GET /image/:key
 * Returns JSON { url } pointing to the public R2 URL for the key.
 * Note: This does NOT validate existence on R2 to keep it cheap/fast.
 * If you want server-side existence checks, we can add a head request to S3.
 */
app.get("/image/:key", (req, res) => {
  const key = req.params.key;
  if (!key) return res.status(400).json({ error: "key required" });

  const publicUrl = `${R2_PUBLIC_BASE_URL.replace(/\/$/, "")}/${encodeURIComponent(key)}`;
  res.json({ url: publicUrl });
});

/** Start server */
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

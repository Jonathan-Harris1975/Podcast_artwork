
import express from 'express';
import dotenv from 'dotenv';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

dotenv.config();

const {
  R2_ENDPOINT,
  R2_BUCKET,
  R2_ACCESS_KEY,
  R2_SECRET_KEY,
  PORT = 3000
} = process.env;

const s3 = new S3Client({
  region: 'auto',
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY,
    secretAccessKey: R2_SECRET_KEY
  }
});

const app = express();
app.use(express.json({ limit: '16mb' }));

const put = async (Key, Body, ContentType = 'text/plain') => {
  await s3.send(
    new PutObjectCommand({ Bucket: R2_BUCKET, Key, Body, ContentType })
  );
  return `${R2_ENDPOINT}/${R2_BUCKET}/${Key}`;
};

app.post('/upload-audio', async (req, res) => {
  try {
    const { filename, base64 } = req.body;

    if (!filename || !base64) {
      return res.status(400).json({ error: 'Missing filename or base64 data' });
    }

    const buffer = Buffer.from(base64, 'base64');
    const url = await put(filename, buffer, 'audio/mpeg');

    res.json({ uploaded: true, url });
  } catch (err) {
    console.error('Upload audio failed:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`🚀 R2 TTS uploader running on :${PORT}`));

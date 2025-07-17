
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const folder = process.argv[2] || 'dist';

const client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY,
    secretAccessKey: process.env.R2_SECRET_KEY
  }
});

async function uploadDir(dir, prefix = '') {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const key = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) {
      await uploadDir(full, key);
    } else {
      const body = await readFile(full);
      await client.send(new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: key,
        Body: body
      }));
      console.log(`✅ Uploaded ${key}`);
    }
  }
}
await uploadDir(folder);

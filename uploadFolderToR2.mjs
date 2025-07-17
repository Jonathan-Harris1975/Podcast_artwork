// Updated uploadFolderToR2.mjs to support uploading PNG images to R2 import fs from 'fs'; import path from 'path'; import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'; import mime from 'mime-types'; import dotenv from 'dotenv';

dotenv.config();

const client = new S3Client({ region: process.env.S3_REGION, endpoint: process.env.S3_ENDPOINT, credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY, }, });

const folderPath = './images'; // Folder to upload (update this path if needed) const bucket = process.env.S3_BUCKET;

async function uploadFile(filePath) { const fileContent = fs.readFileSync(filePath); const fileKey = path.basename(filePath); const contentType = mime.lookup(filePath) || 'application/octet-stream';

const command = new PutObjectCommand({ Bucket: bucket, Key: fileKey, Body: fileContent, ContentType: contentType, });

try { await client.send(command); console.log(Uploaded: ${fileKey}); } catch (error) { console.error(Error uploading ${fileKey}:, error); } }

fs.readdirSync(folderPath).forEach(file => { const fullPath = path.join(folderPath, file); if (fs.lstatSync(fullPath).isFile()) { uploadFile(fullPath); } });


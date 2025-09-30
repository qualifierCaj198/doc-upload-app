import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

export const ensureUploadDir = () => {
  const dir = process.env.UPLOAD_DIR || './uploads';
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};
export const getUploadPath = (filename) => {
  const dir = process.env.UPLOAD_DIR || './uploads';
  return path.join(dir, filename);
};

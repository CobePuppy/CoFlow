import 'dotenv/config';
import multer from 'multer';
import 'reflect-metadata';
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
});
export { upload };

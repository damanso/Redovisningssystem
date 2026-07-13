import multer from 'multer';
import { config } from '../config.js';

// En enda plats för uppladdningskonfigurationen (minnesbuffert, storleksgräns,
// UTF-8-filnamn, en fil). Så att en ändrad gräns gäller alla uppladdningsvägar.
export function singleFileUpload() {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.MAX_UPLOAD_BYTES, files: 1 },
    defParamCharset: 'utf8',
  }).single('file');
}

import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import * as quotationController from '../controllers/quotation.controller';
import { auth } from '../middleware/auth';

const router = Router();
router.use(auth);

// Set up multer storage for PDFs
const uploadDir = path.join(process.cwd(), 'uploads', 'quotations');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
        const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, `${unique}${path.extname(file.originalname)}`);
    },
});
const upload = multer({
    storage, fileFilter: (_req, file, cb) => {
        cb(null, file.mimetype === 'application/pdf');
    }
});

// Base path: /api/v1/quotations
router.get('/rfq/:rfqId', quotationController.getRFQQuotations);
router.post('/', quotationController.submitQuotation);
router.post('/:id/select', quotationController.selectQuotation);
router.post('/:id/pdf', upload.single('pdf'), quotationController.uploadPdf);
router.delete('/:id', quotationController.deleteQuotation);

export default router;


import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import * as quotationController from '../controllers/quotation.controller';
import { auth } from '../middleware/auth';

const router = Router();
router.use(auth);

// Set up multer storage for vendor quotation attachments (PDF / Word / Excel)
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
    storage,
    fileFilter: (_req, file, cb) => {
        const allowedMimes = new Set([
            'application/pdf',
            'application/msword', // .doc
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
            'application/vnd.ms-excel', // .xls
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
        ]);

        const ext = path.extname(file.originalname).toLowerCase();
        const allowedExts = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx']);

        const ok = allowedMimes.has(file.mimetype) || allowedExts.has(ext);
        if (!ok) {
            cb(new Error('Only PDF, Word, or Excel files are allowed'));
            return;
        }

        cb(null, true);
    },
});

// Base path: /api/v1/quotations
router.get('/rfq/:rfqId', quotationController.getRFQQuotations);
router.post('/', quotationController.submitQuotation);
router.post('/:id/select', quotationController.selectQuotation);
router.post('/:id/documents', upload.array('files', 10), quotationController.uploadDocuments);
router.post('/:id/documents/:filename/extract-pricing', quotationController.extractDocumentPricing);
router.get('/:id/documents/:filename/file', quotationController.getDocumentFile);
router.delete('/:id/documents/:filename', quotationController.deleteDocument);
router.post('/:id/pdf', upload.single('pdf'), quotationController.uploadPdf);
router.delete('/:id', quotationController.deleteQuotation);

export default router;


import { Router } from 'express';
import * as quotationController from '../controllers/quotation.controller';
import { auth } from '../middleware/auth';

const router = Router();

router.use(auth);

// Base path: /api/v1/quotations
router.get('/rfq/:rfqId', quotationController.getRFQQuotations);
router.post('/', quotationController.submitQuotation);
router.post('/:id/select', quotationController.selectQuotation);
router.delete('/:id', quotationController.deleteQuotation);

export default router;

import { Router } from 'express';
import * as poController from '../controllers/purchaseOrder.controller';
import { purchaseOrdersRateLimiter } from '../middleware/purchaseOrdersRateLimiter';

const router = Router();
router.use(purchaseOrdersRateLimiter);

router.get('/', poController.getAll);
router.get('/:id', poController.getById);
router.post('/', poController.create);
router.post('/from-quotation/:quotationId', poController.createFromQuotation);
router.put('/:id', poController.update);
router.post('/:id/approve', poController.approve);
router.post('/:id/cancel', poController.cancel);
router.post('/:id/close', poController.close);
router.post('/:id/vendor-message', poController.sendVendorMessage);
router.delete('/:id', poController.deletePO);

export default router;

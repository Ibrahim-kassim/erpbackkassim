import { Router } from 'express';
import * as poController from '../controllers/purchaseOrder.controller';
import { auth } from '../middleware/auth';

const router = Router();
router.use(auth);

router.get('/', poController.getAll);
router.get('/:id', poController.getById);
router.post('/', poController.create);
router.post('/from-quotation/:quotationId', poController.createFromQuotation);
router.put('/:id', poController.update);
router.post('/:id/approve', poController.approve);
router.post('/:id/cancel', poController.cancel);
router.post('/:id/close', poController.close);
router.delete('/:id', poController.deletePO);

export default router;

import { Router } from 'express';
import * as controller from '../controllers/arReceipt.controller';

const router = Router();

// Reporting endpoints (before :id to avoid route conflicts)
router.get('/aging', controller.getAging);
router.get('/customer-statement', controller.getCustomerStatement);
router.get('/customer-allocations', controller.getCustomerAllocations);
router.get('/outstanding/:customerId', controller.getOutstandingInvoices);

router.get('/', controller.getAll);
router.get('/:id', controller.getOne);
router.post('/', controller.create);
router.put('/:id', controller.update);
router.post('/:id/post', controller.post);
router.delete('/:id', controller.remove);

export default router;

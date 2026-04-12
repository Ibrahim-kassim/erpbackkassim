import { Router } from 'express';
import * as controller from '../controllers/arReceipt.controller';
import { customerReceiptsRateLimiter } from '../middleware/customerReceiptsRateLimiter';
import { arAgingRateLimiter } from '../middleware/arAgingRateLimiter';
import { customerStatementRateLimiter } from '../middleware/customerStatementRateLimiter';

const router = Router();
router.use(customerReceiptsRateLimiter);

// Reporting endpoints (before :id to avoid route conflicts)
router.get('/aging', arAgingRateLimiter, controller.getAging);
router.get('/customer-statement', customerStatementRateLimiter, controller.getCustomerStatement);
router.get('/customer-allocations', controller.getCustomerAllocations);
router.get('/outstanding/:customerId', controller.getOutstandingInvoices);

router.get('/', controller.getAll);
router.get('/:id', controller.getOne);
router.post('/', controller.create);
router.put('/:id', controller.update);
router.post('/:id/post', controller.post);
router.delete('/:id', controller.remove);

export default router;

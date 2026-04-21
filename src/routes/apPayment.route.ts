import { Router } from 'express';
import * as controller from '../controllers/apPayment.controller';
import * as agingController from '../controllers/apAging.controller';
import { vendorPaymentsRateLimiter } from '../middleware/vendorPaymentsRateLimiter';
import { apAgingRateLimiter } from '../middleware/apAgingRateLimiter';
import { vendorStatementRateLimiter } from '../middleware/vendorStatementRateLimiter';

const router = Router();

// Reporting endpoints
router.get('/aging', apAgingRateLimiter, agingController.getAPAging);
router.get('/aging-reconciliation', apAgingRateLimiter, agingController.getAPAgingReconciliation);
router.get('/vendor-statement', vendorStatementRateLimiter, agingController.getVendorStatement);
router.get('/vendor-allocations', vendorStatementRateLimiter, agingController.getVendorAllocations);

router.get('/', vendorPaymentsRateLimiter, controller.getAll);
router.get('/outstanding/:vendorId', vendorPaymentsRateLimiter, controller.getOutstandingBills);
router.get('/:id', vendorPaymentsRateLimiter, controller.getOne);
router.post('/', vendorPaymentsRateLimiter, controller.create);
router.put('/:id', vendorPaymentsRateLimiter, controller.update);
router.post('/:id/post', vendorPaymentsRateLimiter, controller.post);
router.post('/:id/vendor-message', vendorPaymentsRateLimiter, controller.sendVendorMessage);
router.delete('/:id', vendorPaymentsRateLimiter, controller.remove);

export default router;

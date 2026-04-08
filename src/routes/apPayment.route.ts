import { Router } from 'express';
import * as controller from '../controllers/apPayment.controller';
import * as agingController from '../controllers/apAging.controller';

const router = Router();

// Reporting endpoints
router.get('/aging', agingController.getAPAging);
router.get('/aging-reconciliation', agingController.getAPAgingReconciliation);
router.get('/vendor-statement', agingController.getVendorStatement);
router.get('/vendor-allocations', agingController.getVendorAllocations);

router.get('/', controller.getAll);
router.get('/outstanding/:vendorId', controller.getOutstandingBills);
router.get('/:id', controller.getOne);
router.post('/', controller.create);
router.put('/:id', controller.update);
router.post('/:id/post', controller.post);
router.delete('/:id', controller.remove);

export default router;

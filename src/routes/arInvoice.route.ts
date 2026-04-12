import { Router } from 'express';
import * as controller from '../controllers/arInvoice.controller';
import { customerInvoicesRateLimiter } from '../middleware/customerInvoicesRateLimiter';

const router = Router();
router.use(customerInvoicesRateLimiter);

router.get('/', controller.getAll);
router.get('/:id', controller.getOne);
router.post('/', controller.create);
router.put('/:id', controller.update);
router.post('/:id/post', controller.post);
router.post('/:id/void', controller.voidInvoice);
router.post('/:id/customer-message', controller.sendCustomerMessage);
router.delete('/:id', controller.remove);

export default router;

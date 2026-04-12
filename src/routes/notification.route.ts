import { Router } from 'express';
import * as controller from '../controllers/notification.controller';
import { notificationsRateLimiter } from '../middleware/notificationsRateLimiter';

const router = Router();
router.use(notificationsRateLimiter);

router.get('/', controller.list);
router.get('/rfq/:rfqId', controller.listRFQThread);
router.get('/ar-invoice/:arInvoiceId', controller.listARInvoiceThread);
router.post('/sync-mailbox', controller.syncMailbox);
router.post('/read-all', controller.markAllRead);
router.post('/:id/read', controller.markRead);

export default router;

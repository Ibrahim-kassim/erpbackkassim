import { Router } from 'express';
import * as controller from '../controllers/notification.controller';

const router = Router();

router.get('/', controller.list);
router.post('/sync-mailbox', controller.syncMailbox);
router.post('/read-all', controller.markAllRead);
router.post('/:id/read', controller.markRead);

export default router;

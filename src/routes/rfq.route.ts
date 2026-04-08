import { Router } from 'express';
import * as controller from '../controllers/rfq.controller';

const router = Router();

router.get('/', controller.getAll);
router.get('/:id', controller.getOne);
router.get('/:id/email-replies', controller.getEmailReplies);
router.post('/', controller.create);
router.put('/:id', controller.update);
router.post('/:id/send', controller.send);
router.post('/:id/send-email', controller.sendEmail);
router.post('/:id/vendor-message', controller.sendVendorMessage);
router.post('/:id/close', controller.close);
router.delete('/:id', controller.remove);

export default router;

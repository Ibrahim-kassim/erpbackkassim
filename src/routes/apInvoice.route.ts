import { Router } from 'express';
import * as controller from '../controllers/apInvoice.controller';

const router = Router();

router.get('/', controller.getAll);
router.get('/:id', controller.getOne);
router.post('/', controller.create);
router.put('/:id', controller.update);
router.post('/:id/post', controller.post);
router.post('/:id/void', controller.voidInvoice);
router.delete('/:id', controller.remove);

export default router;

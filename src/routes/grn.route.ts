import { Router } from 'express';
import * as controller from '../controllers/grn.controller';

const router = Router();

router.get('/', controller.getAll);
router.get('/:id', controller.getOne);
router.post('/', controller.create);
router.put('/:id', controller.update);
router.post('/:id/confirm', controller.confirm);
router.post('/:id/cancel', controller.cancel);
router.delete('/:id', controller.remove);

export default router;

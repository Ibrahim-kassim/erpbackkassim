import { Router } from 'express';
import * as controller from '../controllers/businessPartner.controller';

const router = Router();

router.get('/', controller.getAll);
router.post('/import', controller.importRows);
router.get('/:id', controller.getOne);
router.post('/', controller.create);
router.put('/:id', controller.update);
router.patch('/:id/status', controller.updateStatus);
router.delete('/:id', controller.remove);

export default router;

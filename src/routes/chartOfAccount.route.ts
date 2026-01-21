import { Router } from 'express';
import * as controller from '../controllers/chartOfAccount.controller';
// import { auth } from '../middleware/auth'; // already applied globally or here

const router = Router();

router.get('/', controller.list);
router.get('/tree', controller.getTree);
router.get('/posting', controller.getPosting);
router.get('/:id', controller.getById);

router.post('/', controller.create);
router.patch('/:id', controller.update);
router.post('/:id/activate', controller.activate);
router.post('/:id/deactivate', controller.deactivate);
router.delete('/:id', controller.remove);

export default router;

import { Router } from 'express';
import * as controller from '../controllers/businessPartner.controller';
import { businessPartnersRateLimiter } from '../middleware/businessPartnersRateLimiter';

const router = Router();
router.use(businessPartnersRateLimiter);

router.get('/', controller.getAll);
router.post('/import', controller.importRows);
router.get('/:id', controller.getOne);
router.post('/', controller.create);
router.put('/:id', controller.update);
router.patch('/:id/status', controller.updateStatus);
router.delete('/:id', controller.remove);

export default router;

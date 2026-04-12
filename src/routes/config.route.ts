import { Router } from 'express';
import * as controller from '../controllers/config.controller';
import { settingsRateLimiter } from '../middleware/settingsRateLimiter';

const router = Router();
router.use(settingsRateLimiter);

router.get('/', controller.getConfig);
router.put('/', controller.updateConfig);

export default router;

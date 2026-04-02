import { Router } from 'express';
import * as controller from '../controllers/config.controller';

const router = Router();

router.get('/', controller.getConfig);
router.put('/', controller.updateConfig);

export default router;

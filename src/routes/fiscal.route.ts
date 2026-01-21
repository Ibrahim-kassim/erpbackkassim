import express from 'express';
import * as controller from '../controllers/fiscal.controller';

const router = express.Router();

router.get('/', controller.listPeriods);
router.get('/:id', controller.getPeriodById);

export default router;

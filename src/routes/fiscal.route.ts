import express from 'express';
import * as controller from '../controllers/fiscal.controller';

const router = express.Router();

router.get('/years', controller.getFiscalYears);
router.post('/years', controller.createFiscalYear);
router.get('/years/:id', controller.getFiscalYearById);
router.patch('/years/:id', controller.updateFiscalYear);
router.post('/years/:id/close', controller.closeFiscalYear); // Close year

router.post('/years/:id/generate-periods', controller.generatePeriods);
router.patch('/years/:yearId/periods/:periodId/status', controller.updatePeriodStatus);

router.get('/resolve', controller.resolveDate);

export default router;

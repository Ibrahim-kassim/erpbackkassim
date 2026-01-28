import { Router } from 'express';
import { trialBalanceController } from '../controllers/trialBalance.controller';

const router = Router();

router.get('/trial-balance', trialBalanceController.getTrialBalance);
router.get('/trial-balance-hier', trialBalanceController.getHierarchicalTrialBalance);

export default router;

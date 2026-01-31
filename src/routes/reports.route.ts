import { Router } from 'express';
import { trialBalanceController } from '../controllers/trialBalance.controller';
import { generalLedgerController } from '../controllers/generalLedger.controller';
import { generalLedgerLinesController } from '../controllers/generalLedgerLines.controller';
import { financialStatementsController } from '../controllers/financialStatements.controller';

const router = Router();

router.get('/trial-balance', trialBalanceController.getTrialBalance);
router.get('/trial-balance-hier', trialBalanceController.getHierarchicalTrialBalance);
router.get('/general-ledger', generalLedgerController.getGeneralLedger);
router.get('/general-ledger/lines', generalLedgerLinesController.getLines);
router.get('/financial-statements', financialStatementsController.getFinancialStatements);

export default router;


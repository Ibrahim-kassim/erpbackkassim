import { Router } from 'express';
import { trialBalanceController } from '../controllers/trialBalance.controller';
import { generalLedgerController } from '../controllers/generalLedger.controller';
import { generalLedgerLinesController } from '../controllers/generalLedgerLines.controller';
import { generalLedgerAiController } from '../controllers/generalLedgerAi.controller';
import { financialStatementsController } from '../controllers/financialStatements.controller';
import { dashboardController } from '../controllers/dashboard.controller';
import { dashboardChatController } from '../controllers/dashboardChat.controller';

const router = Router();

router.get('/trial-balance', trialBalanceController.getTrialBalance);
router.get('/trial-balance-hier', trialBalanceController.getHierarchicalTrialBalance);
router.get('/general-ledger', generalLedgerController.getGeneralLedger);
router.get('/general-ledger/lines', generalLedgerLinesController.getLines);
router.get('/general-ledger/explain', generalLedgerAiController.explain);
router.get('/general-ledger/anomalies', generalLedgerAiController.anomalies);
router.get('/general-ledger/source-summary', generalLedgerAiController.sourceSummary);
router.get('/general-ledger/entry-narrative', generalLedgerAiController.entryNarrative);
router.post('/general-ledger/query', generalLedgerAiController.query);
router.get('/financial-statements', financialStatementsController.getFinancialStatements);
router.get('/dashboard/overview', dashboardController.overview);
router.post('/dashboard/query', dashboardController.query);
router.get('/dashboard/chat/sessions', dashboardChatController.listSessions);
router.post('/dashboard/chat/session', dashboardChatController.createSession);
router.get('/dashboard/chat/session/:id', dashboardChatController.getSession);
router.post('/dashboard/chat/message', dashboardChatController.message);
router.post('/dashboard/chat/action', dashboardChatController.action);
router.get('/dashboard/chat/export/:artifactId', dashboardChatController.downloadArtifact);

export default router;


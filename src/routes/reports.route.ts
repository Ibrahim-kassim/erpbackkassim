import { Router } from 'express';
import { trialBalanceController } from '../controllers/trialBalance.controller';
import { generalLedgerController } from '../controllers/generalLedger.controller';
import { generalLedgerLinesController } from '../controllers/generalLedgerLines.controller';
import { generalLedgerAiController } from '../controllers/generalLedgerAi.controller';
import { financialStatementsController } from '../controllers/financialStatements.controller';
import { dashboardController } from '../controllers/dashboard.controller';
import { dashboardChatController } from '../controllers/dashboardChat.controller';
import { trialBalanceRateLimiter } from '../middleware/trialBalanceRateLimiter';
import { generalLedgerRateLimiter } from '../middleware/generalLedgerRateLimiter';
import { financialStatementsRateLimiter } from '../middleware/financialStatementsRateLimiter';
import {
    dashboardChatConversationRateLimiter,
    dashboardChatReadRateLimiter,
    dashboardChatSessionRateLimiter,
} from '../middleware/dashboardChatRateLimiter';

const router = Router();
router.use('/general-ledger', generalLedgerRateLimiter);

router.get('/trial-balance', trialBalanceRateLimiter, trialBalanceController.getTrialBalance);
router.get('/trial-balance-hier', trialBalanceRateLimiter, trialBalanceController.getHierarchicalTrialBalance);
router.get('/general-ledger', generalLedgerController.getGeneralLedger);
router.get('/general-ledger/lines', generalLedgerLinesController.getLines);
router.get('/general-ledger/explain', generalLedgerAiController.explain);
router.get('/general-ledger/anomalies', generalLedgerAiController.anomalies);
router.get('/general-ledger/source-summary', generalLedgerAiController.sourceSummary);
router.get('/general-ledger/entry-narrative', generalLedgerAiController.entryNarrative);
router.post('/general-ledger/query', generalLedgerAiController.query);
router.get('/financial-statements', financialStatementsRateLimiter, financialStatementsController.getFinancialStatements);
router.get('/dashboard/overview', dashboardController.overview);
router.post('/dashboard/query', dashboardController.query);
router.get('/dashboard/chat/sessions', dashboardChatReadRateLimiter, dashboardChatController.listSessions);
router.post('/dashboard/chat/session', dashboardChatSessionRateLimiter, dashboardChatController.createSession);
router.get('/dashboard/chat/session/:id', dashboardChatReadRateLimiter, dashboardChatController.getSession);
router.delete('/dashboard/chat/session/:id', dashboardChatSessionRateLimiter, dashboardChatController.deleteSession);
router.post('/dashboard/chat/message', dashboardChatConversationRateLimiter, dashboardChatController.message);
router.post('/dashboard/chat/action', dashboardChatConversationRateLimiter, dashboardChatController.action);
router.get('/dashboard/chat/export/:artifactId', dashboardChatReadRateLimiter, dashboardChatController.downloadArtifact);

export default router;


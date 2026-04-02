import { Request, Response } from 'express';
import { ZodError } from 'zod';
import {
    anomaliesLedgerQuerySchema,
    entryNarrativeQuerySchema,
    explainLedgerQuerySchema,
    ledgerQuestionSchema,
    sourceSummaryLedgerQuerySchema,
} from '../validators/generalLedgerAi.schema';
import * as ledgerInvestigationService from '../services/ledgerInvestigation.service';

const handleError = (error: unknown, res: Response) => {
    console.error('General Ledger AI Error:', error);

    if (error instanceof ZodError) {
        return res.status(400).json({
            success: false,
            message: 'Invalid AI investigation request',
            errors: error.errors,
        });
    }

    return res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Internal Server Error',
    });
};

export const generalLedgerAiController = {
    explain: async (req: Request, res: Response) => {
        try {
            const query = explainLedgerQuerySchema.parse(req.query);
            const result = await ledgerInvestigationService.explainMovement(req.tenantId!, query);
            res.json({ success: true, data: result });
        } catch (error) {
            return handleError(error, res);
        }
    },

    anomalies: async (req: Request, res: Response) => {
        try {
            const query = anomaliesLedgerQuerySchema.parse(req.query);
            const result = await ledgerInvestigationService.detectAnomalies(req.tenantId!, query);
            res.json({ success: true, data: result });
        } catch (error) {
            return handleError(error, res);
        }
    },

    sourceSummary: async (req: Request, res: Response) => {
        try {
            const query = sourceSummaryLedgerQuerySchema.parse(req.query);
            const result = await ledgerInvestigationService.sourceSummary(req.tenantId!, query);
            res.json({ success: true, data: result });
        } catch (error) {
            return handleError(error, res);
        }
    },

    entryNarrative: async (req: Request, res: Response) => {
        try {
            const query = entryNarrativeQuerySchema.parse(req.query);
            const result = await ledgerInvestigationService.entryNarrative(req.tenantId!, query.entryId);
            res.json({ success: true, data: result });
        } catch (error) {
            return handleError(error, res);
        }
    },

    query: async (req: Request, res: Response) => {
        try {
            const body = ledgerQuestionSchema.parse(req.body);
            const result = await ledgerInvestigationService.askQuestion(req.tenantId!, body);
            res.json({ success: true, data: result });
        } catch (error) {
            return handleError(error, res);
        }
    },
};

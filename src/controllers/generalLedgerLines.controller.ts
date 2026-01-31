
import { Request, Response } from 'express';
import { generalLedgerLinesService } from '../services/generalLedgerLines.service';
import { generalLedgerLinesQuerySchema } from '../validators/generalLedgerLines.schema';
import { ZodError } from 'zod';

export const generalLedgerLinesController = {
    getLines: async (req: Request, res: Response) => {
        try {
            const query = generalLedgerLinesQuerySchema.parse(req.query);
            const tenantId = (req as any).tenantId; // Auth middleware

            const result = await generalLedgerLinesService.generateReport(tenantId, query);

            res.json({
                success: true,
                data: result
            });
        } catch (error) {
            console.error('General Ledger Lines Error:', error);
            if (error instanceof ZodError) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid query parameters",
                    errors: error.errors
                });
            }
            res.status(500).json({
                success: false,
                message: error instanceof Error ? error.message : "Internal Server Error"
            });
        }
    }
};

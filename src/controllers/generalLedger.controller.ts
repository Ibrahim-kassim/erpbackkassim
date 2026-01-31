
import { Request, Response } from 'express';
import { generalLedgerService } from '../services/generalLedger.service';
import { generalLedgerQuerySchema } from '../validators/generalLedger.schema';
import { ZodError } from 'zod';

export const generalLedgerController = {
    getGeneralLedger: async (req: Request, res: Response) => {
        try {
            // 1. Validate Query
            const query = generalLedgerQuerySchema.parse(req.query);

            // 2. Generate Report
            // Assuming tenantId is attached to req by auth middleware
            const tenantId = (req as any).tenantId;

            const result = await generalLedgerService.generateReport(tenantId, query);

            res.json({
                success: true,
                data: result
            });
        } catch (error) {
            console.error('General Ledger Error:', error);

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

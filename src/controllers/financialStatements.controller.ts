import { Request, Response } from 'express';
import { financialStatementsService } from '../services/financialStatements.service';
import { financialStatementsQuerySchema } from '../validators/financialStatements.schema';

export const financialStatementsController = {
    getFinancialStatements: async (req: Request, res: Response) => {
        try {
            const query = financialStatementsQuerySchema.parse(req.query);
            const tenantId = req.tenantId!;

            const report = await financialStatementsService.generateStatements(tenantId, query);
            res.json(report);
        } catch (error: unknown) {
            console.error('Financial Statement Error:', error);
            res.status(500).json({
                message: error instanceof Error ? error.message : 'Error generating financial statements'
            });
        }
    }
};

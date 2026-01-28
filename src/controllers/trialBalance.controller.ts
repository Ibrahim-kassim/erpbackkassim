import { Request, Response, NextFunction } from 'express';
import { trialBalanceService } from '../services/trialBalance.service';
import { trialBalanceQuerySchema } from '../validators/trialBalance.schema';

export class TrialBalanceController {

    async getTrialBalance(req: Request, res: Response, next: NextFunction) {
        try {
            const tenantId = req.tenantId!; // Middleware guarantees this

            // Validate Query
            const queryResult = trialBalanceQuerySchema.safeParse(req.query);

            if (!queryResult.success) {
                res.status(400).json({
                    message: "Validation Error",
                    errors: queryResult.error.errors
                });
                return;
            }

            // Check mode
            const view = (req.query.view as string) || 'TREE'; // Default to TREE if new endpoint called? 
            // Better: stick to simple endpoint for FLAT, new endpoint for TREE, or use view param.

            // User requested /trial-balance-hier, but we can merge logic or keep separate.
            // Let's assume we map route to this controller.

            const result = await trialBalanceService.generateReport(tenantId, queryResult.data);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }

    async getHierarchicalTrialBalance(req: Request, res: Response, next: NextFunction) {
        try {
            const tenantId = req.tenantId!;
            const queryResult = trialBalanceQuerySchema.safeParse(req.query);

            if (!queryResult.success) {
                res.status(400).json({
                    message: "Validation Error",
                    errors: queryResult.error.errors
                });
                return;
            }

            const result = await trialBalanceService.generateHierarchicalReport(tenantId, queryResult.data);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
}

export const trialBalanceController = new TrialBalanceController();

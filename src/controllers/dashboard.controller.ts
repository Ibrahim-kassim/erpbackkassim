import { Request, Response, NextFunction } from 'express';
import { dashboardQuerySchema } from '../validators/dashboard.schema';
import * as dashboardService from '../services/dashboard.service';

export const dashboardController = {
    overview: async (req: Request, res: Response, next: NextFunction) => {
        try {
            const tenantId = req.tenantId!;
            const result = await dashboardService.getDashboardOverview(tenantId);
            res.status(200).json({ data: result });
        } catch (error) {
            next(error);
        }
    },

    query: async (req: Request, res: Response, next: NextFunction) => {
        try {
            const tenantId = req.tenantId!;
            const validation = dashboardQuerySchema.safeParse(req.body);

            if (!validation.success) {
                res.status(400).json({
                    code: 'VALIDATION_ERROR',
                    message: 'Invalid dashboard question',
                    details: validation.error.format(),
                });
                return;
            }

            const result = await dashboardService.queryDashboard(tenantId, validation.data);
            res.status(200).json({ data: result });
        } catch (error) {
            next(error);
        }
    },
};

import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { FiscalPeriod } from '../models/fiscalPeriod.model';

export const listPeriods = asyncHandler(async (req: Request, res: Response) => {
    const periods = await FiscalPeriod.find({ tenantId: req.tenantId }).sort({ startDate: 1 });
    res.json({ data: periods });
});

export const getPeriodById = asyncHandler(async (req: Request, res: Response) => {
    const period = await FiscalPeriod.findById(req.params.id);
    if (!period) throw new Error('Period not found');
    res.json({ data: period });
});

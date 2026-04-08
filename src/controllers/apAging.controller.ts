import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import * as agingService from '../services/apAging.service';

export const getAPAging = asyncHandler(async (req: Request, res: Response) => {
    const { vendorId, asOfDate, includeZero } = req.query as { vendorId?: string; asOfDate?: string; includeZero?: string };
    const data = await agingService.getAPAging(req.tenantId!, vendorId, asOfDate, includeZero === 'true');
    res.status(200).json({ data });
});

export const getAPAgingReconciliation = asyncHandler(async (req: Request, res: Response) => {
    const { asOfDate, apAccountId } = req.query as { asOfDate?: string; apAccountId?: string };
    if (!apAccountId) {
        res.status(400).json({ code: 'VALIDATION_ERROR', message: 'apAccountId is required' });
        return;
    }
    const data = await agingService.getAPReconciliationStats(req.tenantId!, asOfDate, apAccountId);
    res.status(200).json({ data });
});

export const getVendorStatement = asyncHandler(async (req: Request, res: Response) => {
    const { vendorId, asOfDate, fromDate } = req.query as { vendorId?: string; asOfDate?: string; fromDate?: string };
    if (!vendorId) {
        res.status(400).json({ code: 'VALIDATION_ERROR', message: 'vendorId is required' });
        return;
    }
    const data = await agingService.getVendorStatement(req.tenantId!, vendorId, asOfDate, fromDate);
    res.status(200).json({ data });
});

export const getVendorAllocations = asyncHandler(async (req: Request, res: Response) => {
    const { vendorId, asOfDate } = req.query as { vendorId?: string; asOfDate?: string };
    if (!vendorId) {
        res.status(400).json({ code: 'VALIDATION_ERROR', message: 'vendorId is required' });
        return;
    }
    const data = await agingService.getVendorAllocations(req.tenantId!, vendorId, asOfDate);
    res.status(200).json({ data });
});

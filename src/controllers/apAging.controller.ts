import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import * as agingService from '../services/apAging.service';

export const getAPAging = asyncHandler(async (req: Request, res: Response) => {
    const { vendorId } = req.query as { vendorId?: string };
    const data = await agingService.getAPAging(req.tenantId!, vendorId);
    res.status(200).json({ data });
});

export const getVendorStatement = asyncHandler(async (req: Request, res: Response) => {
    const { vendorId } = req.query as { vendorId?: string };
    if (!vendorId) {
        res.status(400).json({ code: 'VALIDATION_ERROR', message: 'vendorId is required' });
        return;
    }
    const data = await agingService.getVendorStatement(req.tenantId!, vendorId);
    res.status(200).json({ data });
});

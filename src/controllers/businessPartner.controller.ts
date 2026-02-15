import { Request, Response } from 'express';
import { createBusinessPartnerSchema, updateBusinessPartnerSchema } from '../validators/businessPartner.schema';
import * as service from '../services/businessPartner.service';
import { asyncHandler } from '../middleware/asyncHandler';

export const create = asyncHandler(async (req: Request, res: Response) => {
    // Only pick allowed fields from body, ignoring extra fields like arAccountId/apAccountId
    const validation = createBusinessPartnerSchema.safeParse(req.body);
    if (!validation.success) {
        res.status(400).json({
            code: 'VALIDATION_ERROR',
            message: 'Invalid inputs',
            details: validation.error.format()
        });
        return;
    }

    const data = await service.createBusinessPartner(validation.data, req.tenantId!);
    res.status(201).json({ data });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
    // Only pick allowed fields from body
    const validation = updateBusinessPartnerSchema.safeParse(req.body);
    if (!validation.success) {
        res.status(400).json({
            code: 'VALIDATION_ERROR',
            message: 'Invalid inputs',
            details: validation.error.format()
        });
        return;
    }

    const data = await service.updateBusinessPartner(req.params.id, validation.data, req.tenantId!);
    res.status(200).json({ data });
});

export const getOne = asyncHandler(async (req: Request, res: Response) => {
    const data = await service.getBusinessPartner(req.params.id, req.tenantId!);
    res.status(200).json({ data });
});

export const getAll = asyncHandler(async (req: Request, res: Response) => {
    const data = await service.getBusinessPartners(req.query, req.tenantId!);
    res.status(200).json({ data });
});

export const updateStatus = asyncHandler(async (req: Request, res: Response) => {
    const { status } = req.body;
    if (!['ACTIVE', 'INACTIVE'].includes(status)) {
        res.status(400).json({
            code: 'VALIDATION_ERROR',
            message: 'Invalid status. Must be ACTIVE or INACTIVE'
        });
        return;
    }
    const data = await service.updateStatus(req.params.id, status, req.tenantId!);
    res.status(200).json({ data });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
    await service.softDeleteBusinessPartner(req.params.id, req.tenantId!);
    res.status(200).json({ success: true });
});

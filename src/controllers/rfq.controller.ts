import { Request, Response } from 'express';
import { createRFQSchema, sendRFQEmailSchema, sendRFQVendorMessageSchema, updateRFQSchema } from '../validators/rfq.schema';
import * as service from '../services/rfq.service';
import { asyncHandler } from '../middleware/asyncHandler';

export const create = asyncHandler(async (req: Request, res: Response) => {
    const validation = createRFQSchema.safeParse(req.body);
    if (!validation.success) {
        res.status(400).json({
            code: 'VALIDATION_ERROR',
            message: 'Invalid inputs',
            details: validation.error.format()
        });
        return;
    }

    const data = await service.createRFQ(validation.data, req.tenantId!);
    res.status(201).json({ data });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
    const validation = updateRFQSchema.safeParse(req.body);
    if (!validation.success) {
        res.status(400).json({
            code: 'VALIDATION_ERROR',
            message: 'Invalid inputs',
            details: validation.error.format()
        });
        return;
    }

    const data = await service.updateRFQ(req.params.id, validation.data, req.tenantId!);
    res.status(200).json({ data });
});

export const getAll = asyncHandler(async (req: Request, res: Response) => {
    const data = await service.getRFQList(req.query, req.tenantId!);
    res.status(200).json({ data });
});

export const getOne = asyncHandler(async (req: Request, res: Response) => {
    const data = await service.getRFQById(req.params.id, req.tenantId!);
    res.status(200).json({ data });
});

export const getEmailReplies = asyncHandler(async (req: Request, res: Response) => {
    const data = await service.getRFQEmailReplies(req.params.id, req.tenantId!);
    res.status(200).json({ data });
});

export const send = asyncHandler(async (req: Request, res: Response) => {
    const data = await service.sendRFQ(req.params.id, req.tenantId!);
    res.status(200).json({ data });
});

export const sendEmail = asyncHandler(async (req: Request, res: Response) => {
    const validation = sendRFQEmailSchema.safeParse(req.body);
    if (!validation.success) {
        res.status(400).json({
            code: 'VALIDATION_ERROR',
            message: 'Invalid inputs',
            details: validation.error.format()
        });
        return;
    }

    const data = await service.sendRFQEmails(req.params.id, validation.data, req.tenantId!);
    res.status(200).json({ data });
});

export const sendVendorMessage = asyncHandler(async (req: Request, res: Response) => {
    const validation = sendRFQVendorMessageSchema.safeParse(req.body);
    if (!validation.success) {
        res.status(400).json({
            code: 'VALIDATION_ERROR',
            message: 'Invalid inputs',
            details: validation.error.format()
        });
        return;
    }

    const data = await service.sendRFQVendorMessage(req.params.id, validation.data, req.tenantId!);
    res.status(200).json({ data });
});

export const close = asyncHandler(async (req: Request, res: Response) => {
    const data = await service.closeRFQ(req.params.id, req.tenantId!);
    res.status(200).json({ data });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
    await service.deleteRFQ(req.params.id, req.tenantId!);
    res.status(200).json({ success: true, message: 'RFQ deleted successfully' });
});

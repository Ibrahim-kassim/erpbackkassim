import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { createARReceiptSchema, updateARReceiptSchema } from '../validators/arReceipt.schema';
import * as service from '../services/arReceipt.service';
import * as agingService from '../services/arAging.service';

export const getAll = asyncHandler(async (req: Request, res: Response) => {
    const result = await service.list(req.query, req.tenantId!);
    res.status(200).json(result);
});

export const getOne = asyncHandler(async (req: Request, res: Response) => {
    const data = await service.getById(req.params.id, req.tenantId!);
    res.status(200).json({ data });
});

export const getOutstandingInvoices = asyncHandler(async (req: Request, res: Response) => {
    const data = await service.getOutstandingInvoices(req.params.customerId, req.tenantId!);
    res.status(200).json({ data });
});

export const getAging = asyncHandler(async (req: Request, res: Response) => {
    const { customerId } = req.query as { customerId?: string };
    const data = await agingService.getARAging(req.tenantId!, customerId);
    res.status(200).json({ data });
});

export const getCustomerStatement = asyncHandler(async (req: Request, res: Response) => {
    const { customerId } = req.query as { customerId?: string };
    if (!customerId) {
        res.status(400).json({ code: 'VALIDATION_ERROR', message: 'customerId is required' });
        return;
    }
    const data = await agingService.getCustomerStatement(req.tenantId!, customerId);
    res.status(200).json({ data });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
    const validation = createARReceiptSchema.safeParse(req.body);
    if (!validation.success) {
        res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid inputs', details: validation.error.format() });
        return;
    }
    const data = await service.create(validation.data, req.tenantId!);
    res.status(201).json({ data });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
    const validation = updateARReceiptSchema.safeParse(req.body);
    if (!validation.success) {
        res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid inputs', details: validation.error.format() });
        return;
    }
    const data = await service.update(req.params.id, validation.data, req.tenantId!);
    res.status(200).json({ data });
});

export const post = asyncHandler(async (req: Request, res: Response) => {
    const data = await service.post(req.params.id, req.tenantId!);
    res.status(200).json({ data });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
    await service.remove(req.params.id, req.tenantId!);
    res.status(200).json({ success: true });
});

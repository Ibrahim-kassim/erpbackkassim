import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import * as service from '../services/grn.service';
import { cancelGRNSchema, createGRNSchema, updateGRNSchema } from '../validators/grn.schema';

export const getAll = asyncHandler(async (req: Request, res: Response) => {
    const data = await service.list(req.query, req.tenantId!);
    res.status(200).json({ data });
});

export const getOne = asyncHandler(async (req: Request, res: Response) => {
    const data = await service.getById(req.params.id, req.tenantId!);
    res.status(200).json({ data });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
    const validation = createGRNSchema.safeParse(req.body);
    if (!validation.success) {
        res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid inputs', details: validation.error.format() });
        return;
    }

    const data = await service.create(validation.data, req.tenantId!);
    res.status(201).json({ data });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
    const validation = updateGRNSchema.safeParse(req.body);
    if (!validation.success) {
        res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid inputs', details: validation.error.format() });
        return;
    }

    const data = await service.update(req.params.id, validation.data, req.tenantId!);
    res.status(200).json({ data });
});

export const confirm = asyncHandler(async (req: Request, res: Response) => {
    const data = await service.confirm(req.params.id, req.tenantId!);
    res.status(200).json({ data });
});

export const cancel = asyncHandler(async (req: Request, res: Response) => {
    const validation = cancelGRNSchema.safeParse(req.body);
    if (!validation.success) {
        res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid inputs', details: validation.error.format() });
        return;
    }

    const data = await service.cancel(req.params.id, validation.data, req.tenantId!);
    res.status(200).json({ data });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
    await service.remove(req.params.id, req.tenantId!);
    res.status(200).json({ success: true });
});

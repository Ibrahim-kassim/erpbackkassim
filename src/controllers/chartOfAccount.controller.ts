import { Request, Response } from 'express';
import { createAccountSchema, updateAccountSchema } from '../validators/chartOfAccount.schema';
import * as service from '../services/chartOfAccount.service';
import { asyncHandler } from '../middleware/asyncHandler';

export const create = asyncHandler(async (req: Request, res: Response) => {
    const validation = createAccountSchema.safeParse(req.body);
    if (!validation.success) {
        res.status(400).json({
            code: 'VALIDATION_ERROR',
            message: 'Invalid inputs',
            details: validation.error.format()
        });
        return;
    }

    const data = await service.createAccount(validation.data, req.tenantId!);
    res.status(201).json({ data });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
    const validation = updateAccountSchema.safeParse(req.body);
    if (!validation.success) {
        res.status(400).json({
            code: 'VALIDATION_ERROR',
            message: 'Invalid inputs',
            details: validation.error.format()
        });
        return;
    }

    const data = await service.updateAccount(req.params.id, validation.data, req.tenantId!);
    res.status(200).json({ data });
});

export const activate = asyncHandler(async (req: Request, res: Response) => {
    const data = await service.updateAccount(req.params.id, { isActive: true }, req.tenantId!);
    res.status(200).json({ data });
});

export const deactivate = asyncHandler(async (req: Request, res: Response) => {
    const data = await service.updateAccount(req.params.id, { isActive: false }, req.tenantId!);
    res.status(200).json({ data });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
    await service.deleteAccount(req.params.id, req.tenantId!);
    res.status(200).json({ success: true });
});

export const list = asyncHandler(async (req: Request, res: Response) => {
    const data = await service.listAccounts(req.query, req.tenantId!);
    res.status(200).json({ data });
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
    const data = await service.getAccountById(req.params.id, req.tenantId!);
    res.status(200).json({ data });
});

export const getTree = asyncHandler(async (req: Request, res: Response) => {
    const data = await service.getAccountTree(req.tenantId!);
    res.status(200).json({ data });
});

export const getPosting = asyncHandler(async (req: Request, res: Response) => {
    const data = await service.getPostingAccounts(req.tenantId!);
    res.status(200).json({ data });
});

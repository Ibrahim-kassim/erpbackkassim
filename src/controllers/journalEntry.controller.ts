import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import * as service from '../services/journalEntry.service';
import { createDraftSchema, updateDraftSchema, reverseEntrySchema } from '../validators/journalEntry.schema';

export const list = asyncHandler(async (req: Request, res: Response) => {
    const result = await service.listEntries(req.query, req.tenantId!);
    res.status(200).json(result);
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
    const data = await service.getEntryById(req.params.id, req.tenantId!);
    res.status(200).json({ data });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
    const body = createDraftSchema.parse(req.body);
    const data = await service.createDraft(body, req.tenantId!);
    res.status(201).json({ data });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
    const body = updateDraftSchema.parse(req.body);
    const data = await service.updateDraft(req.params.id, body, req.tenantId!);
    res.status(200).json({ data });
});

export const post = asyncHandler(async (req: Request, res: Response) => {
    const data = await service.postEntry(req.params.id, req.tenantId!);
    res.status(200).json({ data });
});

export const reverse = asyncHandler(async (req: Request, res: Response) => {
    const body = reverseEntrySchema.parse(req.body);
    const data = await service.reverseEntry(req.params.id, body, req.tenantId!);
    res.status(200).json({ data });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
    await service.deleteDraft(req.params.id, req.tenantId!);
    res.status(204).send();
});

export const validateFiscal = asyncHandler(async (req: Request, res: Response) => {
    const data = await service.validateEntryFiscal(req.params.id, req.tenantId!);
    res.status(200).json({ data });
});

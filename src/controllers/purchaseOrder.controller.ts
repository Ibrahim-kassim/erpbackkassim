import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import * as poService from '../services/purchaseOrder.service';
import { z } from 'zod';

const lineSchema = z.object({
    productId: z.string().optional(),
    uomId: z.string().optional(),
    description: z.string().min(1),
    quantity: z.number().positive(),
    unitPrice: z.number().min(0),
    vatRate: z.number().min(0).max(100).default(0),
});

const createPOSchema = z.object({
    vendorId: z.string().min(1),
    orderDate: z.string().min(1),
    expectedDeliveryDate: z.string().optional(),
    currency: z.string().optional(),
    notes: z.string().optional(),
    lines: z.array(lineSchema).min(1),
    source: z.object({
        rfqId: z.string().optional(),
        quotationId: z.string().optional(),
        rfqNo: z.string().optional(),
    }).optional(),
});

const updatePOSchema = z.object({
    orderDate: z.string().optional(),
    expectedDeliveryDate: z.string().optional(),
    notes: z.string().optional(),
    lines: z.array(lineSchema).optional(),
});

const sendVendorMessageSchema = z.object({
    subject: z.string().min(3, 'Subject is required'),
    body: z.string().min(1, 'Message is required'),
    attachmentFileName: z.string().min(1).optional(),
    attachmentContentBase64: z.string().min(1).optional(),
    attachmentContentType: z.string().min(1).optional().default('application/pdf'),
});

export const getAll = asyncHandler(async (req: Request, res: Response) => {
    const { search, status, dateFrom, dateTo, vendorId, receiptStatus, billingStatus } = req.query as Record<string, string>;
    const pos = await poService.getAll(req.tenantId!, { search, status, dateFrom, dateTo, vendorId, receiptStatus, billingStatus });
    res.json({ data: pos });
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
    const po = await poService.getById(req.params.id, req.tenantId!);
    res.json({ data: po });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
    const dto = createPOSchema.parse(req.body);
    const po = await poService.create(dto, req.tenantId!);
    res.status(201).json({ data: po });
});

export const createFromQuotation = asyncHandler(async (req: Request, res: Response) => {
    const { quotationId } = req.params;
    const { orderDate, expectedDeliveryDate, notes } = req.body;
    const po = await poService.createFromQuotation(quotationId, req.tenantId!, { orderDate, expectedDeliveryDate, notes });
    res.status(201).json({ data: po });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
    const dto = updatePOSchema.parse(req.body);
    const po = await poService.update(req.params.id, dto, req.tenantId!);
    res.json({ data: po });
});

export const approve = asyncHandler(async (req: Request, res: Response) => {
    const po = await poService.approve(req.params.id, req.tenantId!);
    res.json({ data: po });
});

export const cancel = asyncHandler(async (req: Request, res: Response) => {
    const po = await poService.cancel(req.params.id, req.tenantId!);
    res.json({ data: po });
});

export const close = asyncHandler(async (req: Request, res: Response) => {
    const po = await poService.close(req.params.id, req.tenantId!);
    res.json({ data: po });
});

export const deletePO = asyncHandler(async (req: Request, res: Response) => {
    await poService.softDelete(req.params.id, req.tenantId!);
    res.status(204).send();
});

export const sendVendorMessage = asyncHandler(async (req: Request, res: Response) => {
    const validation = sendVendorMessageSchema.safeParse(req.body);
    if (!validation.success) {
        res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid inputs', details: validation.error.format() });
        return;
    }

    const data = await poService.sendVendorMessage(req.params.id, validation.data, req.tenantId!);
    res.status(200).json({ data });
});

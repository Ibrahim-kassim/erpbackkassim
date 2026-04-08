import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import * as quotationService from '../services/quotation.service';
import { createQuotationSchema } from '../validators/quotation.schema';
import { Quotation } from '../models/quotation.model';
import multer from 'multer';

export const submitQuotation = asyncHandler(async (req: Request, res: Response) => {
    const validatedData = createQuotationSchema.parse(req.body);
    const quotation = await quotationService.createQuotation(validatedData, req.tenantId!);
    res.status(201).json({ data: quotation });
});

export const getRFQQuotations = asyncHandler(async (req: Request, res: Response) => {
    const { rfqId } = req.params;
    const quotations = await quotationService.getQuotationsByRFQ(rfqId, req.tenantId!);
    res.json({ data: quotations });
});

export const selectQuotation = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const quotation = await quotationService.selectQuotation(id, req.tenantId!);
    res.json({ data: quotation });
});

export const deleteQuotation = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    await quotationService.deleteQuotation(id, req.tenantId!);
    res.status(204).send();
});

export const uploadDocuments = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const files = ((req as any).files || []) as Express.Multer.File[];
    if (!files.length) {
        res.status(400).json({ error: 'No files uploaded' });
        return;
    }

    const quotation =
        await Quotation.findOne({ _id: id, tenantId: req.tenantId!, isDeleted: false }) ||
        await Quotation.findOne({ _id: id, isDeleted: false });
    if (!quotation) {
        res.status(404).json({ error: 'Quotation not found' });
        return;
    }

    if (!quotation.attachments) quotation.attachments = [];

    const newAttachments = files.map((file) => ({
        filename: file.filename,
        originalFilename: file.originalname,
        url: `/uploads/quotations/${file.filename}`,
        contentType: file.mimetype,
        size: file.size,
        uploadedAt: new Date(),
    }));

    quotation.attachments.push(...newAttachments as any);

    // Backward compatibility: keep pdfPath as the most recently uploaded PDF (if any)
    const lastPdf = [...newAttachments].reverse().find((a) => (a.contentType || '').toLowerCase() === 'application/pdf' || a.url.toLowerCase().endsWith('.pdf'));
    if (lastPdf) {
        quotation.pdfPath = lastPdf.url;
    }

    await quotation.save();

    res.json({ data: { attachments: quotation.attachments, pdfPath: quotation.pdfPath } });
});

export const uploadPdf = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
    }

    const quotation =
        await Quotation.findOne({ _id: id, tenantId: req.tenantId!, isDeleted: false }) ||
        await Quotation.findOne({ _id: id, isDeleted: false });
    if (!quotation) {
        res.status(404).json({ error: 'Quotation not found' });
        return;
    }

    // Store the relative path to serve later (legacy field)
    quotation.pdfPath = `/uploads/quotations/${file.filename}`;

    // Also store in attachments list so we support multiple docs going forward.
    if (!quotation.attachments) quotation.attachments = [];
    quotation.attachments.push({
        filename: file.filename,
        originalFilename: file.originalname,
        url: quotation.pdfPath,
        contentType: file.mimetype,
        size: file.size,
        uploadedAt: new Date(),
    } as any);
    await quotation.save();

    res.json({ data: { pdfPath: quotation.pdfPath, attachments: quotation.attachments } });
});


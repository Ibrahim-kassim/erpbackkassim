import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import * as quotationService from '../services/quotation.service';
import { createQuotationSchema } from '../validators/quotation.schema';
import { Quotation } from '../models/quotation.model';
import multer from 'multer';
import fs from 'fs';
import path from 'path';

const getUploadsRoots = () => {
    const currentUploads = path.join(process.cwd(), 'uploads', 'quotations');
    const parentUploads = path.resolve(process.cwd(), '..', 'uploads', 'quotations');
    return Array.from(new Set([currentUploads, parentUploads]));
};

const findExistingDocumentPath = (filename: string): string | null => {
    for (const root of getUploadsRoots()) {
        const candidate = path.join(root, filename);
        if (fs.existsSync(candidate)) return candidate;
    }
    return null;
};

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

export const getDocumentFile = asyncHandler(async (req: Request, res: Response) => {
    const { id, filename } = req.params;
    const safeFilename = path.basename(filename);

    const quotation =
        await Quotation.findOne({ _id: id, tenantId: req.tenantId!, isDeleted: false }) ||
        await Quotation.findOne({ _id: id, isDeleted: false });
    if (!quotation) {
        res.status(404).json({ error: 'Quotation not found' });
        return;
    }

    const attachment = (quotation.attachments || []).find((item) => item.filename === safeFilename);
    if (!attachment) {
        res.status(404).json({ error: 'Document not found' });
        return;
    }

    const absolutePath = findExistingDocumentPath(safeFilename);
    if (!absolutePath) {
        res.status(404).json({ error: 'Document file missing on server' });
        return;
    }

    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.sendFile(absolutePath);
});

export const deleteDocument = asyncHandler(async (req: Request, res: Response) => {
    const { id, filename } = req.params;
    const safeFilename = path.basename(filename);

    const quotation =
        await Quotation.findOne({ _id: id, tenantId: req.tenantId!, isDeleted: false }) ||
        await Quotation.findOne({ _id: id, isDeleted: false });
    if (!quotation) {
        res.status(404).json({ error: 'Quotation not found' });
        return;
    }

    const remaining = (quotation.attachments || []).filter((item) => item.filename !== safeFilename);
    const removedCount = (quotation.attachments || []).length - remaining.length;
    if (removedCount <= 0) {
        res.status(404).json({ error: 'Document not found' });
        return;
    }

    quotation.attachments = remaining as any;

    if ((quotation.pdfPath || '').includes(safeFilename)) {
        const nextPdf = [...remaining].reverse().find((item) =>
            (item.contentType || '').toLowerCase() === 'application/pdf' || item.url.toLowerCase().endsWith('.pdf')
        );
        quotation.pdfPath = nextPdf ? nextPdf.url : undefined;
    }

    await quotation.save();

    for (const root of getUploadsRoots()) {
        const absolutePath = path.join(root, safeFilename);
        if (fs.existsSync(absolutePath)) {
            try {
                fs.unlinkSync(absolutePath);
            } catch {
                // ignore file removal errors after DB update
            }
        }
    }

    res.json({ data: { attachments: quotation.attachments, pdfPath: quotation.pdfPath } });
});


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

export const uploadPdf = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
    }

    const quotation = await Quotation.findOne({ _id: id, tenantId: req.tenantId!, isDeleted: false });
    if (!quotation) {
        res.status(404).json({ error: 'Quotation not found' });
        return;
    }

    // Store the relative path to serve later
    quotation.pdfPath = `/uploads/quotations/${file.filename}`;
    await quotation.save();

    res.json({ data: { pdfPath: quotation.pdfPath } });
});


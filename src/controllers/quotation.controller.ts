import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import * as quotationService from '../services/quotation.service';
import { createQuotationSchema } from '../validators/quotation.schema';

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

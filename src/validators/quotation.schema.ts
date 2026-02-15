import { z } from 'zod';

export const quotationItemSchema = z.object({
    rfqItemId: z.string(),
    unitPrice: z.number().min(0),
    totalPrice: z.number().min(0)
});

export const createQuotationSchema = z.object({
    rfqId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid RFQ ID'),
    vendorId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid Vendor ID'),
    items: z.array(quotationItemSchema).min(1, 'At least one item is required'),
    total: z.number().min(0)
});

export const updateQuotationStatusSchema = z.object({
    status: z.enum(['SUBMITTED', 'SELECTED', 'REJECTED'])
});

export type CreateQuotationDTO = z.infer<typeof createQuotationSchema>;
export type QuotationItemDTO = z.infer<typeof quotationItemSchema>;

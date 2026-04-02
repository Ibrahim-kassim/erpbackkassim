import { z } from 'zod';

const arInvoiceItemSchema = z.object({
    lineType: z.enum(['CATALOG', 'MANUAL']).default('MANUAL'),
    productId: z.string().min(1).optional(),
    itemCode: z.string().optional(),
    itemName: z.string().optional(),
    itemKind: z.enum(['PRODUCT', 'SERVICE', 'MANUAL']).optional(),
    uomLabel: z.string().optional(),
    description: z.string().min(1, 'Description is required'),
    quantity: z.number().positive('Quantity must be positive'),
    unitPrice: z.number().min(0, 'Unit price cannot be negative'),
});

export const createARInvoiceSchema = z.object({
    customerId: z.string().min(1, 'Customer is required'),
    invoiceDate: z.string().min(1, 'Invoice date is required'),
    postingDate: z.string().min(1, 'Posting date is required'),
    dueDate: z.string().min(1, 'Due date is required'),
    currency: z.string().default('USD'),
    notes: z.string().optional(),
    items: z.array(arInvoiceItemSchema).min(1, 'At least one item is required'),
    accounting: z.object({
        revenueAccountId: z.string().min(1, 'Revenue account is required'),
        arAccountId: z.string().min(1, 'AR control account is required'),
    }),
});

export const updateARInvoiceSchema = z.object({
    invoiceDate: z.string().optional(),
    postingDate: z.string().optional(),
    dueDate: z.string().optional(),
    notes: z.string().optional(),
    items: z.array(arInvoiceItemSchema).min(1).optional(),
    accounting: z.object({
        revenueAccountId: z.string().min(1),
        arAccountId: z.string().min(1),
    }).optional(),
});

export type CreateARInvoiceDTO = z.infer<typeof createARInvoiceSchema>;
export type UpdateARInvoiceDTO = z.infer<typeof updateARInvoiceSchema>;

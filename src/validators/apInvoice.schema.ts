import { z } from 'zod';

const apInvoiceItemSchema = z.object({
    description: z.string().min(1, 'Description is required'),
    quantity: z.number().positive('Quantity must be positive'),
    unitPrice: z.number().min(0, 'Unit price cannot be negative'),
});

const accountingSchema = z.object({
    expenseAccountId: z.string().min(1, 'Expense account is required'),
    apAccountId: z.string().min(1, 'AP control account is required'),
});

export const createAPInvoiceSchema = z.object({
    vendorId: z.string().min(1, 'Vendor is required'),
    vendorName: z.string().min(1, 'Vendor name is required'),
    invoiceDate: z.string().min(1, 'Invoice date is required'),
    postingDate: z.string().min(1, 'Posting date is required'),
    dueDate: z.string().optional(),
    currencyCode: z.string().default('USD'),
    notes: z.string().optional(),
    source: z.object({
        purchaseOrderId: z.string().optional(),
        poNo: z.string().optional(),
    }).optional(),
    items: z.array(apInvoiceItemSchema).min(1, 'At least one item is required'),
    accounting: accountingSchema,
});

export const updateAPInvoiceSchema = z.object({
    invoiceDate: z.string().optional(),
    postingDate: z.string().optional(),
    dueDate: z.string().optional(),
    notes: z.string().optional(),
    items: z.array(apInvoiceItemSchema).min(1).optional(),
    accounting: accountingSchema.optional(),
});

export const sendAPInvoiceVendorMessageSchema = z.object({
    subject: z.string().min(3, 'Subject is required'),
    body: z.string().min(1, 'Message is required'),
    attachmentFileName: z.string().min(1).optional(),
    attachmentContentBase64: z.string().min(1).optional(),
    attachmentContentType: z.string().min(1).optional().default('application/pdf'),
});

export type CreateAPInvoiceDTO = z.infer<typeof createAPInvoiceSchema>;
export type UpdateAPInvoiceDTO = z.infer<typeof updateAPInvoiceSchema>;
export type SendAPInvoiceVendorMessageDTO = z.infer<typeof sendAPInvoiceVendorMessageSchema>;

import { z } from 'zod';

const rfqItemSchema = z.object({
    productId: z.string().optional(),
    description: z.string().min(3, 'Description must be at least 3 characters'),
    quantity: z.coerce.number().min(1, 'Quantity must be at least 1'),
    uomId: z.string().min(1, 'UOM is required')
});

export const createRFQSchema = z.object({
    title: z.string().min(1, 'Title is required'),
    vendorIds: z.array(z.string()).min(1, 'At least one vendor is required'),
    items: z.array(rfqItemSchema).min(1, 'At least one item is required'),
    status: z.enum(['DRAFT', 'SENT', 'CLOSED']).optional().default('DRAFT'),
    createdBy: z.string().optional()
});

export const updateRFQSchema = z.object({
    title: z.string().min(1).optional(),
    vendorIds: z.array(z.string()).min(1).optional(),
    items: z.array(rfqItemSchema).min(1).optional(),
    createdBy: z.string().optional()
});

export const sendRFQEmailSchema = z.object({
    vendorIds: z.array(z.string().min(1)).min(1, 'Select at least one vendor'),
    subject: z.string().min(3, 'Subject is required'),
    body: z.string().min(10, 'Email body is required'),
    attachmentFileName: z.string().min(1, 'Attachment file name is required'),
    attachmentContentBase64: z.string().min(1, 'Attachment is required'),
    attachmentContentType: z.string().min(1).default('application/pdf'),
});

export type CreateRFQDTO = z.infer<typeof createRFQSchema>;
export type UpdateRFQDTO = z.infer<typeof updateRFQSchema>;
export type RFQItemDTO = z.infer<typeof rfqItemSchema>;
export type SendRFQEmailDTO = z.infer<typeof sendRFQEmailSchema>;

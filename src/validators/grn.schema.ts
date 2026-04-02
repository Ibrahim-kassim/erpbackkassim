import { z } from 'zod';

const grnLineSchema = z.object({
    poLineIndex: z.number().int().min(0, 'PO line index must be zero or greater'),
    productId: z.string().min(1).optional(),
    receivedQty: z.number().positive('Received quantity must be positive'),
    unitCost: z.number().min(0, 'Unit cost cannot be negative').optional(),
});

export const createGRNSchema = z.object({
    poId: z.string().min(1, 'Purchase order is required'),
    receiptDate: z.string().min(1, 'Receipt date is required'),
    notes: z.string().optional(),
    lines: z.array(grnLineSchema).min(1, 'At least one receipt line is required'),
});

export const updateGRNSchema = z.object({
    receiptDate: z.string().optional(),
    notes: z.string().optional(),
    lines: z.array(grnLineSchema).min(1).optional(),
});

export const cancelGRNSchema = z.object({
    reason: z.string().optional(),
    cancellationDate: z.string().optional(),
});

export type CreateGRNDTO = z.infer<typeof createGRNSchema>;
export type UpdateGRNDTO = z.infer<typeof updateGRNSchema>;
export type CancelGRNDTO = z.infer<typeof cancelGRNSchema>;

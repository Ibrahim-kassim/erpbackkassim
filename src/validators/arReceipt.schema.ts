import { z } from 'zod';

const allocationSchema = z.object({
    invoiceId: z.string().min(1),
    invoiceNo: z.string().min(1),
    allocatedAmount: z.number().positive(),
});

export const createARReceiptSchema = z.object({
    customerId: z.string().min(1, 'Customer is required'),
    receiptDate: z.string().min(1, 'Receipt date is required'),
    postingDate: z.string().min(1, 'Posting date is required'),
    method: z.enum(['BANK', 'CASH', 'TRANSFER']),
    bankAccountId: z.string().min(1, 'Bank/Cash account is required'),
    arAccountId: z.string().min(1, 'AR account is required'),
    amount: z.number().positive('Amount must be positive'),
    memo: z.string().optional(),
    referenceFileName: z.string().min(1).optional(),
    referenceFileBase64: z.string().min(1).optional(),
    referenceFileContentType: z.string().min(1).optional().default('application/pdf'),
    allocations: z.array(allocationSchema).default([]),
});

export const updateARReceiptSchema = z.object({
    receiptDate: z.string().optional(),
    postingDate: z.string().optional(),
    method: z.enum(['BANK', 'CASH', 'TRANSFER']).optional(),
    bankAccountId: z.string().optional(),
    arAccountId: z.string().optional(),
    amount: z.number().positive().optional(),
    memo: z.string().optional(),
    referenceFileName: z.string().min(1).optional(),
    referenceFileBase64: z.string().min(1).optional(),
    referenceFileContentType: z.string().min(1).optional(),
    allocations: z.array(allocationSchema).optional(),
});

export type CreateARReceiptDTO = z.infer<typeof createARReceiptSchema>;
export type UpdateARReceiptDTO = z.infer<typeof updateARReceiptSchema>;

import { z } from 'zod';

const allocationSchema = z.object({
    invoiceId: z.string().min(1, 'Invoice ID is required'),
    invoiceNo: z.string().min(1, 'Invoice number is required'),
    allocatedAmount: z.number().positive('Allocated amount must be positive'),
});

export const createAPPaymentSchema = z.object({
    vendorId: z.string().min(1, 'Vendor is required'),
    vendorName: z.string().min(1, 'Vendor name is required'),
    paymentDate: z.string().min(1, 'Payment date is required'),
    postingDate: z.string().min(1, 'Posting date is required'),
    method: z.enum(['BANK', 'CASH', 'TRANSFER']),
    apAccountId: z.string().min(1, 'AP account is required'),
    paymentAccountId: z.string().min(1, 'Payment account is required'),
    amount: z.number().positive('Amount must be positive'),
    memo: z.string().optional(),
    allocations: z.array(allocationSchema).default([]),
});

export const updateAPPaymentSchema = z.object({
    paymentDate: z.string().optional(),
    postingDate: z.string().optional(),
    method: z.enum(['BANK', 'CASH', 'TRANSFER']).optional(),
    apAccountId: z.string().optional(),
    paymentAccountId: z.string().optional(),
    amount: z.number().positive().optional(),
    memo: z.string().optional(),
    allocations: z.array(allocationSchema).optional(),
});

export type CreateAPPaymentDTO = z.infer<typeof createAPPaymentSchema>;
export type UpdateAPPaymentDTO = z.infer<typeof updateAPPaymentSchema>;

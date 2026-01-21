import { z } from 'zod';
import { EntryStatus } from '../models/journalEntry.model';

const lineSchema = z.object({
    accountId: z.string().min(1, "Account ID is required"),
    description: z.string().optional(),
    debit: z.number().min(0).default(0),
    credit: z.number().min(0).default(0),
}).refine(data => {
    return (data.debit > 0 && data.credit === 0) || (data.credit > 0 && data.debit === 0);
}, "Line must have either debit > 0 or credit > 0, but not both");

export const createDraftSchema = z.object({
    entryType: z.string().optional(),
    postingDate: z.coerce.date(),
    fiscalPeriodId: z.string().min(1, "Fiscal period is required"),
    description: z.string().optional(),
    reference: z.string().optional(),
    sourceType: z.string().optional(),
    sourceId: z.string().optional(),
    sourceNo: z.string().optional(),
    lines: z.array(lineSchema).min(2, "At least 2 lines are required")
});

export const updateDraftSchema = z.object({
    entryType: z.string().optional(),
    postingDate: z.coerce.date().optional(),
    fiscalPeriodId: z.string().optional(),
    description: z.string().optional(),
    reference: z.string().optional(),
    lines: z.array(lineSchema).min(2, "At least 2 lines are required").optional()
});

export const reverseEntrySchema = z.object({
    reason: z.string().optional(),
    reversalDate: z.coerce.date(),
    fiscalPeriodId: z.string().min(1, "Fiscal period for reversal is required")
});

export type CreateDraftDTO = z.infer<typeof createDraftSchema>;
export type UpdateDraftDTO = z.infer<typeof updateDraftSchema>;
export type ReverseEntryDTO = z.infer<typeof reverseEntrySchema>;

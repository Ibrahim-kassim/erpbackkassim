import { z } from 'zod';
import { Types } from 'mongoose';
import { AccountType } from '../models/chartOfAccount.model';

const objectIdSchema = z.string().refine((val) => Types.ObjectId.isValid(val), {
    message: "Invalid ObjectId",
});

export const trialBalanceQuerySchema = z.object({
    asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (YYYY-MM-DD)").optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (YYYY-MM-DD)").optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (YYYY-MM-DD)").optional(),
    fiscalPeriodId: objectIdSchema.optional(),
    accountType: z.nativeEnum(AccountType).optional(),
    search: z.string().trim().max(120).optional(),
    includeZero: z.enum(['true', 'false']).transform((val) => val === 'true').optional().default('false'),
    includeNonPosting: z.enum(['true', 'false']).transform((val) => val === 'true').optional().default('false'),
}).refine((data) => {
    // Validation: Cannot have both periodId and range/asOf logic mixed confusingly
    // Priority: fiscalPeriodId > asOf > from/to
    // But essentially we don't error if multiple are passed, just define precedence.
    // However, from/to must be together if used.
    if (data.from && !data.to) return false;
    if (!data.from && data.to) return false;
    return true;
}, {
    message: "If using date range, both 'from' and 'to' must be provided.",
    path: ["from"]
});

export type TrialBalanceQuery = z.infer<typeof trialBalanceQuerySchema>;

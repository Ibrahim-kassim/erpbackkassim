
import { z } from 'zod';
import { Types } from 'mongoose';

const objectIdSchema = z.string().refine((val) => Types.ObjectId.isValid(val), {
    message: "Invalid ObjectId",
});

export const generalLedgerLinesQuerySchema = z.object({
    scope: z.enum(['openPeriod', 'last30d', 'all']).optional().default('openPeriod'),
    fiscalPeriodId: objectIdSchema.optional(),
    fiscalYearId: objectIdSchema.optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (YYYY-MM-DD)").optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (YYYY-MM-DD)").optional(),
    accountId: objectIdSchema.optional(),
    accountType: z.string().optional(),
    sourceType: z.string().optional(),
    search: z.string().optional(), // entryNo or text
    page: z.string().transform(Number).optional().default('1'),
    limit: z.string().transform(Number).optional().default('50'),
    sort: z.enum(['asc', 'desc']).optional().default('desc'),
}).refine((data) => {
    if (data.from && !data.to) return false;
    if (!data.from && data.to) return false;
    return true;
}, {
    message: "If using date range, both 'from' and 'to' must be provided.",
    path: ["from"]
});

export type GeneralLedgerLinesQuery = z.infer<typeof generalLedgerLinesQuerySchema>;

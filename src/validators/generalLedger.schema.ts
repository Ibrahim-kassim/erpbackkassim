
import { z } from 'zod';
import { Types } from 'mongoose';

const objectIdSchema = z.string().refine((val) => Types.ObjectId.isValid(val), {
    message: "Invalid ObjectId",
});

export const generalLedgerQuerySchema = z.object({
    accountId: objectIdSchema,
    fiscalPeriodId: objectIdSchema.optional(),
    fiscalYearId: objectIdSchema.optional(),
    asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (YYYY-MM-DD)").optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (YYYY-MM-DD)").optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (YYYY-MM-DD)").optional(),
    search: z.string().optional(),
    sort: z.enum(['asc', 'desc']).optional().default('asc'),
    page: z.string().transform(Number).optional().default('1'),
    limit: z.string().transform(Number).optional().default('500'),
    includeOpening: z.enum(['true', 'false']).transform((val) => val === 'true').optional().default('true'),
}).refine((data) => {
    // If range is used, both from/to required
    if (data.from && !data.to) return false;
    if (!data.from && data.to) return false;
    return true;
}, {
    message: "If using date range, both 'from' and 'to' must be provided.",
    path: ["from"]
});

export type GeneralLedgerQuery = z.infer<typeof generalLedgerQuerySchema>;

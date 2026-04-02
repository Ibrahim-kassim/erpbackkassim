import { z } from 'zod';
import { Types } from 'mongoose';

const objectIdSchema = z.string().refine((val) => Types.ObjectId.isValid(val), {
    message: 'Invalid ObjectId',
});

const baseScopeSchema = z.object({
    accountId: objectIdSchema.optional(),
    fiscalPeriodId: objectIdSchema.optional(),
    fiscalYearId: objectIdSchema.optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)').optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)').optional(),
    sourceType: z.string().optional(),
});

export const explainLedgerQuerySchema = baseScopeSchema.extend({
    accountId: objectIdSchema,
}).refine((data) => {
    if (data.from && !data.to) return false;
    if (!data.from && data.to) return false;
    return true;
}, {
    message: "If using date range, both 'from' and 'to' must be provided.",
    path: ['from'],
});

export const anomaliesLedgerQuerySchema = baseScopeSchema.refine((data) => {
    if (data.from && !data.to) return false;
    if (!data.from && data.to) return false;
    return true;
}, {
    message: "If using date range, both 'from' and 'to' must be provided.",
    path: ['from'],
});

export const sourceSummaryLedgerQuerySchema = anomaliesLedgerQuerySchema;

export const entryNarrativeQuerySchema = z.object({
    entryId: objectIdSchema,
});

export const ledgerQuestionSchema = z.object({
    question: z.string().min(3, 'Question is required'),
    accountId: objectIdSchema.optional(),
    fiscalPeriodId: objectIdSchema.optional(),
    fiscalYearId: objectIdSchema.optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)').optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)').optional(),
    sourceType: z.string().optional(),
    entryId: objectIdSchema.optional(),
}).refine((data) => {
    if (data.from && !data.to) return false;
    if (!data.from && data.to) return false;
    return true;
}, {
    message: "If using date range, both 'from' and 'to' must be provided.",
    path: ['from'],
});

export type ExplainLedgerQuery = z.infer<typeof explainLedgerQuerySchema>;
export type AnomaliesLedgerQuery = z.infer<typeof anomaliesLedgerQuerySchema>;
export type SourceSummaryLedgerQuery = z.infer<typeof sourceSummaryLedgerQuerySchema>;
export type EntryNarrativeQuery = z.infer<typeof entryNarrativeQuerySchema>;
export type LedgerQuestionDTO = z.infer<typeof ledgerQuestionSchema>;

import { z } from 'zod';

export const createFiscalYearSchema = z.object({
    yearName: z.string().min(1),
    startDate: z.string().transform(str => new Date(str)),
    endDate: z.string().transform(str => new Date(str)),
    isActive: z.boolean().optional().default(true),
    generatePeriods: z.boolean().optional().default(true) // Helper to auto-generate immediately
}).refine(data => data.endDate > data.startDate, {
    message: "End date must be after start date",
    path: ["endDate"]
});

export const updateFiscalYearSchema = z.object({
    yearName: z.string().optional(),
    isActive: z.boolean().optional()
});

export const generatePeriodsSchema = z.object({
    mode: z.enum(['MONTHLY']).default('MONTHLY'),
    openPeriodNumber: z.number().int().min(1).max(12).default(1)
});

export const updatePeriodStatusSchema = z.object({
    status: z.enum(['OPEN', 'LOCKED', 'CLOSED'])
});

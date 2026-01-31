import { z } from 'zod';

export const financialStatementsQuerySchema = z.object({
    fiscalPeriodId: z.string().optional(),
    fiscalYearId: z.string().optional(),
    asOf: z.string().optional(), // YYYY-MM-DD
    from: z.string().optional(),
    to: z.string().optional(), // YYYY-MM-DD
    view: z.enum(['TREE', 'FLAT']).optional().default('TREE'),
    includeZero: z.string().transform(val => val === 'true').optional().default('false')
});

export type FinancialStatementsQuery = z.infer<typeof financialStatementsQuerySchema>;

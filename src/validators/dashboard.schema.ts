import { z } from 'zod';

export const dashboardQuerySchema = z.object({
    question: z.string().min(2, 'Question is required'),
});

export type DashboardQueryDTO = z.infer<typeof dashboardQuerySchema>;

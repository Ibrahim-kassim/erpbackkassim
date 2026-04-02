import { z } from 'zod';

const objectIdField = z.string().min(1).nullable().optional();

export const updateSystemConfigSchema = z.object({
    companyName: z.string().min(1).optional(),
    companyLogo: z.string().min(1).optional(),
    address: z.object({
        country: z.string().optional(),
        city: z.string().optional(),
        street: z.string().optional(),
        postalCode: z.string().optional(),
    }).optional(),
    phone: z.string().optional(),
    email: z.string().email().optional(),
    taxNumber: z.string().optional(),
    currency: z.string().min(1).optional(),
    dateFormat: z.enum(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']).optional(),
    defaultAccounts: z.object({
        accountsPayable: objectIdField,
        accountsReceivable: objectIdField,
        inventoryAsset: objectIdField,
        grniLiability: objectIdField,
        cashAccount: objectIdField,
        bankAccount: objectIdField,
        vatPayable: objectIdField,
        vatReceivable: objectIdField,
        inventoryAdjustment: objectIdField,
        cogsAccount: objectIdField,
        retainedEarnings: objectIdField,
    }).optional(),
    paymentTermsOptions: z.array(z.string().min(1)).optional(),
    vatRate: z.coerce.number().min(0).max(100).optional(),
});

export type UpdateSystemConfigDTO = z.infer<typeof updateSystemConfigSchema>;

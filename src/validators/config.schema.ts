import { z } from 'zod';

const objectIdField = z.string().min(1).nullable().optional();

export const updateSystemConfigSchema = z.object({
    companyName: z.string().min(1).optional(),
    companyLogo: z.string().min(1).optional(),
    documentBranding: z.object({
        primaryColor: z.string().regex(/^#([A-Fa-f0-9]{6})$/, 'Primary color must be a hex color like #1F3B68').optional(),
        accentColor: z.string().regex(/^#([A-Fa-f0-9]{6})$/, 'Accent color must be a hex color like #0EA5E9').optional(),
        pdfFont: z.enum(['Helvetica', 'Times', 'Courier']).optional(),
    }).optional(),
    emailSettings: z.object({
        senderName: z.string().optional(),
        senderEmail: z.string().email().optional().or(z.literal('')),
        replyToEmail: z.string().email().optional().or(z.literal('')),
        smtpHost: z.string().optional(),
        smtpPort: z.coerce.number().int().min(1).max(65535).optional(),
        smtpSecure: z.boolean().optional(),
        smtpUsername: z.string().optional(),
        smtpPassword: z.string().optional(),
        inboundEnabled: z.boolean().optional(),
        imapHost: z.string().optional(),
        imapPort: z.coerce.number().int().min(1).max(65535).optional(),
        imapSecure: z.boolean().optional(),
        imapUsername: z.string().optional(),
        imapPassword: z.string().optional(),
        imapFolder: z.string().optional(),
    }).optional(),
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

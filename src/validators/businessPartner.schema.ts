import { z } from 'zod';

export const createBusinessPartnerSchema = z.object({
    code: z.string().optional(),
    name: z.string().min(1, 'Name is required'),
    roles: z.array(z.enum(['CUSTOMER', 'VENDOR'])).min(1, 'At least one role is required'),
    currency: z.string().optional().default('USD'),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional().default('ACTIVE'),
    taxNumber: z.string().optional(),
    email: z.string().email().optional().or(z.literal('')),
    phone: z.string().optional(),
    address: z.object({
        country: z.string().optional(),
        city: z.string().optional(),
        street: z.string().optional(),
        postalCode: z.string().optional()
    }).optional(),
    paymentTerms: z.string().optional(),
    creditLimit: z.number().min(0).optional()
});

export const updateBusinessPartnerSchema = z.object({
    code: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    roles: z.array(z.enum(['CUSTOMER', 'VENDOR'])).min(1).optional(),
    currency: z.string().optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
    taxNumber: z.string().optional(),
    email: z.string().email().optional().or(z.literal('')),
    phone: z.string().optional(),
    address: z.object({
        country: z.string().optional(),
        city: z.string().optional(),
        street: z.string().optional(),
        postalCode: z.string().optional()
    }).optional(),
    paymentTerms: z.string().optional(),
    creditLimit: z.number().min(0).optional()
});

export type CreateBusinessPartnerDTO = z.infer<typeof createBusinessPartnerSchema>;
export type UpdateBusinessPartnerDTO = z.infer<typeof updateBusinessPartnerSchema>;

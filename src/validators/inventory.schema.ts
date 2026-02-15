import { z } from 'zod';

export const categorySchema = z.object({
    name: z.string().min(1, 'Name is required'),
    status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
});

export const uomSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    symbol: z.string().min(1, 'Symbol is required'),
    status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
});

// Base schema without refinements for partial usage
const baseProductSchema = z.object({
    code: z.string().optional(), // Auto-generated if not provided, or provided by system
    name: z.string().min(1, 'Name is required'),
    type: z.enum(['PRODUCT', 'SERVICE']),
    categoryId: z.string().min(1, 'Category is required'),
    uomId: z.string().min(1, 'UoM is required'),
    unitPrice: z.coerce.number().min(0, 'Unit Price must be non-negative'),
    costPrice: z.coerce.number().min(0, 'Cost Price must be non-negative').optional(),
    vatRate: z.coerce.number().min(0).max(100).default(5),
    inventoryTracked: z.boolean().default(true),
    status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
});

export const productSchema = baseProductSchema.superRefine((data, ctx) => {
    if (data.type === 'PRODUCT') {
        if (data.costPrice === undefined || data.costPrice === null) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Cost Price is required for products',
                path: ['costPrice'],
            });
        }
    }
    if (data.type === 'SERVICE') {
        if (data.inventoryTracked === true) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Services cannot have inventory tracking',
                path: ['inventoryTracked'],
            });
        }
    }
});

// For updates, we use the base schema partial, but we lose the cross-field validation.
// In a real app, we might want to re-run refinements if the relevant fields are present.
// For now, simple partial validation is sufficient or we can add refinements if needed.
export const updateProductSchema = baseProductSchema.partial();

// Stock Adjustment Schema
export const stockAdjustmentSchema = z.object({
    type: z.enum(['INCREASE', 'DECREASE']),
    quantity: z.coerce.number().min(1, 'Quantity must be at least 1'),
    reason: z.string().min(3, 'Reason is required'),
});

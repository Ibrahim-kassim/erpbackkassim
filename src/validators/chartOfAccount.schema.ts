import { z } from 'zod';
import { AccountType } from '../models/chartOfAccount.model';

// Regex for allowed code format: uppercase letters, numbers, dot, dash
const codeRegex = /^[A-Z0-9.-]+$/;

export const createAccountSchema = z.object({
    code: z.string().min(1).regex(codeRegex, "Code must contain only uppercase letters, numbers, dots, or dashes"),
    name: z.string().min(1),
    type: z.nativeEnum(AccountType),
    parentId: z.string().optional().nullable(), // ObjectId as string
    isPosting: z.boolean(),
    description: z.string().optional(),
});

export const updateAccountSchema = z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    isActive: z.boolean().optional(),
    parentId: z.string().optional().nullable(),
    isPosting: z.boolean().optional(),
    type: z.nativeEnum(AccountType).optional(),
});

export type CreateAccountDTO = z.infer<typeof createAccountSchema>;
export type UpdateAccountDTO = z.infer<typeof updateAccountSchema>;

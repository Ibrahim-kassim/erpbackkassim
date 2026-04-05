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

export const importAccountRowSchema = z.object({
    code: z.string().min(1).regex(codeRegex, "Code must contain only uppercase letters, numbers, dots, or dashes"),
    name: z.string().min(1),
    type: z.nativeEnum(AccountType),
    parentCode: z.string().regex(codeRegex, "Parent code must contain only uppercase letters, numbers, dots, or dashes").optional().nullable(),
    isPosting: z.boolean().default(true),
    isActive: z.boolean().default(true),
    description: z.string().optional().nullable(),
});

export const importAccountsSchema = z.object({
    accounts: z.array(importAccountRowSchema).min(1, 'At least one account row is required'),
});

export type CreateAccountDTO = z.infer<typeof createAccountSchema>;
export type UpdateAccountDTO = z.infer<typeof updateAccountSchema>;
export type ImportAccountRowDTO = z.infer<typeof importAccountRowSchema>;

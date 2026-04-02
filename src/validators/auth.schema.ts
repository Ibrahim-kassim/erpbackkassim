import { z } from 'zod';

export const registerSchema = z.object({
    companyName: z.string().min(2, 'Company name must be at least 2 characters'),
    name: z.string().min(2, 'Name must be at least 2 characters'),
    email: z.string().email('Invalid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    currency: z.string().default('USD'),
});

export const loginSchema = z.object({
    email: z.string().email('Invalid email'),
    password: z.string().min(1, 'Password is required'),
    tenantSlug: z.string().min(1, 'Tenant is required').optional(),
});

export const refreshSchema = z.object({
    refreshToken: z.string().min(1, 'Refresh token is required'),
});

export const createUserSchema = z.object({
    name: z.string().min(2, 'Name must be at least 2 characters'),
    email: z.string().email('Invalid email'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    role: z.enum(['ADMIN', 'ACCOUNTANT', 'PURCHASING', 'VIEWER']),
});

export const updateUserSchema = z.object({
    name: z.string().min(2).optional(),
    role: z.enum(['ADMIN', 'ACCOUNTANT', 'PURCHASING', 'VIEWER']).optional(),
    isActive: z.boolean().optional(),
});

export const changePasswordSchema = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

export type RegisterDTO = z.infer<typeof registerSchema>;
export type LoginDTO = z.infer<typeof loginSchema>;
export type CreateUserDTO = z.infer<typeof createUserSchema>;
export type UpdateUserDTO = z.infer<typeof updateUserSchema>;
export type ChangePasswordDTO = z.infer<typeof changePasswordSchema>;

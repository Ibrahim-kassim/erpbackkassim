import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import * as service from '../services/auth.service';
import {
    registerSchema,
    loginSchema,
    refreshSchema,
    createUserSchema,
    updateUserSchema,
    changePasswordSchema,
} from '../validators/auth.schema';

// ─── Public ───────────────────────────────────────────────────────────────────

export const register = asyncHandler(async (req: Request, res: Response) => {
    const validation = registerSchema.safeParse(req.body);
    if (!validation.success) {
        res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid inputs', details: validation.error.format() });
        return;
    }
    const result = await service.register(validation.data);
    res.status(201).json({ data: result });
});

export const login = asyncHandler(async (req: Request, res: Response) => {
    const validation = loginSchema.safeParse(req.body);
    if (!validation.success) {
        res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid inputs', details: validation.error.format() });
        return;
    }
    const result = await service.login(validation.data);
    res.status(200).json({ data: result });
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
    const validation = refreshSchema.safeParse(req.body);
    if (!validation.success) {
        res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Refresh token required' });
        return;
    }
    const result = await service.refresh(validation.data.refreshToken);
    res.status(200).json({ data: result });
});

// ─── Authenticated ────────────────────────────────────────────────────────────

export const logout = asyncHandler(async (req: Request, res: Response) => {
    await service.logout(req.userId!);
    res.status(200).json({ success: true });
});

export const getMe = asyncHandler(async (req: Request, res: Response) => {
    const user = await service.getMe(req.userId!);
    res.status(200).json({ data: user });
});

export const changePassword = asyncHandler(async (req: Request, res: Response) => {
    const validation = changePasswordSchema.safeParse(req.body);
    if (!validation.success) {
        res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid inputs', details: validation.error.format() });
        return;
    }
    await service.changePassword(req.userId!, validation.data);
    res.status(200).json({ success: true });
});

// ─── Admin: user management ───────────────────────────────────────────────────

export const createUser = asyncHandler(async (req: Request, res: Response) => {
    const validation = createUserSchema.safeParse(req.body);
    if (!validation.success) {
        res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid inputs', details: validation.error.format() });
        return;
    }
    const user = await service.createUser(validation.data, req.tenantId!);
    res.status(201).json({ data: user });
});

export const listUsers = asyncHandler(async (req: Request, res: Response) => {
    const users = await service.listUsers(req.tenantId!);
    res.status(200).json({ data: users });
});

export const updateUser = asyncHandler(async (req: Request, res: Response) => {
    const validation = updateUserSchema.safeParse(req.body);
    if (!validation.success) {
        res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid inputs', details: validation.error.format() });
        return;
    }
    const user = await service.updateUser(req.params.id, validation.data, req.tenantId!);
    res.status(200).json({ data: user });
});

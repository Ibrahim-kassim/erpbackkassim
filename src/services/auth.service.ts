import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { Tenant } from '../models/tenant.model';
import { User, IUser } from '../models/user.model';
import { config } from '../config/env';
import {
    RegisterDTO,
    LoginDTO,
    CreateUserDTO,
    UpdateUserDTO,
    ChangePasswordDTO,
} from '../validators/auth.schema';

class ServiceError extends Error {
    code: string;
    details?: any;
    constructor(message: string, code = 'VALIDATION_ERROR', details?: any) {
        super(message);
        this.code = code;
        this.details = details;
    }
}

// ─── Token helpers ────────────────────────────────────────────────────────────

const generateSlug = (name: string): string =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const resolveTenantForLogin = async (tenantInput: string, email: string) => {
    const raw = tenantInput.trim();
    const normalizedSlug = generateSlug(raw);

    let tenant = await Tenant.findOne({
        isActive: true,
        $or: [
            { slug: raw.toLowerCase() },
            { slug: normalizedSlug },
            { name: { $regex: `^${escapeRegex(raw)}$`, $options: 'i' } },
        ],
    });

    if (!tenant) {
        const userTenants = await User.find({
            email,
            isActive: true,
        }).distinct('tenantId');

        if (userTenants.length === 1) {
            tenant = await Tenant.findOne({
                slug: userTenants[0],
                isActive: true,
            });
        }
    }

    return tenant;
};

const signAccess = (payload: { userId: string; tenantId: string; role: string }) =>
    jwt.sign(payload, config.jwtSecret, { expiresIn: '15m' });

const signRefresh = (payload: { userId: string; tenantId: string }) =>
    jwt.sign(payload, config.jwtRefreshSecret, { expiresIn: '7d' });

const safeUser = (user: IUser) => ({
    id: user._id,
    tenantId: user.tenantId,
    email: user.email,
    name: user.name,
    role: user.role,
    isActive: user.isActive,
    lastLogin: user.lastLogin,
    createdAt: user.createdAt,
});

// ─── Register (creates tenant + first admin user) ─────────────────────────────

export const register = async (dto: RegisterDTO) => {
    // 1. Generate unique slug
    let slug = generateSlug(dto.companyName);
    const existing = await Tenant.findOne({ slug });
    if (existing) slug = `${slug}-${Date.now()}`;

    // 2. Create tenant
    const tenant = await Tenant.create({
        name: dto.companyName,
        slug,
        currency: dto.currency,
    });

    // 3. Hash password and create admin user
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await User.create({
        tenantId: slug,
        email: dto.email,
        passwordHash,
        name: dto.name,
        role: 'ADMIN',
    });

    // 4. Generate tokens
    const accessToken = signAccess({ userId: user._id.toString(), tenantId: slug, role: 'ADMIN' });
    const refreshToken = signRefresh({ userId: user._id.toString(), tenantId: slug });

    // 5. Store hashed refresh token
    user.refreshTokenHash = await bcrypt.hash(refreshToken, 8);
    await user.save();

    return { accessToken, refreshToken, user: safeUser(user), tenant };
};

// ─── Login ────────────────────────────────────────────────────────────────────

export const login = async (dto: LoginDTO) => {
    // 1. Resolve tenant by company id, company name, or single active tenant for the email
    const tenant = await resolveTenantForLogin(dto.tenantSlug, dto.email);
    if (!tenant) {
        throw new ServiceError('Company not found or inactive. Use your company ID (slug) or exact company name.', 'NOT_FOUND');
    }

    // 2. Find user
    const user = await User.findOne({ tenantId: tenant.slug, email: dto.email });
    if (!user) throw new ServiceError('Invalid email or password', 'UNAUTHORIZED');
    if (!user.isActive) throw new ServiceError('Account is deactivated', 'FORBIDDEN');

    // 3. Verify password
    const match = await bcrypt.compare(dto.password, user.passwordHash);
    if (!match) throw new ServiceError('Invalid email or password', 'UNAUTHORIZED');

    // 4. Generate tokens
    const accessToken = signAccess({ userId: user._id.toString(), tenantId: user.tenantId, role: user.role });
    const refreshToken = signRefresh({ userId: user._id.toString(), tenantId: user.tenantId });

    // 5. Store hashed refresh token + update lastLogin
    user.refreshTokenHash = await bcrypt.hash(refreshToken, 8);
    user.lastLogin = new Date();
    await user.save();

    return { accessToken, refreshToken, user: safeUser(user) };
};

// ─── Refresh token ────────────────────────────────────────────────────────────

export const refresh = async (refreshToken: string) => {
    let decoded: any;
    try {
        decoded = jwt.verify(refreshToken, config.jwtRefreshSecret);
    } catch {
        throw new ServiceError('Invalid or expired refresh token', 'UNAUTHORIZED');
    }

    const user = await User.findById(decoded.userId);
    if (!user || !user.isActive) throw new ServiceError('User not found', 'UNAUTHORIZED');
    if (!user.refreshTokenHash) throw new ServiceError('Session expired, please login again', 'UNAUTHORIZED');

    const valid = await bcrypt.compare(refreshToken, user.refreshTokenHash);
    if (!valid) throw new ServiceError('Invalid refresh token', 'UNAUTHORIZED');

    const newAccess = signAccess({ userId: user._id.toString(), tenantId: user.tenantId, role: user.role });
    const newRefresh = signRefresh({ userId: user._id.toString(), tenantId: user.tenantId });

    user.refreshTokenHash = await bcrypt.hash(newRefresh, 8);
    await user.save();

    return { accessToken: newAccess, refreshToken: newRefresh };
};

// ─── Logout ───────────────────────────────────────────────────────────────────

export const logout = async (userId: string) => {
    if (!Types.ObjectId.isValid(userId)) {
        return;
    }
    await User.findByIdAndUpdate(userId, { refreshTokenHash: null });
};

// ─── Get current user ─────────────────────────────────────────────────────────

export const getMe = async (userId: string) => {
    if (!Types.ObjectId.isValid(userId)) {
        if (userId === 'dev_user') {
            return {
                id: 'dev_user',
                tenantId: 'tenant_demo',
                email: 'dev@example.com',
                name: 'Development User',
                role: 'ADMIN' as const,
                isActive: true,
                lastLogin: undefined,
                createdAt: new Date(0),
            };
        }
        throw new ServiceError('User not found', 'NOT_FOUND');
    }
    const user = await User.findById(userId);
    if (!user) throw new ServiceError('User not found', 'NOT_FOUND');
    return safeUser(user);
};

// ─── Change own password ──────────────────────────────────────────────────────

export const changePassword = async (userId: string, dto: ChangePasswordDTO) => {
    if (!Types.ObjectId.isValid(userId)) {
        throw new ServiceError('Change password is unavailable for development fallback users', 'VALIDATION_ERROR');
    }
    const user = await User.findById(userId);
    if (!user) throw new ServiceError('User not found', 'NOT_FOUND');

    const match = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!match) throw new ServiceError('Current password is incorrect', 'VALIDATION_ERROR');

    user.passwordHash = await bcrypt.hash(dto.newPassword, 12);
    user.refreshTokenHash = undefined;
    await user.save();
};

// ─── Admin: manage users ──────────────────────────────────────────────────────

export const createUser = async (dto: CreateUserDTO, tenantId: string) => {
    const exists = await User.findOne({ tenantId, email: dto.email });
    if (exists) throw new ServiceError('A user with this email already exists', 'CONFLICT');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await User.create({ tenantId, email: dto.email, passwordHash, name: dto.name, role: dto.role });
    return safeUser(user);
};

export const listUsers = async (tenantId: string) => {
    const users = await User.find({ tenantId }).sort({ createdAt: -1 }).lean();
    return users.map(u => ({
        id: u._id,
        tenantId: u.tenantId,
        email: u.email,
        name: u.name,
        role: u.role,
        isActive: u.isActive,
        lastLogin: u.lastLogin,
        createdAt: u.createdAt,
    }));
};

export const updateUser = async (userId: string, dto: UpdateUserDTO, tenantId: string) => {
    if (!Types.ObjectId.isValid(userId)) {
        throw new ServiceError('User not found', 'NOT_FOUND');
    }
    const user = await User.findOne({ _id: userId, tenantId });
    if (!user) throw new ServiceError('User not found', 'NOT_FOUND');

    if (dto.name !== undefined) user.name = dto.name;
    if (dto.role !== undefined) user.role = dto.role;
    if (dto.isActive !== undefined) user.isActive = dto.isActive;

    await user.save();
    return safeUser(user);
};

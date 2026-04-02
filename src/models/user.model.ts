import mongoose, { Schema, Document } from 'mongoose';

export type UserRole = 'ADMIN' | 'ACCOUNTANT' | 'PURCHASING' | 'VIEWER';

export interface IUser extends Document {
    tenantId: string;
    email: string;
    passwordHash: string;
    name: string;
    role: UserRole;
    isActive: boolean;
    lastLogin?: Date;
    refreshTokenHash?: string;
    createdAt: Date;
    updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
    {
        tenantId: { type: String, required: true },
        email: { type: String, required: true, lowercase: true, trim: true },
        passwordHash: { type: String, required: true },
        name: { type: String, required: true, trim: true },
        role: {
            type: String,
            enum: ['ADMIN', 'ACCOUNTANT', 'PURCHASING', 'VIEWER'],
            default: 'VIEWER',
        },
        isActive: { type: Boolean, default: true },
        lastLogin: { type: Date },
        refreshTokenHash: { type: String },
    },
    { timestamps: true, collection: 'users' }
);

UserSchema.index({ tenantId: 1, email: 1 }, { unique: true });
UserSchema.index({ tenantId: 1, role: 1 });

export const User = mongoose.model<IUser>('User', UserSchema);

import mongoose, { Schema, Document } from 'mongoose';

export interface ITenant extends Document {
    name: string;
    slug: string;
    currency: string;
    fiscalYearStart: number;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const TenantSchema = new Schema<ITenant>(
    {
        name: { type: String, required: true, trim: true },
        slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
        currency: { type: String, default: 'USD' },
        fiscalYearStart: { type: Number, default: 1, min: 1, max: 12 },
        isActive: { type: Boolean, default: true },
    },
    { timestamps: true, collection: 'tenants' }
);

TenantSchema.index({ slug: 1 }, { unique: true });

export const Tenant = mongoose.model<ITenant>('Tenant', TenantSchema);

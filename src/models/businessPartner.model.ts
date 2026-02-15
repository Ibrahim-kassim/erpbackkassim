import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IBusinessPartner extends Document {
    tenantId: string;
    code: string;
    name: string;
    roles: string[];
    currency: string;
    status: 'ACTIVE' | 'INACTIVE';
    taxNumber?: string;
    email?: string;
    phone?: string;
    address?: {
        country?: string;
        city?: string;
        street?: string;
        postalCode?: string;
    };
    paymentTerms?: string;
    creditLimit?: number;
    isDeleted: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const BusinessPartnerSchema: Schema = new Schema({
    tenantId: { type: String, required: true },
    code: { type: String, required: true },
    name: { type: String, required: true },
    roles: {
        type: [String],
        enum: ['CUSTOMER', 'VENDOR'],
        required: true
    },
    currency: { type: String, default: 'USD' },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
    taxNumber: { type: String },
    email: { type: String },
    phone: { type: String },
    address: {
        country: { type: String },
        city: { type: String },
        street: { type: String },
        postalCode: { type: String }
    },
    paymentTerms: { type: String },
    creditLimit: { type: Number, default: 0 },
    isDeleted: { type: Boolean, default: false }
}, {
    timestamps: true,
    collection: 'business_partners'
});

// Indexes
BusinessPartnerSchema.index({ tenantId: 1, code: 1 }, { unique: true });
BusinessPartnerSchema.index({ tenantId: 1, roles: 1 });
BusinessPartnerSchema.index({ tenantId: 1, status: 1 });
BusinessPartnerSchema.index({ tenantId: 1, isDeleted: 1 });

BusinessPartnerSchema.set('toObject', { virtuals: true });
BusinessPartnerSchema.set('toJSON', { virtuals: true });

export const BusinessPartner = mongoose.model<IBusinessPartner>('BusinessPartner', BusinessPartnerSchema);

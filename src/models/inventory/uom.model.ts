import mongoose, { Schema, Document } from 'mongoose';

export interface IUom extends Document {
    tenantId: string;
    name: string;
    symbol: string;
    status: 'ACTIVE' | 'INACTIVE';
    isDeleted: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const UomSchema: Schema = new Schema(
    {
        tenantId: { type: String, required: true, index: true },
        name: { type: String, required: true },
        symbol: { type: String, required: true },
        status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
        isDeleted: { type: Boolean, default: false },
    },
    { timestamps: true }
);

// Compound index to ensure unique name/symbol per tenant
UomSchema.index({ tenantId: 1, name: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
UomSchema.index({ tenantId: 1, symbol: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });

export const Uom = mongoose.model<IUom>('Uom', UomSchema);

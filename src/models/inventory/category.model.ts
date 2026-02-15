import mongoose, { Schema, Document } from 'mongoose';

export interface ICategory extends Document {
    tenantId: string;
    name: string;
    status: 'ACTIVE' | 'INACTIVE';
    isDeleted: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const CategorySchema: Schema = new Schema(
    {
        tenantId: { type: String, required: true, index: true },
        name: { type: String, required: true },
        status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
        isDeleted: { type: Boolean, default: false },
    },
    { timestamps: true }
);

// Compound index to ensure unique names per tenant
CategorySchema.index({ tenantId: 1, name: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });

export const Category = mongoose.model<ICategory>('Category', CategorySchema);

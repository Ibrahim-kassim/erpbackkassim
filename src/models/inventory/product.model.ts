import mongoose, { Schema, Document } from 'mongoose';

export interface IProduct extends Document {
    tenantId: string;
    code: string;
    name: string;
    type: 'PRODUCT' | 'SERVICE';
    categoryId: mongoose.Types.ObjectId;
    uomId: mongoose.Types.ObjectId;
    unitPrice: number;
    costPrice?: number;
    vatRate: number;
    inventoryTracked: boolean;
    status: 'ACTIVE' | 'INACTIVE';
    isDeleted: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const ProductSchema: Schema = new Schema(
    {
        tenantId: { type: String, required: true, index: true },
        code: { type: String, required: true },
        name: { type: String, required: true },
        type: { type: String, enum: ['PRODUCT', 'SERVICE'], required: true },
        categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
        uomId: { type: Schema.Types.ObjectId, ref: 'Uom', required: true },
        unitPrice: { type: Number, required: true, min: 0 },
        costPrice: { type: Number, min: 0 },
        vatRate: { type: Number, default: 0, min: 0, max: 100 },
        inventoryTracked: { type: Boolean, default: true },
        status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
        isDeleted: { type: Boolean, default: false },
    },
    { timestamps: true }
);

// Compound index to ensure unique code per tenant
ProductSchema.index({ tenantId: 1, code: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
ProductSchema.index({ tenantId: 1, name: 1 }); // For search

export const Product = mongoose.model<IProduct>('Product', ProductSchema);

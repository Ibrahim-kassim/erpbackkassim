import mongoose, { Schema, Document } from 'mongoose';

export interface IStock extends Document {
    tenantId: string;
    productId: mongoose.Types.ObjectId;
    quantityOnHand: number;
    reservedQuantity: number;
    isDeleted: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const StockSchema: Schema = new Schema(
    {
        tenantId: { type: String, required: true, index: true },
        productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
        quantityOnHand: { type: Number, required: true, default: 0, min: 0 },
        reservedQuantity: { type: Number, required: true, default: 0, min: 0 },
        isDeleted: { type: Boolean, default: false },
    },
    { timestamps: true }
);

// One stock record per product per tenant
StockSchema.index({ tenantId: 1, productId: 1 }, { unique: true });

export const Stock = mongoose.model<IStock>('Stock', StockSchema);

import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IRFQItem {
    productId?: Types.ObjectId;
    description: string;
    quantity: number;
    uomId: Types.ObjectId;
}

export interface IRFQ extends Document {
    tenantId: string;
    rfqNumber: string;
    title: string;
    vendorIds: Types.ObjectId[];
    items: IRFQItem[];
    status: 'DRAFT' | 'SENT' | 'CLOSED';
    createdBy?: string;
    isDeleted: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const RFQItemSchema = new Schema({
    productId: { type: Schema.Types.ObjectId, ref: 'Product' },
    description: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    uomId: { type: Schema.Types.ObjectId, ref: 'Uom', required: true }
}, { _id: false });

const RFQSchema: Schema = new Schema({
    tenantId: { type: String, required: true, index: true },
    rfqNumber: { type: String, required: true },
    title: { type: String, required: true },
    vendorIds: [{ type: Schema.Types.ObjectId, ref: 'BusinessPartner', required: true }],
    items: { type: [RFQItemSchema], required: true, validate: [(arr: IRFQItem[]) => arr.length > 0, 'At least one item is required'] },
    status: { type: String, enum: ['DRAFT', 'SENT', 'CLOSED'], default: 'DRAFT' },
    createdBy: { type: String },
    isDeleted: { type: Boolean, default: false }
}, {
    timestamps: true,
    collection: 'rfqs'
});

// Indexes
RFQSchema.index({ tenantId: 1, rfqNumber: 1 }, { unique: true });
RFQSchema.index({ tenantId: 1, status: 1 });
RFQSchema.index({ tenantId: 1, isDeleted: 1 });

RFQSchema.set('toObject', { virtuals: true });
RFQSchema.set('toJSON', { virtuals: true });

export const RFQ = mongoose.model<IRFQ>('RFQ', RFQSchema);

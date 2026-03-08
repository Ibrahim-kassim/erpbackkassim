import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IPOLine {
    description: string;
    quantity: number;
    unitPrice: number;
    vatRate: number;        // e.g. 15 for 15%
    lineNet: number;        // qty * unitPrice
    vatAmount: number;      // lineNet * vatRate/100
    lineTotal: number;      // lineNet + vatAmount
}

export interface IPurchaseOrder extends Document {
    tenantId: string;
    poNumber: string;
    vendorId: Types.ObjectId;
    vendorName: string;
    source?: {
        rfqId?: Types.ObjectId;
        quotationId?: Types.ObjectId;
        rfqNo?: string;
    };
    orderDate: Date;
    expectedDeliveryDate?: Date;
    currency: string;
    status: 'DRAFT' | 'APPROVED' | 'CANCELLED' | 'CLOSED';
    notes?: string;
    lines: IPOLine[];
    subtotal: number;
    vatTotal: number;
    grandTotal: number;
    isDeleted: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const POLineSchema = new Schema<IPOLine>({
    description: { type: String, required: true },
    quantity: { type: Number, required: true, min: 0.0001 },
    unitPrice: { type: Number, required: true, min: 0 },
    vatRate: { type: Number, default: 0, min: 0, max: 100 },
    lineNet: { type: Number, required: true },
    vatAmount: { type: Number, required: true },
    lineTotal: { type: Number, required: true },
});

const PurchaseOrderSchema = new Schema<IPurchaseOrder>(
    {
        tenantId: { type: String, required: true, index: true },
        poNumber: { type: String, required: true },
        vendorId: { type: Schema.Types.ObjectId, ref: 'BusinessPartner', required: true },
        vendorName: { type: String, required: true },
        source: {
            rfqId: { type: Schema.Types.ObjectId, ref: 'RFQ' },
            quotationId: { type: Schema.Types.ObjectId, ref: 'Quotation' },
            rfqNo: { type: String },
        },
        orderDate: { type: Date, required: true },
        expectedDeliveryDate: { type: Date },
        currency: { type: String, default: 'USD' },
        status: {
            type: String,
            enum: ['DRAFT', 'APPROVED', 'CANCELLED', 'CLOSED'],
            default: 'DRAFT',
        },
        notes: { type: String },
        lines: { type: [POLineSchema], default: [] },
        subtotal: { type: Number, default: 0 },
        vatTotal: { type: Number, default: 0 },
        grandTotal: { type: Number, default: 0 },
        isDeleted: { type: Boolean, default: false },
    },
    { timestamps: true }
);

// Compound unique: poNumber per tenant
PurchaseOrderSchema.index({ tenantId: 1, poNumber: 1 }, { unique: true });

export const PurchaseOrder = mongoose.model<IPurchaseOrder>('PurchaseOrder', PurchaseOrderSchema);

import mongoose, { Document, Schema, Types } from 'mongoose';

export type GRNStatus = 'DRAFT' | 'CONFIRMED' | 'CANCELLED';

export interface IGRNLine {
    poLineIndex: number;
    description: string;
    productId?: Types.ObjectId;
    orderedQty: number;
    receivedQty: number;
    unitCost: number;
    lineTotal: number;
}

export interface IGRN extends Document {
    tenantId: string;
    grnNo: string;
    poId: Types.ObjectId;
    poNumber: string;
    vendorId: Types.ObjectId;
    vendorName: string;
    receiptDate: Date;
    fiscalPeriodId: Types.ObjectId;
    fiscalYearId: Types.ObjectId;
    status: GRNStatus;
    lines: IGRNLine[];
    totalCost: number;
    journalEntryId?: Types.ObjectId;
    journalEntryNo?: string;
    notes?: string;
    isDeleted: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const GRNLineSchema = new Schema<IGRNLine>(
    {
        poLineIndex: { type: Number, required: true, min: 0 },
        description: { type: String, required: true },
        productId: { type: Schema.Types.ObjectId, ref: 'Product' },
        orderedQty: { type: Number, required: true, min: 0.0001 },
        receivedQty: { type: Number, required: true, min: 0.0001 },
        unitCost: { type: Number, required: true, min: 0 },
        lineTotal: { type: Number, required: true, min: 0 },
    },
    { _id: false }
);

const GRNSchema = new Schema<IGRN>(
    {
        tenantId: { type: String, required: true, index: true },
        grnNo: { type: String, required: true },
        poId: { type: Schema.Types.ObjectId, ref: 'PurchaseOrder', required: true },
        poNumber: { type: String, required: true },
        vendorId: { type: Schema.Types.ObjectId, ref: 'BusinessPartner', required: true },
        vendorName: { type: String, required: true },
        receiptDate: { type: Date, required: true },
        fiscalPeriodId: { type: Schema.Types.ObjectId, required: true },
        fiscalYearId: { type: Schema.Types.ObjectId, required: true },
        status: {
            type: String,
            enum: ['DRAFT', 'CONFIRMED', 'CANCELLED'],
            default: 'DRAFT',
        },
        lines: { type: [GRNLineSchema], default: [] },
        totalCost: { type: Number, default: 0 },
        journalEntryId: { type: Schema.Types.ObjectId, ref: 'JournalEntry' },
        journalEntryNo: { type: String },
        notes: { type: String },
        isDeleted: { type: Boolean, default: false },
    },
    { timestamps: true, collection: 'grns' }
);

GRNSchema.index({ tenantId: 1, grnNo: 1 }, { unique: true });
GRNSchema.index({ tenantId: 1, poId: 1, status: 1 });
GRNSchema.index({ tenantId: 1, receiptDate: 1 });
GRNSchema.index({ tenantId: 1, isDeleted: 1 });

export const GRN = mongoose.model<IGRN>('GRN', GRNSchema);

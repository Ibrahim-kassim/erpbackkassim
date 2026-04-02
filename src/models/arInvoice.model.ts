import mongoose, { Schema, Document, Types } from 'mongoose';

export type ARInvoiceStatus = 'DRAFT' | 'POSTED' | 'VOID';
export type ARInvoiceLineType = 'CATALOG' | 'MANUAL';
export type ARInvoiceItemKind = 'PRODUCT' | 'SERVICE' | 'MANUAL';

export interface IARInvoiceItem {
    lineType: ARInvoiceLineType;
    productId?: Types.ObjectId;
    itemCode?: string;
    itemName?: string;
    itemKind: ARInvoiceItemKind;
    uomLabel?: string;
    description: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
}

export interface IARInvoice extends Document {
    tenantId: string;
    invoiceNo: string;          // ARINV-000001
    customerId: Types.ObjectId;
    customerName: string;
    status: ARInvoiceStatus;
    invoiceDate: Date;
    postingDate: Date;
    dueDate: Date;
    fiscalPeriodId?: Types.ObjectId;
    fiscalYearId?: Types.ObjectId;
    currency: string;
    notes?: string;
    items: IARInvoiceItem[];
    accounting: {
        revenueAccountId: Types.ObjectId;
        arAccountId: Types.ObjectId;
    };
    totals: {
        subtotal: number;
        taxTotal: number;
        total: number;
    };
    amountReceived: number;
    balance: number;
    journalEntryId?: Types.ObjectId;
    journalEntryNo?: string;
    isDeleted: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const ARInvoiceItemSchema = new Schema<IARInvoiceItem>({
    lineType: { type: String, enum: ['CATALOG', 'MANUAL'], default: 'MANUAL' },
    productId: { type: Schema.Types.ObjectId, ref: 'Product' },
    itemCode: { type: String },
    itemName: { type: String },
    itemKind: { type: String, enum: ['PRODUCT', 'SERVICE', 'MANUAL'], default: 'MANUAL' },
    uomLabel: { type: String },
    description: { type: String, required: true },
    quantity: { type: Number, required: true, min: 0.0001 },
    unitPrice: { type: Number, required: true, min: 0 },
    lineTotal: { type: Number, required: true },
}, { _id: false });

const ARInvoiceSchema = new Schema<IARInvoice>(
    {
        tenantId: { type: String, required: true },
        invoiceNo: { type: String, required: true },
        customerId: { type: Schema.Types.ObjectId, ref: 'BusinessPartner', required: true },
        customerName: { type: String, required: true },
        status: { type: String, enum: ['DRAFT', 'POSTED', 'VOID'], default: 'DRAFT' },
        invoiceDate: { type: Date, required: true },
        postingDate: { type: Date, required: true },
        dueDate: { type: Date, required: true },
        fiscalPeriodId: { type: Schema.Types.ObjectId },
        fiscalYearId: { type: Schema.Types.ObjectId },
        currency: { type: String, default: 'USD' },
        notes: { type: String },
        items: { type: [ARInvoiceItemSchema], default: [] },
        accounting: {
            revenueAccountId: { type: Schema.Types.ObjectId, ref: 'ChartOfAccount', required: true },
            arAccountId: { type: Schema.Types.ObjectId, ref: 'ChartOfAccount', required: true },
        },
        totals: {
            subtotal: { type: Number, default: 0 },
            taxTotal: { type: Number, default: 0 },
            total: { type: Number, default: 0 },
        },
        amountReceived: { type: Number, default: 0 },
        balance: { type: Number, default: 0 },
        journalEntryId: { type: Schema.Types.ObjectId, ref: 'JournalEntry' },
        journalEntryNo: { type: String },
        isDeleted: { type: Boolean, default: false },
    },
    { timestamps: true, collection: 'ar_invoices' }
);

ARInvoiceSchema.index({ tenantId: 1, invoiceNo: 1 }, { unique: true });
ARInvoiceSchema.index({ tenantId: 1, customerId: 1, status: 1 });
ARInvoiceSchema.index({ tenantId: 1, dueDate: 1, status: 1 });
ARInvoiceSchema.index({ tenantId: 1, isDeleted: 1 });

export const ARInvoice = mongoose.model<IARInvoice>('ARInvoice', ARInvoiceSchema);

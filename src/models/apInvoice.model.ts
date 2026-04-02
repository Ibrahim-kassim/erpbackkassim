import mongoose, { Schema, Document, Types } from 'mongoose';

export type APInvoiceStatus = 'DRAFT' | 'POSTED' | 'VOID';

export interface IAPInvoiceItem {
    description: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
}

export interface IAPInvoice extends Document {
    tenantId: string;
    invoiceNo: string;          // APINV-000001
    vendorId: Types.ObjectId;
    vendorName: string;
    status: APInvoiceStatus;
    invoiceDate: Date;
    postingDate: Date;
    dueDate?: Date;
    fiscalPeriodId?: Types.ObjectId;
    fiscalYearId?: Types.ObjectId;
    currencyCode: string;
    notes?: string;
    source?: {
        purchaseOrderId?: Types.ObjectId;
        poNo?: string;
    };
    items: IAPInvoiceItem[];
    accounting: {
        expenseAccountId: Types.ObjectId;
        apAccountId: Types.ObjectId;
    };
    totals: {
        subtotal: number;
        tax: number;
        total: number;
    };
    amountPaid: number;
    balance: number;
    journalEntryId?: Types.ObjectId;
    journalEntryNo?: string;
    isDeleted: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const APInvoiceItemSchema = new Schema<IAPInvoiceItem>({
    description: { type: String, required: true },
    quantity: { type: Number, required: true, min: 0.0001 },
    unitPrice: { type: Number, required: true, min: 0 },
    lineTotal: { type: Number, required: true },
}, { _id: false });

const APInvoiceSchema = new Schema<IAPInvoice>(
    {
        tenantId: { type: String, required: true },
        invoiceNo: { type: String, required: true },
        vendorId: { type: Schema.Types.ObjectId, ref: 'BusinessPartner', required: true },
        vendorName: { type: String, required: true },
        status: { type: String, enum: ['DRAFT', 'POSTED', 'VOID'], default: 'DRAFT' },
        invoiceDate: { type: Date, required: true },
        postingDate: { type: Date, required: true },
        dueDate: { type: Date },
        fiscalPeriodId: { type: Schema.Types.ObjectId },
        fiscalYearId: { type: Schema.Types.ObjectId },
        currencyCode: { type: String, default: 'USD' },
        notes: { type: String },
        source: {
            purchaseOrderId: { type: Schema.Types.ObjectId, ref: 'PurchaseOrder' },
            poNo: { type: String },
        },
        items: { type: [APInvoiceItemSchema], default: [] },
        accounting: {
            expenseAccountId: { type: Schema.Types.ObjectId, ref: 'ChartOfAccount', required: true },
            apAccountId: { type: Schema.Types.ObjectId, ref: 'ChartOfAccount', required: true },
        },
        totals: {
            subtotal: { type: Number, default: 0 },
            tax: { type: Number, default: 0 },
            total: { type: Number, default: 0 },
        },
        amountPaid: { type: Number, default: 0 },
        balance: { type: Number, default: 0 },
        journalEntryId: { type: Schema.Types.ObjectId, ref: 'JournalEntry' },
        journalEntryNo: { type: String },
        isDeleted: { type: Boolean, default: false },
    },
    { timestamps: true, collection: 'ap_invoices' }
);

APInvoiceSchema.index({ tenantId: 1, invoiceNo: 1 }, { unique: true });
APInvoiceSchema.index({ tenantId: 1, vendorId: 1, status: 1 });
APInvoiceSchema.index({ tenantId: 1, postingDate: 1 });
APInvoiceSchema.index({ tenantId: 1, isDeleted: 1 });

export const APInvoice = mongoose.model<IAPInvoice>('APInvoice', APInvoiceSchema);

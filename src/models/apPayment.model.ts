import mongoose, { Schema, Document, Types } from 'mongoose';

export type PaymentStatus = 'DRAFT' | 'POSTED';
export type PaymentMethod = 'BANK' | 'CASH' | 'TRANSFER';

export interface IAPAllocation {
    invoiceId: Types.ObjectId;
    invoiceNo: string;
    allocatedAmount: number;
}

export interface IAPPayment extends Document {
    tenantId: string;
    paymentNo: string;          // APPMT-000001
    vendorId: Types.ObjectId;
    vendorName: string;
    status: PaymentStatus;
    paymentDate: Date;
    postingDate: Date;
    fiscalPeriodId?: Types.ObjectId;
    fiscalYearId?: Types.ObjectId;
    method: PaymentMethod;
    apAccountId: Types.ObjectId;
    paymentAccountId: Types.ObjectId;
    currencyCode: string;
    memo?: string;
    amount: number;
    allocatedAmount: number;
    unallocatedAmount: number;
    allocations: IAPAllocation[];
    journalEntryId?: Types.ObjectId;
    journalEntryNo?: string;
    isDeleted: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const APAllocationSchema = new Schema<IAPAllocation>({
    invoiceId: { type: Schema.Types.ObjectId, ref: 'APInvoice', required: true },
    invoiceNo: { type: String, required: true },
    allocatedAmount: { type: Number, required: true, min: 0 },
}, { _id: false });

const APPaymentSchema = new Schema<IAPPayment>(
    {
        tenantId: { type: String, required: true },
        paymentNo: { type: String, required: true },
        vendorId: { type: Schema.Types.ObjectId, ref: 'BusinessPartner', required: true },
        vendorName: { type: String, required: true },
        status: { type: String, enum: ['DRAFT', 'POSTED'], default: 'DRAFT' },
        paymentDate: { type: Date, required: true },
        postingDate: { type: Date, required: true },
        fiscalPeriodId: { type: Schema.Types.ObjectId },
        fiscalYearId: { type: Schema.Types.ObjectId },
        method: { type: String, enum: ['BANK', 'CASH', 'TRANSFER'], required: true },
        apAccountId: { type: Schema.Types.ObjectId, ref: 'ChartOfAccount', required: true },
        paymentAccountId: { type: Schema.Types.ObjectId, ref: 'ChartOfAccount', required: true },
        currencyCode: { type: String, default: 'USD' },
        memo: { type: String },
        amount: { type: Number, required: true, min: 0.01 },
        allocatedAmount: { type: Number, default: 0 },
        unallocatedAmount: { type: Number, default: 0 },
        allocations: { type: [APAllocationSchema], default: [] },
        journalEntryId: { type: Schema.Types.ObjectId, ref: 'JournalEntry' },
        journalEntryNo: { type: String },
        isDeleted: { type: Boolean, default: false },
    },
    { timestamps: true, collection: 'ap_payments' }
);

APPaymentSchema.index({ tenantId: 1, paymentNo: 1 }, { unique: true });
APPaymentSchema.index({ tenantId: 1, vendorId: 1, status: 1 });
APPaymentSchema.index({ tenantId: 1, postingDate: 1 });
APPaymentSchema.index({ tenantId: 1, 'allocations.invoiceId': 1 });

export const APPayment = mongoose.model<IAPPayment>('APPayment', APPaymentSchema);

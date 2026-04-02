import mongoose, { Schema, Document, Types } from 'mongoose';

export type ReceiptStatus = 'DRAFT' | 'POSTED';
export type ReceiptMethod = 'BANK' | 'CASH' | 'TRANSFER';

export interface IARAllocation {
    invoiceId: Types.ObjectId;
    invoiceNo: string;
    allocatedAmount: number;
}

export interface IARReceipt extends Document {
    tenantId: string;
    receiptNo: string;          // ARREC-000001
    customerId: Types.ObjectId;
    customerName: string;
    status: ReceiptStatus;
    receiptDate: Date;
    postingDate: Date;
    fiscalPeriodId?: Types.ObjectId;
    fiscalYearId?: Types.ObjectId;
    method: ReceiptMethod;
    bankAccountId: Types.ObjectId;
    arAccountId: Types.ObjectId;
    currencyCode: string;
    memo?: string;
    amount: number;
    allocatedAmount: number;
    unallocatedAmount: number;
    allocations: IARAllocation[];
    journalEntryId?: Types.ObjectId;
    journalEntryNo?: string;
    isDeleted: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const ARAllocationSchema = new Schema<IARAllocation>({
    invoiceId: { type: Schema.Types.ObjectId, ref: 'ARInvoice', required: true },
    invoiceNo: { type: String, required: true },
    allocatedAmount: { type: Number, required: true, min: 0 },
}, { _id: false });

const ARReceiptSchema = new Schema<IARReceipt>(
    {
        tenantId: { type: String, required: true },
        receiptNo: { type: String, required: true },
        customerId: { type: Schema.Types.ObjectId, ref: 'BusinessPartner', required: true },
        customerName: { type: String, required: true },
        status: { type: String, enum: ['DRAFT', 'POSTED'], default: 'DRAFT' },
        receiptDate: { type: Date, required: true },
        postingDate: { type: Date, required: true },
        fiscalPeriodId: { type: Schema.Types.ObjectId },
        fiscalYearId: { type: Schema.Types.ObjectId },
        method: { type: String, enum: ['BANK', 'CASH', 'TRANSFER'], required: true },
        bankAccountId: { type: Schema.Types.ObjectId, ref: 'ChartOfAccount', required: true },
        arAccountId: { type: Schema.Types.ObjectId, ref: 'ChartOfAccount', required: true },
        currencyCode: { type: String, default: 'USD' },
        memo: { type: String },
        amount: { type: Number, required: true, min: 0.01 },
        allocatedAmount: { type: Number, default: 0 },
        unallocatedAmount: { type: Number, default: 0 },
        allocations: { type: [ARAllocationSchema], default: [] },
        journalEntryId: { type: Schema.Types.ObjectId, ref: 'JournalEntry' },
        journalEntryNo: { type: String },
        isDeleted: { type: Boolean, default: false },
    },
    { timestamps: true, collection: 'ar_receipts' }
);

ARReceiptSchema.index({ tenantId: 1, receiptNo: 1 }, { unique: true });
ARReceiptSchema.index({ tenantId: 1, customerId: 1, status: 1 });
ARReceiptSchema.index({ tenantId: 1, postingDate: 1 });

export const ARReceipt = mongoose.model<IARReceipt>('ARReceipt', ARReceiptSchema);

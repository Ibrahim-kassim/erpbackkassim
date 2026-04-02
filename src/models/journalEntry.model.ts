import mongoose, { Schema, Document, Types } from 'mongoose';

export enum EntryStatus {
    DRAFT = 'DRAFT',
    POSTED = 'POSTED',
    REVERSED = 'REVERSED'
}

export enum EntryType {
    JOURNAL_ENTRY = 'Journal Entry',
    AP_INVOICE = 'AP Invoice',
    AP_PAYMENT = 'AP Payment',
    AR_INVOICE = 'AR Invoice',
    AR_RECEIPT = 'AR Receipt',
    GOODS_RECEIPT_NOTE = 'Goods Receipt Note',
    INTER_COMPANY_JOURNAL_ENTRY = 'Inter Company Journal Entry',
    BANK_ENTRY = 'Bank Entry',
    CASH_ENTRY = 'Cash Entry',
    CREDIT_CARD_ENTRY = 'Credit Card Entry',
    DEBIT_NOTE = 'Debit Note',
    CREDIT_NOTE = 'Credit Note',
    CONTRA_ENTRY = 'Contra Entry',
    EXCISE_ENTRY = 'Excise Entry',
    WRITE_OFF_ENTRY = 'Write Off Entry',
    OPENING_ENTRY = 'Opening Entry',
    DEPRECIATION_ENTRY = 'Depreciation Entry',
    EXCHANGE_RATE_REVALUATION = 'Exchange Rate Revaluation',
    EXCHANGE_GAIN_OR_LOSS = 'Exchange Gain Or Loss',
    DEFERRED_REVENUE = 'Deferred Revenue',
    DEFERRED_EXPENSE = 'Deferred Expense'
}

export interface IJournalLine {
    _id?: Types.ObjectId; // Optional because Mongoose adds it automatically, but helpful for types
    accountId: Types.ObjectId;
    accountCode: string;
    accountName: string;
    description?: string;
    debit: number;
    credit: number;
}

export interface IJournalEntry extends Document {
    tenantId: string;
    entryNo: string;
    status: EntryStatus;
    entryType: EntryType;
    postingDate: Date;
    fiscalPeriodId: Types.ObjectId;
    fiscalYearId: Types.ObjectId;
    fiscalPeriodLabelSnapshot?: string;
    description?: string;
    reference?: string;

    sourceType?: string;
    sourceId?: Types.ObjectId;
    sourceNo?: string;

    totals: {
        debitTotal: number;
        creditTotal: number;
    };

    lines: IJournalLine[];

    postedAt?: Date;
    reversedByEntryId?: Types.ObjectId;
    reversedAt?: Date;

    createdAt: Date;
    updatedAt: Date;
}

const JournalLineSchema = new Schema({
    accountId: { type: Schema.Types.ObjectId, required: true, ref: 'ChartOfAccount' },
    accountCode: { type: String, required: true },
    accountName: { type: String, required: true },
    description: { type: String },
    debit: { type: Number, required: true, min: 0, default: 0 },
    credit: { type: Number, required: true, min: 0, default: 0 }
});

const JournalEntrySchema: Schema = new Schema({
    tenantId: { type: String, required: true },
    entryNo: { type: String, required: true },
    status: { type: String, enum: Object.values(EntryStatus), default: EntryStatus.DRAFT },
    entryType: { type: String, enum: Object.values(EntryType), default: EntryType.JOURNAL_ENTRY },
    postingDate: { type: Date, required: true },
    fiscalPeriodId: { type: Schema.Types.ObjectId, required: true, ref: 'FiscalPeriod' },
    fiscalYearId: { type: Schema.Types.ObjectId, required: true, ref: 'FiscalCalendar' },
    fiscalPeriodLabelSnapshot: { type: String },

    description: { type: String },
    reference: { type: String },

    sourceType: { type: String },
    sourceId: { type: Schema.Types.ObjectId },
    sourceNo: { type: String },

    totals: {
        debitTotal: { type: Number, required: true, default: 0 },
        creditTotal: { type: Number, required: true, default: 0 }
    },

    lines: { type: [JournalLineSchema], required: true },

    postedAt: { type: Date },
    reversedByEntryId: { type: Schema.Types.ObjectId, ref: 'JournalEntry' },
    reversedAt: { type: Date }
}, {
    timestamps: true,
    collection: 'journal_entries'
});

// Indexes
JournalEntrySchema.index({ tenantId: 1, entryNo: 1 }, { unique: true });
JournalEntrySchema.index({ tenantId: 1, postingDate: 1 });
JournalEntrySchema.index({ tenantId: 1, fiscalPeriodId: 1 });
JournalEntrySchema.index({ tenantId: 1, fiscalYearId: 1 });
JournalEntrySchema.index({ tenantId: 1, sourceType: 1, sourceId: 1 }, {
    unique: true,
    partialFilterExpression: { status: EntryStatus.POSTED, sourceType: { $exists: true }, sourceId: { $exists: true } }
});
JournalEntrySchema.index({ tenantId: 1, "lines.accountId": 1 });

export const JournalEntry = mongoose.model<IJournalEntry>('JournalEntry', JournalEntrySchema);

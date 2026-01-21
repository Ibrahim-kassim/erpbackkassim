import mongoose, { Schema, Document, Types } from 'mongoose';

export enum AccountType {
    ASSET = 'ASSET',
    LIABILITY = 'LIABILITY',
    EQUITY = 'EQUITY',
    REVENUE = 'REVENUE',
    EXPENSE = 'EXPENSE',
    CASH = 'CASH',
    INCOME = 'INCOME'
}

export enum NormalBalance {
    DEBIT = 'DEBIT',
    CREDIT = 'CREDIT'
}

export interface IChartOfAccount extends Document {
    tenantId: string;
    code: string;
    name: string;
    type: AccountType;
    normalBalance: NormalBalance;
    parentId: Types.ObjectId | null;
    level: number;
    path: string;
    isPosting: boolean;
    isActive: boolean;
    description?: string;
    systemControlled: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const ChartOfAccountSchema: Schema = new Schema({
    tenantId: { type: String, required: true },
    code: { type: String, required: true },
    name: { type: String, required: true },
    type: {
        type: String,
        enum: Object.values(AccountType),
        required: true
    },
    normalBalance: {
        type: String,
        enum: Object.values(NormalBalance),
        required: true
    },
    parentId: { type: Schema.Types.ObjectId, ref: 'ChartOfAccount', default: null },
    level: { type: Number, required: true },
    path: { type: String, required: true },
    isPosting: { type: Boolean, required: true },
    isActive: { type: Boolean, default: true },
    description: { type: String },
    systemControlled: { type: Boolean, default: false },
}, {
    timestamps: true,
    collection: 'chart_of_accounts'
});

// Indexes
ChartOfAccountSchema.index({ tenantId: 1, code: 1 }, { unique: true });
ChartOfAccountSchema.index({ tenantId: 1, parentId: 1 });
ChartOfAccountSchema.index({ tenantId: 1, type: 1 });
ChartOfAccountSchema.index({ tenantId: 1, path: 1 });

ChartOfAccountSchema.virtual('childrenCount', {
    ref: 'ChartOfAccount',
    localField: '_id',
    foreignField: 'parentId',
    count: true
});

ChartOfAccountSchema.set('toObject', { virtuals: true });
ChartOfAccountSchema.set('toJSON', { virtuals: true });

export const ChartOfAccount = mongoose.model<IChartOfAccount>('ChartOfAccount', ChartOfAccountSchema);

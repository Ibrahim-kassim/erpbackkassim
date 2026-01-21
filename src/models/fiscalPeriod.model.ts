import mongoose, { Schema, Document } from 'mongoose';

export enum FiscalPeriodStatus {
    OPEN = 'OPEN',
    CLOSED = 'CLOSED',
    LOCKED = 'LOCKED'
}

export interface IFiscalPeriod extends Document {
    tenantId: string;
    name: string;
    startDate: Date;
    endDate: Date;
    status: FiscalPeriodStatus;
}

const FiscalPeriodSchema: Schema = new Schema({
    tenantId: { type: String, required: true },
    name: { type: String, required: true }, // e.g., 'Jan 2026'
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    status: { type: String, enum: Object.values(FiscalPeriodStatus), default: FiscalPeriodStatus.OPEN }
}, {
    timestamps: true
});

FiscalPeriodSchema.index({ tenantId: 1, startDate: 1, endDate: 1 });

export const FiscalPeriod = mongoose.model<IFiscalPeriod>('FiscalPeriod', FiscalPeriodSchema);

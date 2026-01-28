import mongoose, { Schema, Document, Types } from 'mongoose';

export type FiscalPeriodStatus = 'OPEN' | 'LOCKED' | 'CLOSED';
export type FiscalYearStatus = 'OPEN' | 'CLOSED';

export interface IFiscalPeriod {
    _id: Types.ObjectId;
    periodNumber: number;
    code: string;
    label: string;
    startDate: Date;
    endDate: Date;
    status: FiscalPeriodStatus;
}

export interface IFiscalCalendar extends Document {
    tenantId: string;
    yearName: string;
    startDate: Date;
    endDate: Date;
    status: FiscalYearStatus;
    isActive: boolean;
    periods: IFiscalPeriod[];
    createdAt: Date;
    updatedAt: Date;
}

const FiscalPeriodSchema = new Schema({
    periodNumber: { type: Number, required: true },
    code: { type: String, required: true }, // "P01"
    label: { type: String, required: true }, // "Jan 2026"
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    status: {
        type: String,
        enum: ['OPEN', 'LOCKED', 'CLOSED'],
        default: 'LOCKED'
    }
}, { _id: true }); // Ensure _id is created for subdocs

const FiscalCalendarSchema = new Schema({
    tenantId: { type: String, required: true },
    yearName: { type: String, required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    status: {
        type: String,
        enum: ['OPEN', 'CLOSED'],
        default: 'OPEN'
    },
    isActive: { type: Boolean, default: true },
    periods: { type: [FiscalPeriodSchema], default: [] }
}, {
    timestamps: true,
    collection: 'fiscal_calendars'
});

// Indexes
FiscalCalendarSchema.index({ tenantId: 1, yearName: 1 }, { unique: true });
FiscalCalendarSchema.index({ tenantId: 1, startDate: 1, endDate: 1 });

export const FiscalCalendar = mongoose.model<IFiscalCalendar>('FiscalCalendar', FiscalCalendarSchema);

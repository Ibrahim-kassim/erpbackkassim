import mongoose, { Schema, Document } from 'mongoose';

export interface ICounter extends Document {
    tenantId: string;
    key: string; // e.g., 'JE'
    seq: number;
}

const CounterSchema: Schema = new Schema({
    tenantId: { type: String, required: true },
    key: { type: String, required: true },
    seq: { type: Number, default: 0 }
});

CounterSchema.index({ tenantId: 1, key: 1 }, { unique: true });

export const Counter = mongoose.model<ICounter>('Counter', CounterSchema);

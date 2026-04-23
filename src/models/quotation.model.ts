import mongoose, { Schema, Document } from 'mongoose';

export interface IQuotationItem {
    rfqItemId: string;
    unitPrice: number;
    totalPrice: number;
}

export interface IQuotationAttachment {
    filename: string; // stored filename on disk
    originalFilename: string; // user-provided filename
    url: string; // public URL under /uploads
    contentType?: string;
    size?: number;
    data?: Buffer;
    storage?: 'db' | 'disk';
    uploadedAt: Date;
}

export interface IQuotation extends Document {
    tenantId: string;
    rfqId: mongoose.Types.ObjectId;
    vendorId: mongoose.Types.ObjectId;
    items: IQuotationItem[];
    total: number;
    status: 'SUBMITTED' | 'APPROVED' | 'REJECTED';
    pdfPath?: string;
    attachments?: IQuotationAttachment[];
    isDeleted: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const QuotationSchema: Schema = new Schema(
    {
        tenantId: { type: String, required: true, index: true },
        rfqId: { type: Schema.Types.ObjectId, ref: 'RFQ', required: true, index: true },
        vendorId: { type: Schema.Types.ObjectId, ref: 'BusinessPartner', required: true },
        items: [{
            rfqItemId: { type: String, required: true }, // Referencing the sub-document ID or a custom string ID in RFQ
            unitPrice: { type: Number, required: true, min: 0 },
            totalPrice: { type: Number, required: true, min: 0 }
        }],
        total: { type: Number, required: true, min: 0 },
        status: {
            type: String,
            enum: ['SUBMITTED', 'APPROVED', 'REJECTED'],
            default: 'SUBMITTED'
        },
        pdfPath: { type: String },
        attachments: [{
            filename: { type: String, required: true },
            originalFilename: { type: String, required: true },
            url: { type: String, required: true },
            contentType: { type: String },
            size: { type: Number },
            data: { type: Buffer },
            storage: { type: String, enum: ['db', 'disk'], default: 'db' },
            uploadedAt: { type: Date, default: Date.now },
        }],
        isDeleted: { type: Boolean, default: false }
    },
    { timestamps: true }
);

// Compound index to ensure unique quotation per vendor per RFQ
QuotationSchema.index({ tenantId: 1, rfqId: 1, vendorId: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });

export const Quotation = mongoose.model<IQuotation>('Quotation', QuotationSchema);

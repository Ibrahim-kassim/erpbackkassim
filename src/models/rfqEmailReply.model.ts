import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IRFQEmailReplyAttachment {
    filename: string;
    originalFilename: string;
    url: string;
    contentType?: string;
    size?: number;
}

export interface IRFQEmailReply extends Document {
    tenantId: string;
    rfqId: Types.ObjectId;
    vendorId?: Types.ObjectId;
    direction: 'INBOUND' | 'OUTBOUND';
    messageId: string;
    subject: string;
    fromEmail: string;
    fromName?: string;
    toEmail?: string;
    toName?: string;
    bodyText?: string;
    attachments: IRFQEmailReplyAttachment[];
    receivedAt: Date;
    isRead: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const RFQEmailReplyAttachmentSchema = new Schema<IRFQEmailReplyAttachment>(
    {
        filename: { type: String, required: true },
        originalFilename: { type: String, required: true },
        url: { type: String, required: true },
        contentType: { type: String },
        size: { type: Number },
    },
    { _id: false }
);

const RFQEmailReplySchema = new Schema<IRFQEmailReply>(
    {
        tenantId: { type: String, required: true, index: true },
        rfqId: { type: Schema.Types.ObjectId, ref: 'RFQ', required: true, index: true },
        vendorId: { type: Schema.Types.ObjectId, ref: 'BusinessPartner' },
        direction: { type: String, enum: ['INBOUND', 'OUTBOUND'], default: 'INBOUND' },
        messageId: { type: String, required: true },
        subject: { type: String, required: true },
        fromEmail: { type: String, required: true },
        fromName: { type: String },
        toEmail: { type: String },
        toName: { type: String },
        bodyText: { type: String },
        attachments: { type: [RFQEmailReplyAttachmentSchema], default: [] },
        receivedAt: { type: Date, required: true, index: true },
        isRead: { type: Boolean, default: false },
    },
    { timestamps: true, collection: 'rfq_email_replies' }
);

RFQEmailReplySchema.index({ tenantId: 1, messageId: 1 }, { unique: true });
RFQEmailReplySchema.index({ tenantId: 1, rfqId: 1, receivedAt: -1 });

RFQEmailReplySchema.set('toObject', { virtuals: true });
RFQEmailReplySchema.set('toJSON', { virtuals: true });

export const RFQEmailReply = mongoose.model<IRFQEmailReply>('RFQEmailReply', RFQEmailReplySchema);

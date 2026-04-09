import mongoose, { Schema, Document } from 'mongoose';

export interface INotification extends Document {
    tenantId: string;
    type: 'RFQ_VENDOR_REPLY' | 'RFQ_VENDOR_MESSAGE_SENT' | 'AR_CUSTOMER_REPLY' | 'AR_CUSTOMER_MESSAGE_SENT';
    title: string;
    message: string;
    href?: string;
    isRead: boolean;
    metadata?: {
        rfqId?: string;
        rfqNumber?: string;
        arInvoiceId?: string;
        arInvoiceNo?: string;
        emailReplyId?: string;
        vendorId?: string;
        vendorName?: string;
        customerId?: string;
        customerName?: string;
        subject?: string;
        fromEmail?: string;
        fromName?: string;
        toEmail?: string;
        toName?: string;
        direction?: 'INBOUND' | 'OUTBOUND';
        attachmentCount?: number;
        bodySnippet?: string;
        attachments?: Array<{
            filename: string;
            originalFilename: string;
            url: string;
            contentType?: string;
            size?: number;
        }>;
    };
    createdAt: Date;
    updatedAt: Date;
}

const NotificationSchema = new Schema<INotification>(
    {
        tenantId: { type: String, required: true, index: true },
        type: {
            type: String,
            enum: ['RFQ_VENDOR_REPLY', 'RFQ_VENDOR_MESSAGE_SENT', 'AR_CUSTOMER_REPLY', 'AR_CUSTOMER_MESSAGE_SENT'],
            required: true,
        },
        title: { type: String, required: true },
        message: { type: String, required: true },
        href: { type: String },
        isRead: { type: Boolean, default: false, index: true },
        metadata: {
            rfqId: { type: String },
            rfqNumber: { type: String },
            arInvoiceId: { type: String },
            arInvoiceNo: { type: String },
            emailReplyId: { type: String },
            vendorId: { type: String },
            vendorName: { type: String },
            customerId: { type: String },
            customerName: { type: String },
            subject: { type: String },
            fromEmail: { type: String },
            fromName: { type: String },
            toEmail: { type: String },
            toName: { type: String },
            direction: { type: String, enum: ['INBOUND', 'OUTBOUND'] },
            attachmentCount: { type: Number, default: 0 },
            bodySnippet: { type: String },
            attachments: {
                type: [
                    new Schema(
                        {
                            filename: { type: String, required: true },
                            originalFilename: { type: String, required: true },
                            url: { type: String, required: true },
                            contentType: { type: String },
                            size: { type: Number },
                        },
                        { _id: false }
                    ),
                ],
                default: undefined,
            },
        },
    },
    { timestamps: true, collection: 'notifications' }
);

NotificationSchema.index({ tenantId: 1, isRead: 1, createdAt: -1 });
NotificationSchema.index({ tenantId: 1, type: 1, createdAt: -1 });

NotificationSchema.set('toObject', { virtuals: true });
NotificationSchema.set('toJSON', { virtuals: true });

export const Notification = mongoose.model<INotification>('Notification', NotificationSchema);

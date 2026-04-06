import mongoose, { Schema, Document } from 'mongoose';

export interface INotification extends Document {
    tenantId: string;
    type: 'RFQ_VENDOR_REPLY';
    title: string;
    message: string;
    href?: string;
    isRead: boolean;
    metadata?: {
        rfqId?: string;
        rfqNumber?: string;
        emailReplyId?: string;
        vendorId?: string;
        vendorName?: string;
        attachmentCount?: number;
    };
    createdAt: Date;
    updatedAt: Date;
}

const NotificationSchema = new Schema<INotification>(
    {
        tenantId: { type: String, required: true, index: true },
        type: {
            type: String,
            enum: ['RFQ_VENDOR_REPLY'],
            required: true,
        },
        title: { type: String, required: true },
        message: { type: String, required: true },
        href: { type: String },
        isRead: { type: Boolean, default: false, index: true },
        metadata: {
            rfqId: { type: String },
            rfqNumber: { type: String },
            emailReplyId: { type: String },
            vendorId: { type: String },
            vendorName: { type: String },
            attachmentCount: { type: Number, default: 0 },
        },
    },
    { timestamps: true, collection: 'notifications' }
);

NotificationSchema.index({ tenantId: 1, isRead: 1, createdAt: -1 });
NotificationSchema.index({ tenantId: 1, type: 1, createdAt: -1 });

NotificationSchema.set('toObject', { virtuals: true });
NotificationSchema.set('toJSON', { virtuals: true });

export const Notification = mongoose.model<INotification>('Notification', NotificationSchema);

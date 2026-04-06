import mongoose, { Document, Schema, Types } from 'mongoose';

export interface ISystemConfig extends Document {
    tenantId: string;
    companyName?: string;
    companyLogo?: string;
    documentBranding?: {
        primaryColor?: string;
        accentColor?: string;
        pdfFont?: 'Helvetica' | 'Times' | 'Courier';
    };
    emailSettings?: {
        senderName?: string;
        senderEmail?: string;
        replyToEmail?: string;
        smtpHost?: string;
        smtpPort?: number;
        smtpSecure?: boolean;
        smtpUsername?: string;
        smtpPassword?: string;
        inboundEnabled?: boolean;
        imapHost?: string;
        imapPort?: number;
        imapSecure?: boolean;
        imapUsername?: string;
        imapPassword?: string;
        imapFolder?: string;
        lastInboxSyncAt?: Date;
    };
    address?: {
        country?: string;
        city?: string;
        street?: string;
        postalCode?: string;
    };
    phone?: string;
    email?: string;
    taxNumber?: string;
    currency: string;
    dateFormat: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
    defaultAccounts: {
        accountsPayable?: Types.ObjectId;
        accountsReceivable?: Types.ObjectId;
        inventoryAsset?: Types.ObjectId;
        grniLiability?: Types.ObjectId;
        cashAccount?: Types.ObjectId;
        bankAccount?: Types.ObjectId;
        vatPayable?: Types.ObjectId;
        vatReceivable?: Types.ObjectId;
        inventoryAdjustment?: Types.ObjectId;
        cogsAccount?: Types.ObjectId;
        retainedEarnings?: Types.ObjectId;
    };
    paymentTermsOptions: string[];
    vatRate: number;
    createdAt: Date;
    updatedAt: Date;
}

const SystemConfigSchema = new Schema<ISystemConfig>(
    {
        tenantId: { type: String, required: true, unique: true, index: true },
        companyName: { type: String },
        companyLogo: { type: String },
        documentBranding: {
            primaryColor: { type: String, default: '#1f3b68' },
            accentColor: { type: String, default: '#0ea5e9' },
            pdfFont: {
                type: String,
                enum: ['Helvetica', 'Times', 'Courier'],
                default: 'Helvetica',
            },
        },
        emailSettings: {
            senderName: { type: String },
            senderEmail: { type: String },
            replyToEmail: { type: String },
            smtpHost: { type: String },
            smtpPort: { type: Number, default: 587 },
            smtpSecure: { type: Boolean, default: false },
            smtpUsername: { type: String },
            smtpPassword: { type: String },
            inboundEnabled: { type: Boolean, default: false },
            imapHost: { type: String },
            imapPort: { type: Number, default: 993 },
            imapSecure: { type: Boolean, default: true },
            imapUsername: { type: String },
            imapPassword: { type: String },
            imapFolder: { type: String, default: 'INBOX' },
            lastInboxSyncAt: { type: Date },
        },
        address: {
            country: { type: String },
            city: { type: String },
            street: { type: String },
            postalCode: { type: String },
        },
        phone: { type: String },
        email: { type: String },
        taxNumber: { type: String },
        currency: { type: String, default: 'USD' },
        dateFormat: {
            type: String,
            enum: ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'],
            default: 'YYYY-MM-DD',
        },
        defaultAccounts: {
            accountsPayable: { type: Schema.Types.ObjectId, ref: 'ChartOfAccount' },
            accountsReceivable: { type: Schema.Types.ObjectId, ref: 'ChartOfAccount' },
            inventoryAsset: { type: Schema.Types.ObjectId, ref: 'ChartOfAccount' },
            grniLiability: { type: Schema.Types.ObjectId, ref: 'ChartOfAccount' },
            cashAccount: { type: Schema.Types.ObjectId, ref: 'ChartOfAccount' },
            bankAccount: { type: Schema.Types.ObjectId, ref: 'ChartOfAccount' },
            vatPayable: { type: Schema.Types.ObjectId, ref: 'ChartOfAccount' },
            vatReceivable: { type: Schema.Types.ObjectId, ref: 'ChartOfAccount' },
            inventoryAdjustment: { type: Schema.Types.ObjectId, ref: 'ChartOfAccount' },
            cogsAccount: { type: Schema.Types.ObjectId, ref: 'ChartOfAccount' },
            retainedEarnings: { type: Schema.Types.ObjectId, ref: 'ChartOfAccount' },
        },
        paymentTermsOptions: {
            type: [String],
            default: ['COD', 'Net 15', 'Net 30', 'Net 60'],
        },
        vatRate: { type: Number, default: 0, min: 0, max: 100 },
    },
    { timestamps: true, collection: 'system_config' }
);

export const SystemConfig = mongoose.model<ISystemConfig>('SystemConfig', SystemConfigSchema);

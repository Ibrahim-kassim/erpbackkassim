import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IDashboardArtifact extends Document {
    tenantId: string;
    sessionId: Types.ObjectId;
    kind: 'PDF' | 'CSV';
    title: string;
    fileName: string;
    mimeType: string;
    dataBase64: string;
    preview?: any;
    createdAt: Date;
    updatedAt: Date;
}

const DashboardArtifactSchema = new Schema<IDashboardArtifact>(
    {
        tenantId: { type: String, required: true, index: true },
        sessionId: { type: Schema.Types.ObjectId, ref: 'DashboardChatSession', required: true, index: true },
        kind: { type: String, enum: ['PDF', 'CSV'], required: true },
        title: { type: String, required: true },
        fileName: { type: String, required: true },
        mimeType: { type: String, required: true },
        dataBase64: { type: String, required: true },
        preview: { type: Schema.Types.Mixed },
    },
    { timestamps: true, collection: 'dashboard_artifacts' }
);

DashboardArtifactSchema.index({ tenantId: 1, createdAt: -1 });

export const DashboardArtifact = mongoose.model<IDashboardArtifact>(
    'DashboardArtifact',
    DashboardArtifactSchema
);

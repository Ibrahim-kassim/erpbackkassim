import mongoose, { Document, Schema } from 'mongoose';

export interface IDashboardChatSession extends Document {
    tenantId: string;
    userId: string;
    title: string;
    turns: any[];
    pendingAction?: any;
    lastIntent?: string;
    conversationSummary?: string;
    workflowState?: any;
    workflowStack?: any[];
    activeWorkflowId?: string | null;
    workingState?: any;
    createdAt: Date;
    updatedAt: Date;
}

const DashboardChatSessionSchema = new Schema<IDashboardChatSession>(
    {
        tenantId: { type: String, required: true, index: true },
        userId: { type: String, required: true, index: true },
        title: { type: String, default: 'Dashboard Copilot Session' },
        turns: { type: [Schema.Types.Mixed as any], default: [] },
        pendingAction: { type: Schema.Types.Mixed, default: null },
        lastIntent: { type: String },
        conversationSummary: { type: String, default: '' },
        workflowState: { type: Schema.Types.Mixed, default: null },
        workflowStack: { type: [Schema.Types.Mixed as any], default: [] },
        activeWorkflowId: { type: String, default: null },
        workingState: { type: Schema.Types.Mixed, default: null },
    },
    { timestamps: true, collection: 'dashboard_chat_sessions' }
);

DashboardChatSessionSchema.index({ tenantId: 1, userId: 1, updatedAt: -1 });

export const DashboardChatSession = mongoose.model<IDashboardChatSession>(
    'DashboardChatSession',
    DashboardChatSessionSchema
);

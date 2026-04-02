import { z } from 'zod';

const chatId = z.string().min(1);

export const createDashboardChatSessionSchema = z.object({
    sessionId: z.string().optional(),
});

export const dashboardChatMessageSchema = z.object({
    sessionId: chatId,
    message: z.string().min(1, 'Message is required'),
});

const formTypeSchema = z.enum([
    'CREATE_CATEGORY',
    'CREATE_UOM',
    'CREATE_RFQ',
    'CREATE_AR_INVOICE',
    'CREATE_PURCHASE_ORDER',
    'CREATE_GRN',
    'CREATE_AP_INVOICE',
    'CREATE_AR_RECEIPT',
    'CREATE_AP_PAYMENT',
    'CREATE_CHART_ACCOUNT',
    'CREATE_FISCAL_YEAR',
    'CREATE_BUSINESS_PARTNER',
    'CREATE_PRODUCT',
]);

const executionModeSchema = z.enum([
    'SAVE',
    'CREATE_AND_SEND',
    'CREATE_AND_APPROVE',
    'CREATE_AND_CONFIRM',
    'CREATE_AND_POST',
]);

export const dashboardChatActionSchema = z.discriminatedUnion('actionType', [
    z.object({
        sessionId: chatId,
        actionType: z.literal('submit_form'),
        formType: formTypeSchema,
        values: z.record(z.any()),
        executionMode: executionModeSchema.optional(),
    }),
    z.object({
        sessionId: chatId,
        actionType: z.literal('confirm_execution'),
        workflowId: chatId.optional(),
    }),
    z.object({
        sessionId: chatId,
        actionType: z.literal('resume_workflow'),
        workflowId: chatId.optional(),
    }),
    z.object({
        sessionId: chatId,
        actionType: z.literal('cancel_workflow'),
        workflowId: chatId.optional(),
    }),
]);

export type DashboardChatMessageDTO = z.infer<typeof dashboardChatMessageSchema>;
export type DashboardChatActionDTO = z.infer<typeof dashboardChatActionSchema>;

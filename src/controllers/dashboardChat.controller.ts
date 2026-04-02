import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import {
    createDashboardChatSessionSchema,
    dashboardChatActionSchema,
    dashboardChatMessageSchema,
} from '../validators/dashboardChat.schema';
import * as service from '../services/dashboardChat.service';

export const dashboardChatController = {
    listSessions: asyncHandler(async (req: Request, res: Response) => {
        const data = await service.listDashboardChatSessions(req.tenantId!, req.userId || 'dev_user');
        res.status(200).json({ data });
    }),

    createSession: asyncHandler(async (req: Request, res: Response) => {
        const validation = createDashboardChatSessionSchema.safeParse(req.body || {});
        if (!validation.success) {
            res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid chat session payload', details: validation.error.format() });
            return;
        }

        const data = await service.createOrResumeDashboardChatSession(
            req.tenantId!,
            req.userId || 'dev_user',
            validation.data.sessionId
        );
        res.status(200).json({ data });
    }),

    getSession: asyncHandler(async (req: Request, res: Response) => {
        const data = await service.getDashboardChatSession(req.tenantId!, req.userId || 'dev_user', req.params.id);
        res.status(200).json({ data });
    }),

    message: asyncHandler(async (req: Request, res: Response) => {
        const validation = dashboardChatMessageSchema.safeParse(req.body);
        if (!validation.success) {
            res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid chat message payload', details: validation.error.format() });
            return;
        }

        const data = await service.sendDashboardChatMessage(req.tenantId!, req.userId || 'dev_user', validation.data);
        res.status(200).json({ data });
    }),

    action: asyncHandler(async (req: Request, res: Response) => {
        const validation = dashboardChatActionSchema.safeParse(req.body);
        if (!validation.success) {
            res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid chat action payload', details: validation.error.format() });
            return;
        }

        const data = await service.submitDashboardChatAction(req.tenantId!, req.userId || 'dev_user', validation.data);
        res.status(200).json({ data });
    }),

    downloadArtifact: asyncHandler(async (req: Request, res: Response) => {
        const artifact = await service.downloadDashboardArtifact(req.tenantId!, req.userId || 'dev_user', req.params.artifactId);
        res.setHeader('Content-Type', artifact.mimeType);
        res.setHeader('Content-Disposition', `attachment; filename="${artifact.fileName}"`);
        res.status(200).send(artifact.buffer);
    }),
};

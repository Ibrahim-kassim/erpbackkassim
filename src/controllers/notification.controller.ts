import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import * as notificationService from '../services/notification.service';
import { syncTenantMailbox } from '../services/mailInbox.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
    const limit = Number(req.query.limit || 12);
    const data = await notificationService.listNotifications(req.tenantId!, limit);
    res.status(200).json({ data });
});

export const markRead = asyncHandler(async (req: Request, res: Response) => {
    const data = await notificationService.markNotificationRead(req.tenantId!, req.params.id);
    res.status(200).json({ data });
});

export const markAllRead = asyncHandler(async (req: Request, res: Response) => {
    const data = await notificationService.markAllNotificationsRead(req.tenantId!);
    res.status(200).json({ data });
});

export const syncMailbox = asyncHandler(async (req: Request, res: Response) => {
    const data = await syncTenantMailbox(req.tenantId!);
    res.status(200).json({ data });
});

export const listRFQThread = asyncHandler(async (req: Request, res: Response) => {
    const limit = Number(req.query.limit || 200);
    const data = await notificationService.listRFQThreadNotifications(req.tenantId!, req.params.rfqId, limit);
    res.status(200).json({ data });
});

export const listARInvoiceThread = asyncHandler(async (req: Request, res: Response) => {
    const limit = Number(req.query.limit || 200);
    const data = await notificationService.listARInvoiceThreadNotifications(req.tenantId!, req.params.arInvoiceId, limit);
    res.status(200).json({ data });
});

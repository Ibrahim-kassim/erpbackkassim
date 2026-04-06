import { Notification } from '../models/notification.model';

class ServiceError extends Error {
    constructor(message: string, public code: string = 'VALIDATION_ERROR') {
        super(message);
        this.name = 'ServiceError';
    }
}

export const listNotifications = async (tenantId: string, limit = 12) => {
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const [items, unreadCount] = await Promise.all([
        Notification.find({ tenantId }).sort({ createdAt: -1 }).limit(safeLimit).lean(),
        Notification.countDocuments({ tenantId, isRead: false }),
    ]);

    return {
        items,
        unreadCount,
    };
};

export const markNotificationRead = async (tenantId: string, id: string) => {
    const notification = await Notification.findOneAndUpdate(
        { _id: id, tenantId },
        { $set: { isRead: true } },
        { new: true }
    );

    if (!notification) {
        throw new ServiceError('Notification not found', 'NOT_FOUND');
    }

    return notification;
};

export const markAllNotificationsRead = async (tenantId: string) => {
    await Notification.updateMany({ tenantId, isRead: false }, { $set: { isRead: true } });
    return { success: true };
};

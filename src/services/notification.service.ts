import { Notification } from '../models/notification.model';
import { RFQEmailReply } from '../models/rfqEmailReply.model';

const buildBodySnippet = (value: string) =>
    String(value || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 240);

const stripQuotedEmail = (value: string) => {
    const text = String(value || '').replace(/\r\n/g, '\n');
    const lines = text.split('\n');
    const kept: string[] = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
            kept.push('');
            continue;
        }

        if (trimmed.startsWith('>')) break;
        if (/^On .+ wrote:$/i.test(trimmed)) break;
        if (/^From:\s/i.test(trimmed)) break;
        if (/^Sent:\s/i.test(trimmed)) break;
        if (/^To:\s/i.test(trimmed)) break;
        if (/^Subject:\s/i.test(trimmed)) break;

        kept.push(line);
    }

    return kept.join('\n').trim();
};

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

    await enrichNotificationReplies(tenantId, items);

    return {
        items,
        unreadCount,
    };
};

const enrichNotificationReplies = async (tenantId: string, items: any[]) => {
    const replyIds = items
        .map((item) => item.metadata?.emailReplyId)
        .filter((id): id is string => Boolean(id));

    if (!replyIds.length) return;

    const replies = await RFQEmailReply.find({ tenantId, _id: { $in: replyIds } })
        .select('_id bodyText attachments subject fromEmail fromName toEmail toName receivedAt direction')
        .lean();
    const replyMap = new Map(replies.map((reply) => [String(reply._id), reply]));

    for (const item of items) {
        const replyId = item.metadata?.emailReplyId;
        if (!replyId) continue;
        const reply = replyMap.get(String(replyId));
        if (!reply) continue;

        const snippet = buildBodySnippet(stripQuotedEmail(reply.bodyText || ''));
        const hasLegacyMessage = typeof item.message === 'string' && /replied to RFQ-/i.test(item.message);
        if (!item.message || hasLegacyMessage) {
            item.message = snippet || item.message;
        }

        item.metadata = {
            ...(item.metadata || {}),
            bodySnippet: snippet || item.metadata?.bodySnippet,
            attachmentCount: Array.isArray(reply.attachments) ? reply.attachments.length : item.metadata?.attachmentCount,
            attachments: Array.isArray(reply.attachments) && reply.attachments.length ? reply.attachments : item.metadata?.attachments,
            subject: item.metadata?.subject || reply.subject,
            fromEmail: item.metadata?.fromEmail || reply.fromEmail,
            fromName: item.metadata?.fromName || reply.fromName,
            toEmail: item.metadata?.toEmail || reply.toEmail,
            toName: item.metadata?.toName || reply.toName,
            direction: item.metadata?.direction || reply.direction,
            receivedAt: item.metadata?.receivedAt || reply.receivedAt,
        };
    }
};

export const listRFQThreadNotifications = async (tenantId: string, rfqId: string, limit = 200) => {
    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const items = await Notification.find({
        tenantId,
        type: { $in: ['RFQ_VENDOR_REPLY', 'RFQ_VENDOR_MESSAGE_SENT'] },
        'metadata.rfqId': rfqId,
    })
        .sort({ createdAt: 1 })
        .limit(safeLimit)
        .lean();

    await enrichNotificationReplies(tenantId, items);

    return { items };
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

import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { Types } from 'mongoose';
import { SystemConfig, type ISystemConfig } from '../models/systemConfig.model';
import { RFQ } from '../models/rfq.model';
import { ARInvoice } from '../models/arInvoice.model';
import { BusinessPartner } from '../models/businessPartner.model';
import { Notification } from '../models/notification.model';
import { RFQEmailReply, type IRFQEmailReplyAttachment } from '../models/rfqEmailReply.model';

class ServiceError extends Error {
    constructor(message: string, public code: string = 'VALIDATION_ERROR') {
        super(message);
        this.name = 'ServiceError';
    }
}

type SyncSummary = {
    processed: number;
    imported: number;
    skipped: number;
    unmatched: number;
};

const activeSyncTenants = new Set<string>();
const uploadsRoot = path.join(process.cwd(), 'uploads', 'email-replies');
const rfqTokenRegex = /ERP-RFQ:([A-Z0-9-]+)/i;
const rfqNumberRegex = /\bRFQ-\d{4}-\d{3}\b/i;
const arInvoiceTokenRegex = /ERP-ARINV:([A-Z0-9-]+)/i;
const arInvoiceNumberRegex = /\bARINV-\d{6}\b/i;
const RECENT_SYNC_LOOKBACK_DAYS = 14;
const RECENT_SYNC_MAX_MESSAGES = 50;
const VENDOR_FALLBACK_LOOKBACK_DAYS = 30;

const normalizeEmail = (value: string | undefined | null) => String(value || '').trim().toLowerCase();
const normalizeHost = (value: string | undefined | null) => String(value || '').trim().toLowerCase();

const inferImapHostFromSmtp = (smtpHost: string) => {
    const normalized = normalizeHost(smtpHost);
    if (normalized === 'smtp.gmail.com') return 'imap.gmail.com';
    if (normalized === 'smtp.office365.com' || normalized === 'smtp-mail.outlook.com') return 'outlook.office365.com';
    if (normalized.startsWith('smtp.')) return normalized.replace(/^smtp\./, 'imap.');
    return '';
};

const getCandidateFolders = (imapHost: string, primaryFolder: string) => {
    const folders = [primaryFolder || 'INBOX'];
    const normalizedHost = normalizeHost(imapHost);

    if (normalizedHost === 'imap.gmail.com') {
        folders.push('[Gmail]/All Mail', '[Google Mail]/All Mail');
    }

    return Array.from(new Set(folders.filter(Boolean)));
};

const sanitizeFileName = (value: string) =>
    value
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120) || 'attachment';

const extractRFQNumber = (value: string) => {
    const fromToken = value.match(rfqTokenRegex)?.[1];
    if (fromToken) return fromToken.toUpperCase();
    return value.match(rfqNumberRegex)?.[0]?.toUpperCase() || null;
};

const extractARInvoiceNo = (value: string) => {
    const fromToken = value.match(arInvoiceTokenRegex)?.[1];
    if (fromToken) return fromToken.toUpperCase();
    return value.match(arInvoiceNumberRegex)?.[0]?.toUpperCase() || null;
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getIncomingSettings = (config: Pick<ISystemConfig, 'emailSettings' | 'email'> | null) => {
    const settings = config?.emailSettings;
    if (!config) return null;

    const inboundExplicitlyDisabled = settings?.inboundEnabled === false;
    if (inboundExplicitlyDisabled) return null;

    const smtpHost = settings?.smtpHost;
    const smtpUsername = settings?.smtpUsername;
    const smtpPassword = settings?.smtpPassword;
    const senderEmail = settings?.senderEmail || config.email;

    const imapHost = settings?.imapHost || inferImapHostFromSmtp(smtpHost || '');
    const imapPort = settings?.imapPort || 993;
    const imapSecure = settings?.imapSecure !== false;
    const imapUsername = settings?.imapUsername || smtpUsername || senderEmail;
    const imapPassword = settings?.imapPassword || smtpPassword;
    const imapFolder = settings?.imapFolder || 'INBOX';

    const inboundEnabled =
        settings?.inboundEnabled === true ||
        (!settings?.inboundEnabled && Boolean(imapHost && imapUsername && imapPassword));

    if (!inboundEnabled) return null;

    if (!imapHost || !imapUsername || !imapPassword) {
        throw new ServiceError('Complete the IMAP host, username, and password in Settings before syncing vendor replies.');
    }

    return {
        imapHost,
        imapPort,
        imapSecure,
        imapUsername,
        imapPassword,
        imapFolder,
    };
};

const saveAttachments = async (
    tenantId: string,
    attachments: Array<{ filename?: string | null; contentType?: string; content?: Buffer }>
) => {
    const tenantDir = path.join(uploadsRoot, tenantId);
    await fs.mkdir(tenantDir, { recursive: true });

    const saved: IRFQEmailReplyAttachment[] = [];

    for (const attachment of attachments) {
        if (!attachment.content) continue;

        const originalFilename = sanitizeFileName(attachment.filename || 'attachment');
        const filename = `${Date.now()}-${randomUUID()}-${originalFilename}`;
        const absolutePath = path.join(tenantDir, filename);
        await fs.writeFile(absolutePath, attachment.content);

        saved.push({
            filename,
            originalFilename,
            url: `/uploads/email-replies/${tenantId}/${filename}`,
            contentType: attachment.contentType,
            size: attachment.content.length,
        });
    }

    return saved;
};

const buildNotificationMessage = (vendorName: string, rfqNumber: string, attachmentCount: number) => {
    if (attachmentCount > 0) {
        return `${vendorName} replied to ${rfqNumber} and attached ${attachmentCount} file${attachmentCount === 1 ? '' : 's'}.`;
    }
    return `${vendorName} replied to ${rfqNumber}.`;
};

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

        // Common Gmail quote markers.
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

export const syncTenantMailbox = async (tenantId: string): Promise<SyncSummary> => {
    if (activeSyncTenants.has(tenantId)) {
        return { processed: 0, imported: 0, skipped: 0, unmatched: 0 };
    }

    activeSyncTenants.add(tenantId);
    const summary: SyncSummary = { processed: 0, imported: 0, skipped: 0, unmatched: 0 };

    try {
        const config = await SystemConfig.findOne({ tenantId })
            .select('emailSettings email')
            .lean<Pick<ISystemConfig, 'emailSettings' | 'email'>>();
        const incoming = getIncomingSettings(config);
        if (!incoming) {
            return summary;
        }
        const ownMailboxEmails = new Set(
            [
                normalizeEmail(incoming.imapUsername),
                normalizeEmail(config?.emailSettings?.senderEmail),
                normalizeEmail(config?.email),
            ].filter(Boolean),
        );

        const client = new ImapFlow({
            host: incoming.imapHost,
            port: incoming.imapPort,
            secure: incoming.imapSecure,
            auth: {
                user: incoming.imapUsername,
                pass: incoming.imapPassword,
            },
        });

        await client.connect();
        try {
            const folders = getCandidateFolders(incoming.imapHost, incoming.imapFolder);

            for (const folder of folders) {
                try {
                    await client.mailboxOpen(folder);
                } catch {
                    continue;
                }

                // Incremental sync: only scan a small recent window. This avoids expensive "scan all unseen" behavior.
                // Keep a small overlap to avoid missing messages due to timezone/clock quirks.
                const lookbackStart = config?.emailSettings?.lastInboxSyncAt
                    ? new Date(new Date(config.emailSettings.lastInboxSyncAt).getTime() - 12 * 60 * 60 * 1000)
                    : (() => {
                        const fallback = new Date();
                        fallback.setDate(fallback.getDate() - Math.min(RECENT_SYNC_LOOKBACK_DAYS, 2));
                        return fallback;
                    })();

                const recentMessages = (await client.search({ since: lookbackStart }, { uid: true })) || [];
                const candidateUids = Array.from(new Set(recentMessages.slice(-RECENT_SYNC_MAX_MESSAGES))).sort(
                    (left, right) => left - right,
                );

                for (const uid of candidateUids) {
                    const message = await client.fetchOne(
                        uid,
                        {
                            uid: true,
                            source: true,
                            envelope: true,
                            internalDate: true,
                        },
                        { uid: true }
                    );

                    if (!message || !message.source) {
                        summary.skipped += 1;
                        continue;
                    }

                    summary.processed += 1;

                    const parsed = await simpleParser(message.source as Buffer);
                    const messageId = parsed.messageId || `imap-${tenantId}-${folder}-${uid}`;

                    const existing = await RFQEmailReply.findOne({ tenantId, messageId }).select('_id').lean();
                    if (existing) {
                        summary.skipped += 1;
                        continue;
                    }

                    const subject = parsed.subject || message.envelope?.subject || '';
                    const bodyText = parsed.text?.trim() || parsed.html || '';
                    const rfqNumber = extractRFQNumber(subject) || extractRFQNumber(bodyText);
                    const arInvoiceNo = extractARInvoiceNo(subject) || extractARInvoiceNo(bodyText);
                    const fromEmail = normalizeEmail(parsed.from?.value?.[0]?.address || message.envelope?.from?.[0]?.address);
                    const fromName = parsed.from?.value?.[0]?.name || undefined;

                    if (!fromEmail) {
                        summary.unmatched += 1;
                        continue;
                    }

                    if (ownMailboxEmails.has(fromEmail)) {
                        summary.skipped += 1;
                        continue;
                    }

                    const vendor = await BusinessPartner.findOne({
                            tenantId,
                            isDeleted: false,
                            roles: 'VENDOR',
                            email: { $regex: `^${escapeRegex(fromEmail)}$`, $options: 'i' },
                        }).select('_id name email');
                    const customer = await BusinessPartner.findOne({
                        tenantId,
                        isDeleted: false,
                        roles: 'CUSTOMER',
                        email: { $regex: `^${escapeRegex(fromEmail)}$`, $options: 'i' },
                    }).select('_id name email');

                    let rfq = rfqNumber
                        ? await RFQ.findOne({ tenantId, rfqNumber, isDeleted: false }).select('_id rfqNumber title vendorIds')
                        : null;
                    const arInvoice = arInvoiceNo
                        ? await ARInvoice.findOne({ tenantId, invoiceNo: arInvoiceNo, isDeleted: false }).select('_id invoiceNo customerId customerName')
                        : null;

                    if (!rfq && vendor) {
                        const fallbackStart = new Date();
                        fallbackStart.setDate(fallbackStart.getDate() - VENDOR_FALLBACK_LOOKBACK_DAYS);

                        const vendorRfqs = await RFQ.find({
                            tenantId,
                            isDeleted: false,
                            status: 'SENT',
                            vendorIds: vendor._id,
                            updatedAt: { $gte: fallbackStart },
                        })
                            .select('_id rfqNumber title vendorIds updatedAt')
                            .sort({ updatedAt: -1 })
                            .limit(2);

                        if (vendorRfqs.length === 1) {
                            rfq = vendorRfqs[0];
                        }
                    }

                    if (!rfq && !arInvoice) {
                        summary.unmatched += 1;
                        continue;
                    }

                    if (rfq && vendor && !rfq.vendorIds.some((vendorId) => vendorId.equals(vendor._id as Types.ObjectId))) {
                        summary.unmatched += 1;
                        continue;
                    }

                    if (arInvoice && customer && !arInvoice.customerId.equals(customer._id as Types.ObjectId)) {
                        summary.unmatched += 1;
                        continue;
                    }

                    const attachments = await saveAttachments(
                        tenantId,
                        parsed.attachments.map((attachment: { filename?: string | null; contentType?: string; content?: Buffer }) => ({
                            filename: attachment.filename,
                            contentType: attachment.contentType,
                            content: attachment.content,
                        }))
                    );

                    const reply = await RFQEmailReply.create({
                        tenantId,
                        rfqId: rfq?._id,
                        arInvoiceId: arInvoice?._id,
                        vendorId: vendor?._id,
                        customerId: customer?._id,
                        direction: 'INBOUND',
                        messageId,
                        subject,
                        fromEmail,
                        fromName,
                        bodyText: parsed.text?.trim() || '',
                        attachments,
                        receivedAt: parsed.date || message.internalDate || new Date(),
                    });

                    const bodySnippet = buildBodySnippet(stripQuotedEmail(reply.bodyText || ''));

                    if (rfq) {
                        await Notification.create({
                            tenantId,
                            type: 'RFQ_VENDOR_REPLY',
                            title: `Vendor reply received for ${rfq.rfqNumber}`,
                            message: bodySnippet || buildNotificationMessage(vendor?.name || fromName || fromEmail, rfq.rfqNumber, attachments.length),
                            href: `/rfqs/${rfq._id}`,
                            metadata: {
                                rfqId: rfq._id.toString(),
                                rfqNumber: rfq.rfqNumber,
                                emailReplyId: reply._id.toString(),
                                vendorId: vendor?._id?.toString(),
                                vendorName: vendor?.name || fromName || fromEmail,
                                subject,
                                fromEmail,
                                fromName,
                                direction: 'INBOUND',
                                attachmentCount: attachments.length,
                                bodySnippet: bodySnippet || undefined,
                                attachments: attachments.length ? attachments : undefined,
                            },
                            createdAt: parsed.date || message.internalDate || new Date(),
                            updatedAt: parsed.date || message.internalDate || new Date(),
                        });
                    } else if (arInvoice) {
                        await Notification.create({
                            tenantId,
                            type: 'AR_CUSTOMER_REPLY',
                            title: `Customer reply received for ${arInvoice.invoiceNo}`,
                            message: bodySnippet || `${customer?.name || fromName || fromEmail} replied to ${arInvoice.invoiceNo}.`,
                            href: `/receivables/invoices/${arInvoice._id}`,
                            metadata: {
                                arInvoiceId: arInvoice._id.toString(),
                                arInvoiceNo: arInvoice.invoiceNo,
                                emailReplyId: reply._id.toString(),
                                customerId: customer?._id?.toString() || arInvoice.customerId.toString(),
                                customerName: customer?.name || arInvoice.customerName || fromName || fromEmail,
                                subject,
                                fromEmail,
                                fromName,
                                direction: 'INBOUND',
                                attachmentCount: attachments.length,
                                bodySnippet: bodySnippet || undefined,
                                attachments: attachments.length ? attachments : undefined,
                            },
                            createdAt: parsed.date || message.internalDate || new Date(),
                            updatedAt: parsed.date || message.internalDate || new Date(),
                        });
                    }

                    await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
                    summary.imported += 1;
                }
            }

            await SystemConfig.updateOne(
                { tenantId },
                { $set: { 'emailSettings.lastInboxSyncAt': new Date() } },
            );
        } finally {
            await client.logout();
        }

        return summary;
    } finally {
        activeSyncTenants.delete(tenantId);
    }
};

export const syncAllTenantMailboxes = async () => {
    const configs = await SystemConfig.find({ 'emailSettings.inboundEnabled': true }).select('tenantId');
    for (const config of configs) {
        try {
            await syncTenantMailbox(config.tenantId);
        } catch (error) {
            console.error('[Mail Sync]', config.tenantId, error);
        }
    }
};

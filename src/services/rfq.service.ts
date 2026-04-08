import { RFQ, IRFQ } from '../models/rfq.model';
import { BusinessPartner } from '../models/businessPartner.model';
import { Counter } from '../models/counter.model';
import { SystemConfig } from '../models/systemConfig.model';
import { RFQEmailReply } from '../models/rfqEmailReply.model';
import { Notification } from '../models/notification.model';
import { sendConfiguredMail } from './mail.service';
import { randomUUID } from 'crypto';
import { CreateRFQDTO, SendRFQEmailDTO, SendRFQVendorMessageDTO, UpdateRFQDTO } from '../validators/rfq.schema';

class ServiceError extends Error {
    code: string;
    details?: any;

    constructor(message: string, code: string = 'VALIDATION_ERROR', details?: any) {
        super(message);
        this.code = code;
        this.details = details;
    }
}

// Generate RFQ number in format: RFQ-YYYY-XXX
const generateRFQNumber = async (tenantId: string): Promise<string> => {
    const currentYear = new Date().getFullYear();
    const key = `RFQ-${currentYear}`;

    const counter = await Counter.findOneAndUpdate(
        { tenantId, key },
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
    );

    return `RFQ-${currentYear}-${counter.seq.toString().padStart(3, '0')}`;
};

// Validate that all vendors exist, have VENDOR role, and belong to same tenant
const validateVendors = async (vendorIds: string[], tenantId: string): Promise<void> => {
    if (!vendorIds || vendorIds.length === 0) {
        throw new ServiceError('At least one vendor is required', 'VALIDATION_ERROR');
    }

    const vendors = await BusinessPartner.find({
        _id: { $in: vendorIds },
        tenantId,
        isDeleted: false
    });

    if (vendors.length !== vendorIds.length) {
        throw new ServiceError('One or more vendors not found', 'NOT_FOUND');
    }

    const invalidVendors = vendors.filter(v => !v.roles.includes('VENDOR'));
    if (invalidVendors.length > 0) {
        throw new ServiceError(
            'All business partners must have VENDOR role',
            'VALIDATION_ERROR',
            { invalidVendors: invalidVendors.map(v => v.code) }
        );
    }
};

export const createRFQ = async (dto: CreateRFQDTO, tenantId: string): Promise<IRFQ> => {
    // Validate vendors
    await validateVendors(dto.vendorIds, tenantId);

    // Generate RFQ number
    const rfqNumber = await generateRFQNumber(tenantId);

    // Create RFQ
    const rfq = new RFQ({
        ...dto,
        rfqNumber,
        tenantId,
        status: dto.status || 'DRAFT'
    });

    return await rfq.save();
};

export const updateRFQ = async (id: string, dto: UpdateRFQDTO, tenantId: string): Promise<IRFQ> => {
    const rfq = await RFQ.findOne({ _id: id, tenantId, isDeleted: false });
    if (!rfq) {
        throw new ServiceError('RFQ not found', 'NOT_FOUND');
    }

    // Only DRAFT RFQs can be edited
    if (rfq.status !== 'DRAFT') {
        throw new ServiceError(`Cannot edit RFQ in ${rfq.status} status. Only DRAFT RFQs can be modified.`, 'INVALID_STATUS');
    }

    // If vendorIds are being updated, validate them
    if (dto.vendorIds) {
        await validateVendors(dto.vendorIds, tenantId);
    }

    // Update fields
    Object.assign(rfq, dto);
    return await rfq.save();
};

export const getRFQList = async (query: any, tenantId: string): Promise<{ data: IRFQ[], meta: any }> => {
    const filter: any = { tenantId, isDeleted: false };

    // Search by RFQ number or title
    if (query.search) {
        const regex = { $regex: query.search, $options: 'i' };
        filter.$or = [
            { rfqNumber: regex },
            { title: regex }
        ];
    }

    // Filter by status
    if (query.status && query.status !== 'ALL') {
        filter.status = query.status;
    }

    // Pagination
    const page = parseInt(query.page || '1');
    const limit = parseInt(query.limit || '20');
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
        RFQ.find(filter)
            .populate('vendorIds', 'code name')
            .populate('items.uomId', 'symbol')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        RFQ.countDocuments(filter)
    ]);

    return {
        data: data as IRFQ[],
        meta: {
            total,
            page,
            limit,
            pages: Math.ceil(total / limit)
        }
    };
};

export const getRFQById = async (id: string, tenantId: string): Promise<IRFQ> => {
    const rfq = await RFQ.findOne({ _id: id, tenantId, isDeleted: false })
        .populate('vendorIds', 'code name email phone')
        .populate('items.productId', 'code name')
        .populate('items.uomId', 'name symbol');

    if (!rfq) {
        throw new ServiceError('RFQ not found', 'NOT_FOUND');
    }

    return rfq;
};

export const getRFQEmailReplies = async (id: string, tenantId: string) => {
    const rfq = await RFQ.findOne({ _id: id, tenantId, isDeleted: false }).select('_id');
    if (!rfq) {
        throw new ServiceError('RFQ not found', 'NOT_FOUND');
    }

    return RFQEmailReply.find({ tenantId, rfqId: rfq._id })
        .populate('vendorId', 'code name email')
        .sort({ receivedAt: -1 })
        .lean();
};

export const sendRFQ = async (id: string, tenantId: string): Promise<IRFQ> => {
    const rfq = await RFQ.findOne({ _id: id, tenantId, isDeleted: false });
    if (!rfq) {
        throw new ServiceError('RFQ not found', 'NOT_FOUND');
    }

    // Only DRAFT can be sent
    if (rfq.status !== 'DRAFT') {
        throw new ServiceError(`Cannot send RFQ in ${rfq.status} status. Only DRAFT RFQs can be sent.`, 'INVALID_STATUS');
    }

    rfq.status = 'SENT';
    return await rfq.save();
};

export const sendRFQEmails = async (
    id: string,
    dto: SendRFQEmailDTO,
    tenantId: string,
): Promise<{
    rfq: IRFQ;
    summary: {
        sentCount: number;
        failedCount: number;
        failures: Array<{ vendorId: string; vendorName: string; email?: string; error: string }>;
    };
}> => {
    const [rfq, config] = await Promise.all([
        RFQ.findOne({ _id: id, tenantId, isDeleted: false }),
        SystemConfig.findOne({ tenantId }),
    ]);

    if (!rfq) {
        throw new ServiceError('RFQ not found', 'NOT_FOUND');
    }

    if (!config) {
        throw new ServiceError('Complete the company and email settings before sending RFQs.', 'VALIDATION_ERROR');
    }

    const vendors = await BusinessPartner.find({
        _id: { $in: dto.vendorIds },
        tenantId,
        isDeleted: false,
    });

    if (vendors.length === 0) {
        throw new ServiceError('No valid vendors were selected for email sending.', 'VALIDATION_ERROR');
    }

    const failures: Array<{ vendorId: string; vendorName: string; email?: string; error: string }> = [];
    let sentCount = 0;
    const subjectWithToken = dto.subject.includes('ERP-RFQ:')
        ? dto.subject
        : `${dto.subject} [ERP-RFQ:${rfq.rfqNumber}]`;

    for (const vendor of vendors) {
        if (!vendor.email) {
            failures.push({
                vendorId: vendor._id.toString(),
                vendorName: vendor.name,
                error: 'Vendor has no email address configured.',
            });
            continue;
        }

        try {
            await sendConfiguredMail({
                config,
                to: vendor.email,
                subject: subjectWithToken,
                body: dto.body,
                attachment: {
                    filename: dto.attachmentFileName,
                    contentBase64: dto.attachmentContentBase64,
                    contentType: dto.attachmentContentType,
                },
            });
            sentCount += 1;
        } catch (error) {
            failures.push({
                vendorId: vendor._id.toString(),
                vendorName: vendor.name,
                email: vendor.email,
                error: error instanceof Error ? error.message : 'Unable to send email.',
            });
        }
    }

    if (sentCount > 0 && rfq.status === 'DRAFT') {
        rfq.status = 'SENT';
        await rfq.save();
    }

    return {
        rfq,
        summary: {
            sentCount,
            failedCount: failures.length,
            failures,
        },
    };
};

export const sendRFQVendorMessage = async (
    id: string,
    dto: SendRFQVendorMessageDTO,
    tenantId: string,
) => {
    const [rfq, config, vendor] = await Promise.all([
        RFQ.findOne({ _id: id, tenantId, isDeleted: false }).select('_id rfqNumber vendorIds status'),
        SystemConfig.findOne({ tenantId }),
        BusinessPartner.findOne({ _id: dto.vendorId, tenantId, isDeleted: false }).select('_id name email roles'),
    ]);

    if (!rfq) {
        throw new ServiceError('RFQ not found', 'NOT_FOUND');
    }

    if (!config) {
        throw new ServiceError('Complete the company and email settings before sending messages.', 'VALIDATION_ERROR');
    }

    if (!vendor || !vendor.email) {
        throw new ServiceError('Vendor email is missing. Add an email address to the vendor profile first.', 'VALIDATION_ERROR');
    }

    const isVendorInvited = rfq.vendorIds.some((vendorId) => vendorId.equals(vendor._id as any));
    if (!isVendorInvited) {
        throw new ServiceError('This vendor is not part of the RFQ vendor list.', 'VALIDATION_ERROR');
    }

    const subjectWithToken = dto.subject.includes('ERP-RFQ:')
        ? dto.subject
        : `${dto.subject} [ERP-RFQ:${rfq.rfqNumber}]`;

    const info = await sendConfiguredMail({
        config,
        to: vendor.email,
        subject: subjectWithToken,
        body: dto.body,
    });

    const senderEmail = config.emailSettings?.senderEmail || config.email;
    const senderName = config.emailSettings?.senderName || config.companyName || 'ERP Core';
    const messageId = (info as any)?.messageId || `smtp-${tenantId}-${randomUUID()}`;

    const record = await RFQEmailReply.create({
        tenantId,
        rfqId: rfq._id,
        vendorId: vendor._id,
        direction: 'OUTBOUND',
        messageId,
        subject: subjectWithToken,
        fromEmail: String(senderEmail || '').trim(),
        fromName: senderName,
        toEmail: vendor.email,
        toName: vendor.name,
        bodyText: dto.body,
        attachments: [],
        receivedAt: new Date(),
        isRead: true,
    });

    // Store the outbound message in notifications as part of the vendor thread, but mark it read.
    const bodySnippet = dto.body.replace(/\s+/g, ' ').trim().slice(0, 240);
    await Notification.create({
        tenantId,
        type: 'RFQ_VENDOR_MESSAGE_SENT',
        title: `Message sent to ${vendor.name} for ${rfq.rfqNumber}`,
        message: bodySnippet || 'Message sent.',
        href: `/rfqs/${rfq._id}`,
        isRead: true,
        metadata: {
            rfqId: rfq._id.toString(),
            rfqNumber: rfq.rfqNumber,
            vendorId: vendor._id.toString(),
            vendorName: vendor.name,
            subject: subjectWithToken,
            fromEmail: String(senderEmail || '').trim(),
            fromName: senderName,
            toEmail: vendor.email,
            toName: vendor.name,
            direction: 'OUTBOUND',
            bodySnippet: bodySnippet || undefined,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
    });

    return record.toObject();
};

export const closeRFQ = async (id: string, tenantId: string): Promise<IRFQ> => {
    const rfq = await RFQ.findOne({ _id: id, tenantId, isDeleted: false });
    if (!rfq) {
        throw new ServiceError('RFQ not found', 'NOT_FOUND');
    }

    // Only SENT can be closed
    if (rfq.status !== 'SENT') {
        throw new ServiceError(`Cannot close RFQ in ${rfq.status} status. Only SENT RFQs can be closed.`, 'INVALID_STATUS');
    }

    rfq.status = 'CLOSED';
    return await rfq.save();
};

export const deleteRFQ = async (id: string, tenantId: string): Promise<IRFQ> => {
    const rfq = await RFQ.findOne({ _id: id, tenantId, isDeleted: false });
    if (!rfq) {
        throw new ServiceError('RFQ not found', 'NOT_FOUND');
    }

    // Soft delete only
    rfq.isDeleted = true;
    return await rfq.save();
};

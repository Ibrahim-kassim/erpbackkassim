import { Types } from 'mongoose';
import { ARInvoice } from '../models/arInvoice.model';
import { BusinessPartner } from '../models/businessPartner.model';
import { AccountType, ChartOfAccount } from '../models/chartOfAccount.model';
import { Counter } from '../models/counter.model';
import { Product } from '../models/inventory/product.model';
import { Uom } from '../models/inventory/uom.model';
import { FiscalCalendar } from '../models/fiscalCalendar.model';
import { JournalEntry } from '../models/journalEntry.model';
import { Notification } from '../models/notification.model';
import { RFQEmailReply } from '../models/rfqEmailReply.model';
import { SystemConfig } from '../models/systemConfig.model';
import { fiscalService } from './fiscal.service';
import { createAndPostDirectly } from './journalEntry.service';
import { getTenantBaseCurrency } from './systemConfig.defaults';
import { sendConfiguredMail } from './mail.service';
import { randomUUID } from 'crypto';
import { CreateARInvoiceDTO, SendARInvoiceCustomerMessageDTO, UpdateARInvoiceDTO } from '../validators/arInvoice.schema';

class ServiceError extends Error {
    code: string;
    details?: any;
    constructor(message: string, code = 'VALIDATION_ERROR', details?: any) {
        super(message);
        this.code = code;
        this.details = details;
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const getNextInvoiceNo = async (tenantId: string): Promise<string> => {
    const ret = await Counter.findOneAndUpdate(
        { tenantId, key: 'AR_INVOICE' },
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
    );
    return `ARINV-${ret.seq.toString().padStart(6, '0')}`;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

const validateAccounting = async (
    tenantId: string,
    accounting: CreateARInvoiceDTO['accounting'] | UpdateARInvoiceDTO['accounting']
) => {
    if (!accounting) return;

    const [revenueAccount, arAccount] = await Promise.all([
        ChartOfAccount.findOne({ _id: accounting.revenueAccountId, tenantId }),
        ChartOfAccount.findOne({ _id: accounting.arAccountId, tenantId }),
    ]);

    if (!revenueAccount || !revenueAccount.isActive || !revenueAccount.isPosting) {
        throw new ServiceError('Revenue account is invalid', 'VALIDATION_ERROR');
    }
    if (![AccountType.REVENUE, AccountType.INCOME].includes(revenueAccount.type)) {
        throw new ServiceError('Revenue account must be a revenue or income posting account', 'VALIDATION_ERROR');
    }

    if (!arAccount || !arAccount.isActive || !arAccount.isPosting) {
        throw new ServiceError('AR control account is invalid', 'VALIDATION_ERROR');
    }
    if (arAccount.type !== AccountType.ASSET) {
        throw new ServiceError('AR control account must be an asset posting account', 'VALIDATION_ERROR');
    }
};

const resolveItems = async (tenantId: string, items: CreateARInvoiceDTO['items']) => {
    const processed = [];

    for (const item of items) {
        const quantity = round2(item.quantity);
        const unitPrice = round2(item.unitPrice);

        if (item.productId) {
            const product = await Product.findOne({
                _id: item.productId,
                tenantId,
                isDeleted: false,
                status: 'ACTIVE',
            });

            if (!product) {
                throw new ServiceError('Linked product or service was not found', 'VALIDATION_ERROR');
            }

            const uom = await Uom.findOne({ _id: product.uomId, tenantId, isDeleted: false });

            processed.push({
                lineType: 'CATALOG',
                productId: product._id,
                itemCode: product.code,
                itemName: product.name,
                itemKind: product.type,
                uomLabel: uom ? `${uom.symbol} - ${uom.name}` : undefined,
                description: item.description.trim(),
                quantity,
                unitPrice,
                lineTotal: round2(quantity * unitPrice),
            });
            continue;
        }

        processed.push({
            lineType: item.lineType || 'MANUAL',
            itemKind: 'MANUAL',
            uomLabel: item.uomLabel?.trim() || undefined,
            description: item.description.trim(),
            quantity,
            unitPrice,
            lineTotal: round2(quantity * unitPrice),
        });
    }

    const subtotal = Math.round(processed.reduce((s, i) => s + i.lineTotal, 0) * 100) / 100;
    return { items: processed, subtotal, taxTotal: 0, total: subtotal };
};

const mapInvoice = (inv: any) => ({
    id: inv._id?.toString() || inv.id,
    invoiceNo: inv.invoiceNo,
    customerId: inv.customerId?.toString(),
    customerName: inv.customerName,
    customerCode: inv.customerCode,
    customerEmail: inv.customerEmail,
    status: inv.status,
    invoiceDate: inv.invoiceDate instanceof Date ? inv.invoiceDate.toISOString().split('T')[0] : inv.invoiceDate,
    postingDate: inv.postingDate instanceof Date ? inv.postingDate.toISOString().split('T')[0] : inv.postingDate,
    dueDate: inv.dueDate instanceof Date ? inv.dueDate.toISOString().split('T')[0] : inv.dueDate,
    fiscalPeriodId: inv.fiscalPeriodId?.toString(),
    fiscalPeriodLabel: inv.fiscalPeriodLabel,
    currency: inv.currency,
    notes: inv.notes,
    items: (inv.items || []).map((item: any, index: number) => ({
        id: item.id || `${inv._id?.toString?.() || inv.id || 'arinv'}-${index + 1}`,
        lineType: item.lineType || 'MANUAL',
        productId: item.productId?.toString?.() || item.productId,
        itemCode: item.itemCode,
        itemName: item.itemName,
        itemKind: item.itemKind || 'MANUAL',
        uomLabel: item.uomLabel,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
    })),
    accounting: {
        revenueAccountId: inv.accounting?.revenueAccountId?.toString(),
        revenueAccountCode: inv.accounting?.revenueAccountCode,
        revenueAccountName: inv.accounting?.revenueAccountName,
        arAccountId: inv.accounting?.arAccountId?.toString(),
        arAccountCode: inv.accounting?.arAccountCode,
        arAccountName: inv.accounting?.arAccountName,
    },
    totals: inv.totals,
    amountReceived: inv.amountReceived,
    balance: inv.balance,
    journalEntryId: inv.journalEntryId?.toString(),
    journalEntryNo: inv.journalEntryNo,
    createdAt: inv.createdAt instanceof Date ? inv.createdAt.toISOString() : inv.createdAt,
    updatedAt: inv.updatedAt instanceof Date ? inv.updatedAt.toISOString() : inv.updatedAt,
});

const enrichInvoiceDisplay = async (tenantId: string, rawInvoice: any) => {
    const invoice = mapInvoice(rawInvoice);

    const [customer, accounts, calendar, journalEntry] = await Promise.all([
        invoice.customerId
            ? BusinessPartner.findOne({ _id: invoice.customerId, tenantId, isDeleted: false }).select('code name email').lean()
            : null,
        ChartOfAccount.find({
            _id: {
                $in: [invoice.accounting.revenueAccountId, invoice.accounting.arAccountId].filter(Boolean),
            },
            tenantId,
        }).select('code name').lean(),
        invoice.fiscalPeriodId
            ? FiscalCalendar.findOne({
                tenantId,
                'periods._id': new Types.ObjectId(invoice.fiscalPeriodId),
            }).lean()
            : null,
        invoice.journalEntryId && !invoice.journalEntryNo
            ? JournalEntry.findOne({ _id: invoice.journalEntryId, tenantId }).select('entryNo').lean()
            : null,
    ]);

    const accountMap = new Map(accounts.map((account: any) => [account._id.toString(), account]));
    const matchedPeriod = calendar?.periods?.find((period: any) => period._id.toString() === invoice.fiscalPeriodId);

    return {
        ...invoice,
        customerCode: customer?.code || invoice.customerCode,
        customerEmail: customer?.email || invoice.customerEmail,
        fiscalPeriodLabel: matchedPeriod?.label || invoice.fiscalPeriodLabel,
        accounting: {
            ...invoice.accounting,
            revenueAccountCode: accountMap.get(invoice.accounting.revenueAccountId)?.code,
            revenueAccountName: accountMap.get(invoice.accounting.revenueAccountId)?.name,
            arAccountCode: accountMap.get(invoice.accounting.arAccountId)?.code,
            arAccountName: accountMap.get(invoice.accounting.arAccountId)?.name,
        },
        journalEntryNo: invoice.journalEntryNo || journalEntry?.entryNo,
    };
};

// ─── Create ───────────────────────────────────────────────────────────────────

export const create = async (dto: CreateARInvoiceDTO, tenantId: string) => {
    const customer = await BusinessPartner.findOne({ _id: dto.customerId, tenantId, isDeleted: false });
    if (!customer) throw new ServiceError('Customer not found', 'NOT_FOUND');
    if (!customer.roles.includes('CUSTOMER')) throw new ServiceError('Business partner is not a customer', 'VALIDATION_ERROR');

    await validateAccounting(tenantId, dto.accounting);
    const baseCurrency = dto.currency || await getTenantBaseCurrency(tenantId);

    const invoiceNo = await getNextInvoiceNo(tenantId);
    const { items, subtotal, taxTotal, total } = await resolveItems(tenantId, dto.items);

    let fiscalPeriodId: Types.ObjectId | undefined;
    let fiscalYearId: Types.ObjectId | undefined;
    try {
        const resolved = await fiscalService.resolveDate(tenantId, new Date(dto.postingDate));
        if (resolved) {
            fiscalPeriodId = resolved.periodId as any;
            fiscalYearId = resolved.fiscalYearId;
        }
    } catch { /* ignore for DRAFT */ }

    const invoice = await ARInvoice.create({
        tenantId,
        invoiceNo,
        customerId: new Types.ObjectId(dto.customerId),
        customerName: customer.name,
        status: 'DRAFT',
        invoiceDate: new Date(dto.invoiceDate),
        postingDate: new Date(dto.postingDate),
        dueDate: new Date(dto.dueDate),
        fiscalPeriodId,
        fiscalYearId,
        currency: baseCurrency,
        notes: dto.notes,
        items,
        accounting: {
            revenueAccountId: new Types.ObjectId(dto.accounting.revenueAccountId),
            arAccountId: new Types.ObjectId(dto.accounting.arAccountId),
        },
        totals: { subtotal, taxTotal, total },
        amountReceived: 0,
        balance: total,
    });

    return enrichInvoiceDisplay(tenantId, invoice.toObject());
};

// ─── Update (DRAFT only) ──────────────────────────────────────────────────────

export const update = async (id: string, dto: UpdateARInvoiceDTO, tenantId: string) => {
    const invoice = await ARInvoice.findOne({ _id: id, tenantId, isDeleted: false });
    if (!invoice) throw new ServiceError('Invoice not found', 'NOT_FOUND');
    if (invoice.status !== 'DRAFT') throw new ServiceError('Only DRAFT invoices can be updated', 'INVALID_STATUS');

    if (dto.invoiceDate) invoice.invoiceDate = new Date(dto.invoiceDate);
    if (dto.dueDate) invoice.dueDate = new Date(dto.dueDate);
    if (dto.notes !== undefined) invoice.notes = dto.notes;
    if (dto.postingDate) {
        invoice.postingDate = new Date(dto.postingDate);
        try {
            const resolved = await fiscalService.resolveDate(tenantId, invoice.postingDate);
            if (resolved) {
                invoice.fiscalPeriodId = resolved.periodId as any;
                invoice.fiscalYearId = resolved.fiscalYearId;
            }
        } catch { /* ignore */ }
    }
    if (dto.items) {
        const { items, subtotal, taxTotal, total } = await resolveItems(tenantId, dto.items);
        invoice.items = items as any;
        invoice.totals = { subtotal, taxTotal, total };
        invoice.balance = total - invoice.amountReceived;
    }
    if (dto.accounting) {
        await validateAccounting(tenantId, dto.accounting);
        invoice.accounting = {
            revenueAccountId: new Types.ObjectId(dto.accounting.revenueAccountId),
            arAccountId: new Types.ObjectId(dto.accounting.arAccountId),
        };
    }

    return enrichInvoiceDisplay(tenantId, (await invoice.save()).toObject());
};

// ─── Post → Journal Entry ─────────────────────────────────────────────────────

export const post = async (id: string, tenantId: string) => {
    const invoice = await ARInvoice.findOne({ _id: id, tenantId, isDeleted: false });
    if (!invoice) throw new ServiceError('Invoice not found', 'NOT_FOUND');
    if (invoice.status === 'POSTED') return mapInvoice(invoice.toObject());
    if (invoice.status === 'VOID') throw new ServiceError('Cannot post a voided invoice', 'INVALID_STATUS');

    // DR AR Control  total
    // CR Revenue     subtotal
    const je = await createAndPostDirectly(tenantId, {
        entryType: 'AR Invoice',
        postingDate: invoice.postingDate,
        description: `AR Invoice ${invoice.invoiceNo} - ${invoice.customerName}`,
        reference: invoice.invoiceNo,
        sourceType: 'AR_INVOICE',
        sourceId: invoice._id.toString(),
        sourceNo: invoice.invoiceNo,
        lines: [
            {
                accountId: invoice.accounting.arAccountId.toString(),
                debit: invoice.totals.total,
                credit: 0,
                description: `AR Invoice ${invoice.invoiceNo}`,
            },
            {
                accountId: invoice.accounting.revenueAccountId.toString(),
                debit: 0,
                credit: invoice.totals.total,
                description: `AR Invoice ${invoice.invoiceNo}`,
            },
        ],
    });

    invoice.status = 'POSTED';
    invoice.journalEntryId = je._id as any;
    invoice.journalEntryNo = je.entryNo;

    return enrichInvoiceDisplay(tenantId, (await invoice.save()).toObject());
};

// ─── Void ─────────────────────────────────────────────────────────────────────

export const voidInvoice = async (id: string, tenantId: string) => {
    const invoice = await ARInvoice.findOne({ _id: id, tenantId, isDeleted: false });
    if (!invoice) throw new ServiceError('Invoice not found', 'NOT_FOUND');
    if (invoice.status === 'VOID') return mapInvoice(invoice.toObject());
    if (invoice.status === 'POSTED' && invoice.amountReceived > 0) {
        throw new ServiceError('Cannot void an invoice with receipts applied', 'INVALID_STATUS');
    }
    invoice.status = 'VOID';
    return enrichInvoiceDisplay(tenantId, (await invoice.save()).toObject());
};

// ─── List ─────────────────────────────────────────────────────────────────────

export const list = async (query: any, tenantId: string) => {
    const filter: any = { tenantId, isDeleted: false };
    if (query.status && query.status !== 'ALL') filter.status = query.status;
    if (query.customerId) filter.customerId = new Types.ObjectId(query.customerId);
    if (query.search) {
        const regex = { $regex: query.search, $options: 'i' };
        filter.$or = [{ invoiceNo: regex }, { customerName: regex }];
    }
    if (query.dateFrom || query.dateTo) {
        filter.postingDate = {};
        if (query.dateFrom) filter.postingDate.$gte = new Date(query.dateFrom);
        if (query.dateTo) filter.postingDate.$lte = new Date(query.dateTo);
    }

    const page = parseInt(query.page || '1');
    const limit = parseInt(query.limit || '50');
    const [data, total] = await Promise.all([
        ARInvoice.find(filter).sort({ postingDate: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        ARInvoice.countDocuments(filter),
    ]);

    return { data: data.map(mapInvoice), meta: { total, page, limit, pages: Math.ceil(total / limit) } };
};

export const getById = async (id: string, tenantId: string) => {
    const invoice = await ARInvoice.findOne({ _id: id, tenantId, isDeleted: false });
    if (!invoice) throw new ServiceError('Invoice not found', 'NOT_FOUND');
    return enrichInvoiceDisplay(tenantId, invoice.toObject());
};

export const remove = async (id: string, tenantId: string) => {
    const invoice = await ARInvoice.findOne({ _id: id, tenantId, isDeleted: false });
    if (!invoice) throw new ServiceError('Invoice not found', 'NOT_FOUND');
    if (invoice.status !== 'DRAFT') throw new ServiceError('Only DRAFT invoices can be deleted', 'INVALID_STATUS');
    invoice.isDeleted = true;
    await invoice.save();
};

export const sendCustomerMessage = async (
    id: string,
    dto: SendARInvoiceCustomerMessageDTO,
    tenantId: string,
) => {
    const [invoice, config] = await Promise.all([
        ARInvoice.findOne({ _id: id, tenantId, isDeleted: false }).select('_id invoiceNo customerId customerName status'),
        SystemConfig.findOne({ tenantId }),
    ]);

    if (!invoice) {
        throw new ServiceError('Invoice not found', 'NOT_FOUND');
    }

    if (!config) {
        throw new ServiceError('Complete the company and email settings before sending messages.', 'VALIDATION_ERROR');
    }

    const customer = await BusinessPartner.findOne({ _id: invoice.customerId, tenantId, isDeleted: false })
        .select('_id name email roles');
    if (!customer || !customer.email) {
        throw new ServiceError('Customer email is missing. Add an email address to the customer profile first.', 'VALIDATION_ERROR');
    }

    if (!customer.roles.includes('CUSTOMER')) {
        throw new ServiceError('The linked business partner is not configured as a customer.', 'VALIDATION_ERROR');
    }

    const subjectWithToken = dto.subject.includes('ERP-ARINV:')
        ? dto.subject
        : `${dto.subject} [ERP-ARINV:${invoice.invoiceNo}]`;

    const attachment =
        dto.attachmentFileName && dto.attachmentContentBase64
            ? {
                filename: dto.attachmentFileName,
                contentBase64: dto.attachmentContentBase64,
                contentType: dto.attachmentContentType || 'application/pdf',
            }
            : undefined;

    const info = await sendConfiguredMail({
        config,
        to: customer.email,
        subject: subjectWithToken,
        body: dto.body,
        attachment,
    });

    const senderEmail = config.emailSettings?.senderEmail || config.email;
    const senderName = config.emailSettings?.senderName || config.companyName || 'ERP Core';
    const messageId = (info as any)?.messageId || `smtp-${tenantId}-${randomUUID()}`;

    const record = await RFQEmailReply.create({
        tenantId,
        rfqId: undefined,
        arInvoiceId: invoice._id,
        vendorId: undefined,
        customerId: customer._id,
        direction: 'OUTBOUND',
        messageId,
        subject: subjectWithToken,
        fromEmail: String(senderEmail || '').trim(),
        fromName: senderName,
        toEmail: customer.email,
        toName: customer.name,
        bodyText: dto.body,
        attachments: [],
        receivedAt: new Date(),
        isRead: true,
    });

    const bodySnippet = dto.body.replace(/\s+/g, ' ').trim().slice(0, 240);
    await Notification.create({
        tenantId,
        type: 'AR_CUSTOMER_MESSAGE_SENT',
        title: `Message sent to ${customer.name} for ${invoice.invoiceNo}`,
        message: bodySnippet || 'Message sent.',
        href: `/receivables/invoices/${invoice._id}`,
        isRead: true,
        metadata: {
            arInvoiceId: invoice._id.toString(),
            arInvoiceNo: invoice.invoiceNo,
            emailReplyId: record._id.toString(),
            customerId: customer._id.toString(),
            customerName: customer.name,
            subject: subjectWithToken,
            fromEmail: String(senderEmail || '').trim(),
            fromName: senderName,
            toEmail: customer.email,
            toName: customer.name,
            direction: 'OUTBOUND',
            bodySnippet: bodySnippet || undefined,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
    });

    return record.toObject();
};

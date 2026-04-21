import { Types } from 'mongoose';
import { APInvoice } from '../models/apInvoice.model';
import { BusinessPartner } from '../models/businessPartner.model';
import { AccountType, ChartOfAccount } from '../models/chartOfAccount.model';
import { Counter } from '../models/counter.model';
import { PurchaseOrder } from '../models/purchaseOrder.model';
import { SystemConfig } from '../models/systemConfig.model';
import { fiscalService } from './fiscal.service';
import { createAndPostDirectly } from './journalEntry.service';
import { refreshPurchaseOrderLifecycle } from './purchaseOrder.service';
import { getTenantBaseCurrency } from './systemConfig.defaults';
import { sendConfiguredMail } from './mail.service';
import { CreateAPInvoiceDTO, SendAPInvoiceVendorMessageDTO, UpdateAPInvoiceDTO } from '../validators/apInvoice.schema';

class ServiceError extends Error {
    code: string;
    details?: any;
    constructor(message: string, code = 'VALIDATION_ERROR', details?: any) {
        super(message);
        this.code = code;
        this.details = details;
    }
}

const ensureValidInvoiceId = (id: string) => {
    if (!Types.ObjectId.isValid(id)) {
        throw new ServiceError('Invalid invoice id', 'VALIDATION_ERROR');
    }
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const getNextInvoiceNo = async (tenantId: string): Promise<string> => {
    const ret = await Counter.findOneAndUpdate(
        { tenantId, key: 'AP_INVOICE' },
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
    );
    return `APINV-${ret.seq.toString().padStart(6, '0')}`;
};

const calcLineTotals = (items: CreateAPInvoiceDTO['items']) => {
    const processedItems = items.map(item => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: Math.round(item.quantity * item.unitPrice * 100) / 100,
    }));
    const subtotal = Math.round(processedItems.reduce((s, i) => s + i.lineTotal, 0) * 100) / 100;
    return { items: processedItems, subtotal, tax: 0, total: subtotal };
};

const validateAccountingAccounts = async (
    tenantId: string,
    accounting: CreateAPInvoiceDTO['accounting']
) => {
    const [debitAccount, apAccount] = await Promise.all([
        ChartOfAccount.findOne({ _id: accounting.expenseAccountId, tenantId }),
        ChartOfAccount.findOne({ _id: accounting.apAccountId, tenantId }),
    ]);

    if (!debitAccount) throw new ServiceError('Debit account not found', 'NOT_FOUND');
    if (!apAccount) throw new ServiceError('AP account not found', 'NOT_FOUND');

    if (!debitAccount.isActive || !debitAccount.isPosting) {
        throw new ServiceError('Debit account must be active and posting-enabled', 'VALIDATION_ERROR');
    }
    if (!apAccount.isActive || !apAccount.isPosting) {
        throw new ServiceError('AP account must be active and posting-enabled', 'VALIDATION_ERROR');
    }

    const allowedDebitTypes = [AccountType.EXPENSE, AccountType.ASSET, AccountType.LIABILITY];
    if (!allowedDebitTypes.includes(debitAccount.type)) {
        throw new ServiceError('Debit account must be an Expense, Asset, or Liability clearing account', 'VALIDATION_ERROR');
    }

    if (apAccount.type !== AccountType.LIABILITY) {
        throw new ServiceError('AP account must be a Liability account', 'VALIDATION_ERROR');
    }
};

const getLinkedPurchaseOrderId = (invoice: { source?: { purchaseOrderId?: Types.ObjectId | string } }) =>
    invoice.source?.purchaseOrderId?.toString();

const validateLinkedPurchaseOrder = async (tenantId: string, dto: CreateAPInvoiceDTO) => {
    const purchaseOrderId = dto.source?.purchaseOrderId;
    if (!purchaseOrderId) return null;

    const po = await PurchaseOrder.findOne({ _id: purchaseOrderId, tenantId, isDeleted: false });
    if (!po) throw new ServiceError('Linked purchase order not found', 'NOT_FOUND');
    if (po.status !== 'APPROVED') {
        throw new ServiceError('Vendor bills can only be created from APPROVED purchase orders', 'INVALID_STATUS');
    }
    if (po.vendorId.toString() !== dto.vendorId) {
        throw new ServiceError('Vendor bill vendor must match the linked purchase order vendor', 'VALIDATION_ERROR');
    }

    const existing = await APInvoice.findOne({
        tenantId,
        'source.purchaseOrderId': po._id,
        isDeleted: false,
        status: { $ne: 'VOID' },
    });

    if (existing) {
        throw new ServiceError(`Vendor bill ${existing.invoiceNo} already exists for ${po.poNumber}`, 'CONFLICT');
    }

    return po;
};

const refreshLinkedPurchaseOrder = async (tenantId: string, invoice: { source?: { purchaseOrderId?: Types.ObjectId | string } }) => {
    const purchaseOrderId = getLinkedPurchaseOrderId(invoice);
    if (!purchaseOrderId) return;
    await refreshPurchaseOrderLifecycle(tenantId, purchaseOrderId);
};

// ─── Create ───────────────────────────────────────────────────────────────────

export const create = async (dto: CreateAPInvoiceDTO, tenantId: string) => {
    // Validate vendor
    const vendor = await BusinessPartner.findOne({ _id: dto.vendorId, tenantId, isDeleted: false });
    if (!vendor) throw new ServiceError('Vendor not found', 'NOT_FOUND');
    if (!vendor.roles.includes('VENDOR')) throw new ServiceError('Business partner is not a vendor', 'VALIDATION_ERROR');

    const invoiceNo = await getNextInvoiceNo(tenantId);
    const { items, subtotal, tax, total } = calcLineTotals(dto.items);
    await validateAccountingAccounts(tenantId, dto.accounting);
    const linkedPO = await validateLinkedPurchaseOrder(tenantId, dto);
    const baseCurrency = dto.currencyCode || await getTenantBaseCurrency(tenantId);

    // Resolve fiscal period (optional for DRAFT)
    let fiscalPeriodId: Types.ObjectId | undefined;
    let fiscalYearId: Types.ObjectId | undefined;
    try {
        const resolved = await fiscalService.resolveDate(tenantId, new Date(dto.postingDate));
        if (resolved) {
            fiscalPeriodId = resolved.periodId as any;
            fiscalYearId = resolved.fiscalYearId;
        }
    } catch { /* ignore for DRAFT */ }

    const invoice = await APInvoice.create({
        tenantId,
        invoiceNo,
        vendorId: new Types.ObjectId(dto.vendorId),
        vendorName: vendor.name,
        status: 'DRAFT',
        invoiceDate: new Date(dto.invoiceDate),
        postingDate: new Date(dto.postingDate),
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        fiscalPeriodId,
        fiscalYearId,
        currencyCode: baseCurrency,
        notes: dto.notes,
        source: dto.source ? {
            purchaseOrderId: linkedPO?._id || (dto.source.purchaseOrderId ? new Types.ObjectId(dto.source.purchaseOrderId) : undefined),
            poNo: linkedPO?.poNumber || dto.source.poNo,
        } : undefined,
        items,
        accounting: {
            expenseAccountId: new Types.ObjectId(dto.accounting.expenseAccountId),
            apAccountId: new Types.ObjectId(dto.accounting.apAccountId),
        },
        totals: { subtotal, tax, total },
        amountPaid: 0,
        balance: total,
    });

    await refreshLinkedPurchaseOrder(tenantId, invoice);
    return invoice;
};

// ─── Update (DRAFT only) ──────────────────────────────────────────────────────

export const update = async (id: string, dto: UpdateAPInvoiceDTO, tenantId: string) => {
    ensureValidInvoiceId(id);
    const invoice = await APInvoice.findOne({ _id: id, tenantId, isDeleted: false });
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
        const { items, subtotal, tax, total } = calcLineTotals(dto.items);
        invoice.items = items as any;
        invoice.totals = { subtotal, tax, total };
        invoice.balance = total - invoice.amountPaid;
    }

    if (dto.accounting) {
        await validateAccountingAccounts(tenantId, dto.accounting);
        invoice.accounting = {
            expenseAccountId: new Types.ObjectId(dto.accounting.expenseAccountId),
            apAccountId: new Types.ObjectId(dto.accounting.apAccountId),
        };
    }

    const saved = await invoice.save();
    await refreshLinkedPurchaseOrder(tenantId, saved);
    return saved;
};

// ─── Post → creates Journal Entry ─────────────────────────────────────────────

export const post = async (id: string, tenantId: string) => {
    ensureValidInvoiceId(id);
    const invoice = await APInvoice.findOne({ _id: id, tenantId, isDeleted: false });
    if (!invoice) throw new ServiceError('Invoice not found', 'NOT_FOUND');
    if (invoice.status === 'POSTED') return invoice;
    if (invoice.status === 'VOID') throw new ServiceError('Cannot post a voided invoice', 'INVALID_STATUS');
    await validateAccountingAccounts(tenantId, {
        expenseAccountId: invoice.accounting.expenseAccountId.toString(),
        apAccountId: invoice.accounting.apAccountId.toString(),
    });

    // Build journal entry lines
    //   DR Expense Account  subtotal
    //   CR AP Control       total
    const lines = [
        {
            accountId: invoice.accounting.expenseAccountId.toString(),
            debit: invoice.totals.subtotal,
            credit: 0,
            description: `AP Invoice ${invoice.invoiceNo}`,
        },
        {
            accountId: invoice.accounting.apAccountId.toString(),
            debit: 0,
            credit: invoice.totals.total,
            description: `AP Invoice ${invoice.invoiceNo}`,
        },
    ];

    // If VAT exists, add VAT line (future)
    // For now tax is always 0, so subtotal == total

    const je = await createAndPostDirectly(tenantId, {
        entryType: 'AP Invoice',
        postingDate: invoice.postingDate,
        description: `AP Invoice ${invoice.invoiceNo} - ${invoice.vendorName}`,
        reference: invoice.invoiceNo,
        sourceType: 'AP_INVOICE',
        sourceId: invoice._id.toString(),
        sourceNo: invoice.invoiceNo,
        lines,
    });

    invoice.status = 'POSTED';
    invoice.journalEntryId = je._id as any;
    invoice.journalEntryNo = je.entryNo;
    const saved = await invoice.save();
    await refreshLinkedPurchaseOrder(tenantId, saved);
    return saved;
};

// ─── Void ─────────────────────────────────────────────────────────────────────

export const voidInvoice = async (id: string, tenantId: string) => {
    ensureValidInvoiceId(id);
    const invoice = await APInvoice.findOne({ _id: id, tenantId, isDeleted: false });
    if (!invoice) throw new ServiceError('Invoice not found', 'NOT_FOUND');
    if (invoice.status === 'VOID') return invoice;
    if (invoice.status === 'POSTED' && invoice.amountPaid > 0) {
        throw new ServiceError('Cannot void an invoice with payments applied', 'INVALID_STATUS');
    }

    invoice.status = 'VOID';
    const saved = await invoice.save();
    await refreshLinkedPurchaseOrder(tenantId, saved);
    return saved;
};

// ─── List ─────────────────────────────────────────────────────────────────────

export const list = async (query: any, tenantId: string) => {
    const filter: any = { tenantId, isDeleted: false };

    if (query.status && query.status !== 'ALL') filter.status = query.status;
    if (query.vendorId) filter.vendorId = new Types.ObjectId(query.vendorId);
    if (query.purchaseOrderId) filter['source.purchaseOrderId'] = new Types.ObjectId(query.purchaseOrderId);

    if (query.search) {
        const regex = { $regex: query.search, $options: 'i' };
        filter.$or = [{ invoiceNo: regex }, { vendorName: regex }];
    }
    if (query.dateFrom || query.dateTo) {
        filter.postingDate = {};
        if (query.dateFrom) filter.postingDate.$gte = new Date(query.dateFrom);
        if (query.dateTo) filter.postingDate.$lte = new Date(query.dateTo);
    }

    const page = parseInt(query.page || '1');
    const limit = parseInt(query.limit || '50');
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
        APInvoice.find(filter).sort({ postingDate: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
        APInvoice.countDocuments(filter),
    ]);

    return { data: data.map(mapInvoice), meta: { total, page, limit, pages: Math.ceil(total / limit) } };
};

// ─── Get by ID ────────────────────────────────────────────────────────────────

export const getById = async (id: string, tenantId: string) => {
    ensureValidInvoiceId(id);
    const invoice = await APInvoice.findOne({ _id: id, tenantId, isDeleted: false });
    if (!invoice) throw new ServiceError('Invoice not found', 'NOT_FOUND');
    return mapInvoice(invoice.toObject());
};

// ─── Soft delete ──────────────────────────────────────────────────────────────

export const remove = async (id: string, tenantId: string) => {
    ensureValidInvoiceId(id);
    const invoice = await APInvoice.findOne({ _id: id, tenantId, isDeleted: false });
    if (!invoice) throw new ServiceError('Invoice not found', 'NOT_FOUND');
    if (invoice.status !== 'DRAFT') throw new ServiceError('Only DRAFT invoices can be deleted', 'INVALID_STATUS');
    const purchaseOrderId = getLinkedPurchaseOrderId(invoice);
    invoice.isDeleted = true;
    await invoice.save();
    if (purchaseOrderId) {
        await refreshPurchaseOrderLifecycle(tenantId, purchaseOrderId);
    }
};

export const sendVendorMessage = async (
    id: string,
    dto: SendAPInvoiceVendorMessageDTO,
    tenantId: string
) => {
    ensureValidInvoiceId(id);

    const [invoice, config] = await Promise.all([
        APInvoice.findOne({ _id: id, tenantId, isDeleted: false }).select('_id invoiceNo vendorId vendorName status'),
        SystemConfig.findOne({ tenantId }),
    ]);

    if (!invoice) throw new ServiceError('Invoice not found', 'NOT_FOUND');
    if (invoice.status !== 'POSTED') {
        throw new ServiceError('Only POSTED vendor bills can be sent by email', 'INVALID_STATUS');
    }
    if (!config) {
        throw new ServiceError('Complete company and email settings before sending vendor bills', 'VALIDATION_ERROR');
    }

    const vendor = await BusinessPartner.findOne({
        _id: invoice.vendorId,
        tenantId,
        isDeleted: false,
    }).select('_id name email roles');

    if (!vendor || !vendor.email) {
        throw new ServiceError('Vendor email is missing. Add vendor email in Business Partners first.', 'VALIDATION_ERROR');
    }
    if (!vendor.roles.includes('VENDOR')) {
        throw new ServiceError('Linked business partner is not configured as a vendor', 'VALIDATION_ERROR');
    }

    const subjectWithToken = dto.subject.includes('ERP-APINV:')
        ? dto.subject
        : `${dto.subject} [ERP-APINV:${invoice.invoiceNo}]`;

    const attachment =
        dto.attachmentFileName && dto.attachmentContentBase64
            ? {
                filename: dto.attachmentFileName,
                contentBase64: dto.attachmentContentBase64,
                contentType: dto.attachmentContentType || 'application/pdf',
            }
            : undefined;

    await sendConfiguredMail({
        config,
        to: vendor.email,
        subject: subjectWithToken,
        body: dto.body,
        attachment,
    });

    return {
        invoiceId: invoice._id.toString(),
        invoiceNo: invoice.invoiceNo,
        vendorId: vendor._id.toString(),
        vendorName: vendor.name,
        vendorEmail: vendor.email,
        subject: subjectWithToken,
        sentAt: new Date().toISOString(),
    };
};

// ─── Map to frontend shape ────────────────────────────────────────────────────

const mapInvoice = (inv: any) => ({
    id: inv._id?.toString() || inv.id,
    invoiceNo: inv.invoiceNo,
    vendorId: inv.vendorId?.toString(),
    vendorName: inv.vendorName,
    status: inv.status,
    invoiceDate: inv.invoiceDate instanceof Date ? inv.invoiceDate.toISOString().split('T')[0] : inv.invoiceDate,
    postingDate: inv.postingDate instanceof Date ? inv.postingDate.toISOString().split('T')[0] : inv.postingDate,
    dueDate: inv.dueDate ? (inv.dueDate instanceof Date ? inv.dueDate.toISOString().split('T')[0] : inv.dueDate) : undefined,
    fiscalPeriodId: inv.fiscalPeriodId?.toString(),
    currencyCode: inv.currencyCode,
    notes: inv.notes,
    source: inv.source ? {
        purchaseOrderId: inv.source.purchaseOrderId?.toString(),
        poNo: inv.source.poNo,
    } : undefined,
    items: inv.items,
    accounting: {
        expenseAccountId: inv.accounting?.expenseAccountId?.toString(),
        apAccountId: inv.accounting?.apAccountId?.toString(),
    },
    totals: inv.totals,
    amountPaid: inv.amountPaid,
    balance: inv.balance,
    journalEntryId: inv.journalEntryId?.toString(),
    journalEntryNo: inv.journalEntryNo,
    createdAt: inv.createdAt instanceof Date ? inv.createdAt.toISOString() : inv.createdAt,
    updatedAt: inv.updatedAt instanceof Date ? inv.updatedAt.toISOString() : inv.updatedAt,
});

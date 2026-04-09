import { Types } from 'mongoose';
import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { ARReceipt } from '../models/arReceipt.model';
import { ARInvoice } from '../models/arInvoice.model';
import { BusinessPartner } from '../models/businessPartner.model';
import { Counter } from '../models/counter.model';
import { fiscalService } from './fiscal.service';
import { createAndPostDirectly } from './journalEntry.service';
import { getTenantBaseCurrency } from './systemConfig.defaults';
import { CreateARReceiptDTO, UpdateARReceiptDTO } from '../validators/arReceipt.schema';

class ServiceError extends Error {
    code: string;
    details?: any;
    constructor(message: string, code = 'VALIDATION_ERROR', details?: any) {
        super(message);
        this.code = code;
        this.details = details;
    }
}

const getNextReceiptNo = async (tenantId: string): Promise<string> => {
    const ret = await Counter.findOneAndUpdate(
        { tenantId, key: 'AR_RECEIPT' },
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
    );
    return `ARREC-${ret.seq.toString().padStart(6, '0')}`;
};

const receiptUploadRoot = path.join(process.cwd(), 'uploads', 'ar-receipts');

const sanitizeFileName = (input: string) => input.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-');

const saveReceiptReference = async (
    tenantId: string,
    receiptNo: string,
    fileName: string,
    contentBase64: string,
    contentType?: string,
) => {
    const tenantDir = path.join(receiptUploadRoot, tenantId);
    await fs.mkdir(tenantDir, { recursive: true });

    const safeName = sanitizeFileName(fileName || `${receiptNo}-reference`);
    const filename = `${receiptNo.toLowerCase()}-${randomUUID()}-${safeName}`;
    const absolutePath = path.join(tenantDir, filename);
    const buffer = Buffer.from(contentBase64, 'base64');
    await fs.writeFile(absolutePath, buffer);

    return {
        filename: fileName,
        url: `/uploads/ar-receipts/${tenantId}/${filename}`,
        contentType: contentType || 'application/octet-stream',
        size: buffer.length,
    };
};

const mapReceipt = (r: any) => ({
    id: r._id?.toString() || r.id,
    receiptNo: r.receiptNo,
    customerId: r.customerId?.toString(),
    customerName: r.customerName,
    status: r.status,
    receiptDate: r.receiptDate instanceof Date ? r.receiptDate.toISOString().split('T')[0] : r.receiptDate,
    postingDate: r.postingDate instanceof Date ? r.postingDate.toISOString().split('T')[0] : r.postingDate,
    fiscalPeriodId: r.fiscalPeriodId?.toString(),
    method: r.method,
    bankAccountId: r.bankAccountId?.toString(),
    arAccountId: r.arAccountId?.toString(),
    currencyCode: r.currencyCode,
    memo: r.memo,
    amount: r.amount,
    allocatedAmount: r.allocatedAmount,
    unallocatedAmount: r.unallocatedAmount,
    allocations: (r.allocations || []).map((a: any) => ({
        id: a.invoiceId?.toString(),
        invoiceId: a.invoiceId?.toString(),
        invoiceNo: a.invoiceNo,
        allocatedAmount: a.allocatedAmount,
    })),
    journalEntryId: r.journalEntryId?.toString(),
    journalEntryNo: r.journalEntryNo,
    referenceDocument: r.referenceDocument ? {
        filename: r.referenceDocument.filename,
        url: r.referenceDocument.url,
        contentType: r.referenceDocument.contentType,
        size: r.referenceDocument.size,
    } : undefined,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
    updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : r.updatedAt,
});

// ─── Create ───────────────────────────────────────────────────────────────────

export const create = async (dto: CreateARReceiptDTO, tenantId: string) => {
    const customer = await BusinessPartner.findOne({ _id: dto.customerId, tenantId, isDeleted: false });
    if (!customer) throw new ServiceError('Customer not found', 'NOT_FOUND');
    const baseCurrency = await getTenantBaseCurrency(tenantId);

    const receiptNo = await getNextReceiptNo(tenantId);
    const allocatedAmount = dto.allocations.reduce((s, a) => s + a.allocatedAmount, 0);

    let fiscalPeriodId: Types.ObjectId | undefined;
    let fiscalYearId: Types.ObjectId | undefined;
    const referenceDocument =
        dto.referenceFileName && dto.referenceFileBase64
            ? await saveReceiptReference(
                tenantId,
                receiptNo,
                dto.referenceFileName,
                dto.referenceFileBase64,
                dto.referenceFileContentType,
            )
            : undefined;
    try {
        const resolved = await fiscalService.resolveDate(tenantId, new Date(dto.postingDate));
        if (resolved) {
            fiscalPeriodId = resolved.periodId as any;
            fiscalYearId = resolved.fiscalYearId;
        }
    } catch { /* ignore */ }

    const receipt = await ARReceipt.create({
        tenantId,
        receiptNo,
        customerId: new Types.ObjectId(dto.customerId),
        customerName: customer.name,
        status: 'DRAFT',
        receiptDate: new Date(dto.receiptDate),
        postingDate: new Date(dto.postingDate),
        fiscalPeriodId,
        fiscalYearId,
        method: dto.method,
        bankAccountId: new Types.ObjectId(dto.bankAccountId),
        arAccountId: new Types.ObjectId(dto.arAccountId),
        currencyCode: baseCurrency,
        memo: dto.memo,
        amount: dto.amount,
        allocatedAmount,
        unallocatedAmount: Math.round((dto.amount - allocatedAmount) * 100) / 100,
        allocations: dto.allocations.map(a => ({
            invoiceId: new Types.ObjectId(a.invoiceId),
            invoiceNo: a.invoiceNo,
            allocatedAmount: a.allocatedAmount,
        })),
        referenceDocument,
    });

    return mapReceipt(receipt.toObject());
};

// ─── Update (DRAFT only) ──────────────────────────────────────────────────────

export const update = async (id: string, dto: UpdateARReceiptDTO, tenantId: string) => {
    const receipt = await ARReceipt.findOne({ _id: id, tenantId, isDeleted: false });
    if (!receipt) throw new ServiceError('Receipt not found', 'NOT_FOUND');
    if (receipt.status !== 'DRAFT') throw new ServiceError('Only DRAFT receipts can be updated', 'INVALID_STATUS');

    if (dto.receiptDate) receipt.receiptDate = new Date(dto.receiptDate);
    if (dto.postingDate) {
        receipt.postingDate = new Date(dto.postingDate);
        try {
            const resolved = await fiscalService.resolveDate(tenantId, receipt.postingDate);
            if (resolved) {
                receipt.fiscalPeriodId = resolved.periodId as any;
                receipt.fiscalYearId = resolved.fiscalYearId;
            }
        } catch { /* ignore */ }
    }
    if (dto.method) receipt.method = dto.method;
    if (dto.bankAccountId) receipt.bankAccountId = new Types.ObjectId(dto.bankAccountId);
    if (dto.arAccountId) receipt.arAccountId = new Types.ObjectId(dto.arAccountId);
    if (dto.amount !== undefined) receipt.amount = dto.amount;
    if (dto.memo !== undefined) receipt.memo = dto.memo;
    if (dto.allocations) {
        receipt.allocations = dto.allocations.map(a => ({
            invoiceId: new Types.ObjectId(a.invoiceId),
            invoiceNo: a.invoiceNo,
            allocatedAmount: a.allocatedAmount,
        }));
        receipt.allocatedAmount = dto.allocations.reduce((s, a) => s + a.allocatedAmount, 0);
    }
    if (dto.referenceFileName && dto.referenceFileBase64) {
        receipt.referenceDocument = await saveReceiptReference(
            tenantId,
            receipt.receiptNo,
            dto.referenceFileName,
            dto.referenceFileBase64,
            dto.referenceFileContentType,
        ) as any;
    }
    receipt.unallocatedAmount = Math.round((receipt.amount - receipt.allocatedAmount) * 100) / 100;

    return mapReceipt((await receipt.save()).toObject());
};

// ─── Post → Journal Entry + update invoice balances ───────────────────────────

export const post = async (id: string, tenantId: string) => {
    const receipt = await ARReceipt.findOne({ _id: id, tenantId, isDeleted: false });
    if (!receipt) throw new ServiceError('Receipt not found', 'NOT_FOUND');
    if (receipt.status === 'POSTED') return mapReceipt(receipt.toObject());

    // DR Bank/Cash, CR AR Control
    const je = await createAndPostDirectly(tenantId, {
        entryType: 'AR Receipt',
        postingDate: receipt.postingDate,
        description: `AR Receipt ${receipt.receiptNo} - ${receipt.customerName}`,
        reference: receipt.receiptNo,
        sourceType: 'AR_RECEIPT',
        sourceId: receipt._id.toString(),
        sourceNo: receipt.receiptNo,
        lines: [
            {
                accountId: receipt.bankAccountId.toString(),
                debit: receipt.amount,
                credit: 0,
                description: `Receipt ${receipt.receiptNo}`,
            },
            {
                accountId: receipt.arAccountId.toString(),
                debit: 0,
                credit: receipt.amount,
                description: `Receipt ${receipt.receiptNo}`,
            },
        ],
    });

    // Update AR invoice balances
    for (const alloc of receipt.allocations) {
        const invoice = await ARInvoice.findOne({ _id: alloc.invoiceId, tenantId });
        if (invoice) {
            invoice.amountReceived = Math.round((invoice.amountReceived + alloc.allocatedAmount) * 100) / 100;
            invoice.balance = Math.round((invoice.totals.total - invoice.amountReceived) * 100) / 100;
            await invoice.save();
        }
    }

    receipt.status = 'POSTED';
    receipt.journalEntryId = je._id as any;
    receipt.journalEntryNo = je.entryNo;

    return mapReceipt((await receipt.save()).toObject());
};

// ─── List ─────────────────────────────────────────────────────────────────────

export const list = async (query: any, tenantId: string) => {
    const filter: any = { tenantId, isDeleted: false };
    if (query.status && query.status !== 'ALL') filter.status = query.status;
    if (query.method && query.method !== 'ALL') filter.method = query.method;
    if (query.customerId) filter.customerId = new Types.ObjectId(query.customerId);
    if (query.dateFrom || query.dateTo) {
        filter.postingDate = {};
        if (query.dateFrom) {
            const fromDate = new Date(query.dateFrom);
            if (!Number.isNaN(fromDate.getTime())) {
                filter.postingDate.$gte = fromDate;
            }
        }
        if (query.dateTo) {
            const toDate = new Date(query.dateTo);
            if (!Number.isNaN(toDate.getTime())) {
                toDate.setHours(23, 59, 59, 999);
                filter.postingDate.$lte = toDate;
            }
        }
        if (!filter.postingDate.$gte && !filter.postingDate.$lte) {
            delete filter.postingDate;
        }
    }
    if (query.search) {
        const regex = { $regex: query.search, $options: 'i' };
        filter.$or = [{ receiptNo: regex }, { customerName: regex }];
    }

    const page = Math.max(1, parseInt(query.page || '1', 10));
    const limit = Math.max(1, parseInt(query.limit || '50', 10));
    const [data, total] = await Promise.all([
        ARReceipt.find(filter).sort({ postingDate: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        ARReceipt.countDocuments(filter),
    ]);

    return { data: data.map(mapReceipt), meta: { total, page, limit, pages: Math.ceil(total / limit) } };
};

export const getById = async (id: string, tenantId: string) => {
    const r = await ARReceipt.findOne({ _id: id, tenantId, isDeleted: false });
    if (!r) throw new ServiceError('Receipt not found', 'NOT_FOUND');
    return mapReceipt(r.toObject());
};

export const getOutstandingInvoices = async (customerId: string, tenantId: string) => {
    const invoices = await ARInvoice.find({
        tenantId,
        customerId: new Types.ObjectId(customerId),
        status: 'POSTED',
        isDeleted: false,
        balance: { $gt: 0 },
    }).lean();

    return invoices.map(inv => ({
        invoiceId: inv._id.toString(),
        invoiceNo: inv.invoiceNo,
        postingDate: inv.postingDate instanceof Date ? inv.postingDate.toISOString().split('T')[0] : inv.postingDate,
        total: inv.totals.total,
        received: inv.amountReceived,
        outstanding: inv.balance,
    }));
};

export const remove = async (id: string, tenantId: string) => {
    const receipt = await ARReceipt.findOne({ _id: id, tenantId, isDeleted: false });
    if (!receipt) throw new ServiceError('Receipt not found', 'NOT_FOUND');
    if (receipt.status !== 'DRAFT') throw new ServiceError('Only DRAFT receipts can be deleted', 'INVALID_STATUS');
    receipt.isDeleted = true;
    await receipt.save();
};

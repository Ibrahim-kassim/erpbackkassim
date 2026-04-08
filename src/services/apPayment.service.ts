import { Types } from 'mongoose';
import { APPayment } from '../models/apPayment.model';
import { APInvoice } from '../models/apInvoice.model';
import { BusinessPartner } from '../models/businessPartner.model';
import { Counter } from '../models/counter.model';
import { fiscalService } from './fiscal.service';
import { createAndPostDirectly } from './journalEntry.service';
import { getTenantBaseCurrency } from './systemConfig.defaults';
import { CreateAPPaymentDTO, UpdateAPPaymentDTO } from '../validators/apPayment.schema';

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

const getNextPaymentNo = async (tenantId: string): Promise<string> => {
    const ret = await Counter.findOneAndUpdate(
        { tenantId, key: 'AP_PAYMENT' },
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
    );
    return `APPMT-${ret.seq.toString().padStart(6, '0')}`;
};

const mapPayment = (p: any) => ({
    id: p._id?.toString() || p.id,
    paymentNo: p.paymentNo,
    vendorId: p.vendorId?.toString(),
    vendorName: p.vendorName,
    status: p.status,
    paymentDate: p.paymentDate instanceof Date ? p.paymentDate.toISOString().split('T')[0] : p.paymentDate,
    postingDate: p.postingDate instanceof Date ? p.postingDate.toISOString().split('T')[0] : p.postingDate,
    fiscalPeriodId: p.fiscalPeriodId?.toString(),
    method: p.method,
    apAccountId: p.apAccountId?.toString(),
    paymentAccountId: p.paymentAccountId?.toString(),
    currencyCode: p.currencyCode,
    memo: p.memo,
    amount: p.amount,
    allocatedAmount: p.allocatedAmount,
    unallocatedAmount: p.unallocatedAmount,
    allocations: (p.allocations || []).map((a: any) => ({
        id: a._id?.toString() || a.invoiceId?.toString(),
        invoiceId: a.invoiceId?.toString(),
        invoiceNo: a.invoiceNo,
        allocatedAmount: a.allocatedAmount,
    })),
    journalEntryId: p.journalEntryId?.toString(),
    journalEntryNo: p.journalEntryNo,
    createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : p.createdAt,
    updatedAt: p.updatedAt instanceof Date ? p.updatedAt.toISOString() : p.updatedAt,
});

// ─── Create (DRAFT) ───────────────────────────────────────────────────────────

export const create = async (dto: CreateAPPaymentDTO, tenantId: string) => {
    const vendor = await BusinessPartner.findOne({ _id: dto.vendorId, tenantId, isDeleted: false });
    if (!vendor) throw new ServiceError('Vendor not found', 'NOT_FOUND');
    const baseCurrency = await getTenantBaseCurrency(tenantId);

    const paymentNo = await getNextPaymentNo(tenantId);

    const allocatedAmount = dto.allocations.reduce((s, a) => s + a.allocatedAmount, 0);
    const unallocatedAmount = Math.round((dto.amount - allocatedAmount) * 100) / 100;

    let fiscalPeriodId: Types.ObjectId | undefined;
    let fiscalYearId: Types.ObjectId | undefined;
    try {
        const resolved = await fiscalService.resolveDate(tenantId, new Date(dto.postingDate));
        if (resolved) {
            fiscalPeriodId = resolved.periodId as any;
            fiscalYearId = resolved.fiscalYearId;
        }
    } catch { /* ignore for DRAFT */ }

    const payment = await APPayment.create({
        tenantId,
        paymentNo,
        vendorId: new Types.ObjectId(dto.vendorId),
        vendorName: vendor.name,
        status: 'DRAFT',
        paymentDate: new Date(dto.paymentDate),
        postingDate: new Date(dto.postingDate),
        fiscalPeriodId,
        fiscalYearId,
        method: dto.method,
        apAccountId: new Types.ObjectId(dto.apAccountId),
        paymentAccountId: new Types.ObjectId(dto.paymentAccountId),
        currencyCode: baseCurrency,
        memo: dto.memo,
        amount: dto.amount,
        allocatedAmount,
        unallocatedAmount,
        allocations: dto.allocations.map(a => ({
            invoiceId: new Types.ObjectId(a.invoiceId),
            invoiceNo: a.invoiceNo,
            allocatedAmount: a.allocatedAmount,
        })),
    });

    return mapPayment(payment.toObject());
};

// ─── Update (DRAFT only) ──────────────────────────────────────────────────────

export const update = async (id: string, dto: UpdateAPPaymentDTO, tenantId: string) => {
    const payment = await APPayment.findOne({ _id: id, tenantId, isDeleted: false });
    if (!payment) throw new ServiceError('Payment not found', 'NOT_FOUND');
    if (payment.status !== 'DRAFT') throw new ServiceError('Only DRAFT payments can be updated', 'INVALID_STATUS');

    if (dto.paymentDate) payment.paymentDate = new Date(dto.paymentDate);
    if (dto.postingDate) {
        payment.postingDate = new Date(dto.postingDate);
        try {
            const resolved = await fiscalService.resolveDate(tenantId, payment.postingDate);
            if (resolved) {
                payment.fiscalPeriodId = resolved.periodId as any;
                payment.fiscalYearId = resolved.fiscalYearId;
            }
        } catch { /* ignore */ }
    }
    if (dto.method) payment.method = dto.method;
    if (dto.apAccountId) payment.apAccountId = new Types.ObjectId(dto.apAccountId);
    if (dto.paymentAccountId) payment.paymentAccountId = new Types.ObjectId(dto.paymentAccountId);
    if (dto.amount !== undefined) payment.amount = dto.amount;
    if (dto.memo !== undefined) payment.memo = dto.memo;

    if (dto.allocations) {
        payment.allocations = dto.allocations.map(a => ({
            invoiceId: new Types.ObjectId(a.invoiceId),
            invoiceNo: a.invoiceNo,
            allocatedAmount: a.allocatedAmount,
        }));
        payment.allocatedAmount = dto.allocations.reduce((s, a) => s + a.allocatedAmount, 0);
    }

    payment.unallocatedAmount = Math.round((payment.amount - payment.allocatedAmount) * 100) / 100;

    return mapPayment((await payment.save()).toObject());
};

// ─── Post → Journal Entry + update invoice balances ───────────────────────────

export const post = async (id: string, tenantId: string) => {
    const payment = await APPayment.findOne({ _id: id, tenantId, isDeleted: false });
    if (!payment) throw new ServiceError('Payment not found', 'NOT_FOUND');
    if (payment.status === 'POSTED') return mapPayment(payment.toObject());
    if (payment.status !== 'DRAFT') throw new ServiceError('Only DRAFT payments can be posted', 'INVALID_STATUS');

    // DR AP Control, CR Bank/Cash
    const je = await createAndPostDirectly(tenantId, {
        entryType: 'AP Payment',
        postingDate: payment.postingDate,
        description: `AP Payment ${payment.paymentNo} - ${payment.vendorName}`,
        reference: payment.paymentNo,
        sourceType: 'AP_PAYMENT',
        sourceId: payment._id.toString(),
        sourceNo: payment.paymentNo,
        lines: [
            {
                accountId: payment.apAccountId.toString(),
                debit: payment.amount,
                credit: 0,
                description: `Payment ${payment.paymentNo}`,
            },
            {
                accountId: payment.paymentAccountId.toString(),
                debit: 0,
                credit: payment.amount,
                description: `Payment ${payment.paymentNo}`,
            },
        ],
    });

    // Update invoice balances for each allocation
    for (const alloc of payment.allocations) {
        const invoice = await APInvoice.findOne({ _id: alloc.invoiceId, tenantId });
        if (invoice) {
            invoice.amountPaid = Math.round((invoice.amountPaid + alloc.allocatedAmount) * 100) / 100;
            invoice.balance = Math.round((invoice.totals.total - invoice.amountPaid) * 100) / 100;
            await invoice.save();
        }
    }

    payment.status = 'POSTED';
    payment.journalEntryId = je._id as any;
    payment.journalEntryNo = je.entryNo;

    return mapPayment((await payment.save()).toObject());
};

// ─── List ─────────────────────────────────────────────────────────────────────

export const list = async (query: any, tenantId: string) => {
    const filter: any = { tenantId, isDeleted: false };
    if (query.status && query.status !== 'ALL') filter.status = query.status;
    if (query.vendorId) filter.vendorId = new Types.ObjectId(query.vendorId);
    if (query.method && query.method !== 'ALL') filter.method = query.method;

    if (query.dateFrom || query.dateTo) {
        filter.postingDate = {};
        if (query.dateFrom) filter.postingDate.$gte = new Date(`${query.dateFrom}T00:00:00.000Z`);
        if (query.dateTo) filter.postingDate.$lte = new Date(`${query.dateTo}T23:59:59.999Z`);
    }

    const minAmount = Number(query.minAmount);
    const maxAmount = Number(query.maxAmount);
    if (!Number.isNaN(minAmount) || !Number.isNaN(maxAmount)) {
        filter.amount = {};
        if (!Number.isNaN(minAmount)) filter.amount.$gte = minAmount;
        if (!Number.isNaN(maxAmount)) filter.amount.$lte = maxAmount;
    }

    if (query.search) {
        const regex = { $regex: query.search, $options: 'i' };
        filter.$or = [{ paymentNo: regex }, { vendorName: regex }];
    }

    const page = parseInt(query.page || '1');
    const limit = parseInt(query.limit || '50');
    const [data, total] = await Promise.all([
        APPayment.find(filter).sort({ postingDate: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        APPayment.countDocuments(filter),
    ]);

    return { data: data.map(mapPayment), meta: { total, page, limit, pages: Math.ceil(total / limit) } };
};

// ─── Get by ID ────────────────────────────────────────────────────────────────

export const getById = async (id: string, tenantId: string) => {
    const p = await APPayment.findOne({ _id: id, tenantId, isDeleted: false });
    if (!p) throw new ServiceError('Payment not found', 'NOT_FOUND');
    return mapPayment(p.toObject());
};

// ─── Get outstanding bills for a vendor ──────────────────────────────────────

export const getOutstandingBills = async (vendorId: string, tenantId: string) => {
    const invoices = await APInvoice.find({
        tenantId,
        vendorId: new Types.ObjectId(vendorId),
        status: 'POSTED',
        isDeleted: false,
        balance: { $gt: 0 },
    }).lean();

    return invoices.map(inv => ({
        invoiceId: inv._id.toString(),
        invoiceNo: inv.invoiceNo,
        postingDate: inv.postingDate instanceof Date ? inv.postingDate.toISOString().split('T')[0] : inv.postingDate,
        total: inv.totals.total,
        paid: inv.amountPaid,
        outstanding: inv.balance,
    }));
};

// ─── Soft delete ──────────────────────────────────────────────────────────────

export const remove = async (id: string, tenantId: string) => {
    const payment = await APPayment.findOne({ _id: id, tenantId, isDeleted: false });
    if (!payment) throw new ServiceError('Payment not found', 'NOT_FOUND');
    if (payment.status !== 'DRAFT') throw new ServiceError('Only DRAFT payments can be deleted', 'INVALID_STATUS');
    payment.isDeleted = true;
    await payment.save();
};

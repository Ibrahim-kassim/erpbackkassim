import { Types } from 'mongoose';
import { APInvoice } from '../models/apInvoice.model';
import { APPayment } from '../models/apPayment.model';
import { BusinessPartner } from '../models/businessPartner.model';
import { ChartOfAccount, NormalBalance } from '../models/chartOfAccount.model';
import { EntryStatus, JournalEntry } from '../models/journalEntry.model';

// ─── AP Aging Report ──────────────────────────────────────────────────────────

const agingBucket = (invoice: any, today: Date) => {
    const due = new Date(invoice.dueDate || invoice.postingDate);
    const days = Math.floor((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
    const bal = invoice.balance ?? invoice.totals?.total ?? 0;

    return {
        current: days <= 0 ? bal : 0,
        days1_30: days >= 1 && days <= 30 ? bal : 0,
        days31_60: days >= 31 && days <= 60 ? bal : 0,
        days61_90: days >= 61 && days <= 90 ? bal : 0,
        days90plus: days > 90 ? bal : 0,
        total: bal,
        daysPastDue: days,
    };
};

export const getAPAging = async (tenantId: string, vendorId?: string, asOfDate?: string, includeZeroBalances = false) => {
    const filter: any = { tenantId, status: 'POSTED', isDeleted: false };
    if (!includeZeroBalances) {
        filter.balance = { $gt: 0 };
    }
    if (vendorId) filter.vendorId = new Types.ObjectId(vendorId);

    const invoices = await APInvoice.find(filter).lean();
    const parsedAsOfDate = asOfDate ? new Date(asOfDate) : null;
    const today = parsedAsOfDate && !Number.isNaN(parsedAsOfDate.getTime()) ? parsedAsOfDate : new Date();

    // Group by vendor
    const vendorMap = new Map<string, any>();

    for (const inv of invoices) {
        const vId = inv.vendorId.toString();
        const buckets = agingBucket(inv, today);
        const { total: outstandingTotal, daysPastDue, ...bucketAmounts } = buckets;

        if (!vendorMap.has(vId)) {
            vendorMap.set(vId, {
                vendorId: vId,
                vendorName: inv.vendorName,
                current: 0, days1_30: 0, days31_60: 0, days61_90: 0, days90plus: 0, total: 0,
                invoices: [],
            });
        }

        const entry = vendorMap.get(vId);
        entry.current += buckets.current;
        entry.days1_30 += buckets.days1_30;
        entry.days31_60 += buckets.days31_60;
        entry.days61_90 += buckets.days61_90;
        entry.days90plus += buckets.days90plus;
        entry.total += buckets.total;
        entry.invoices.push({
            invoiceId: inv._id.toString(),
            invoiceNo: inv.invoiceNo,
            invoiceDate: inv.invoiceDate,
            dueDate: inv.dueDate,
            ...bucketAmounts,
            total: inv.totals.total,
            amountPaid: inv.amountPaid,
            balance: outstandingTotal,
            daysPastDue,
        });
    }

    const rows = Array.from(vendorMap.values()).map(v => ({
        ...v,
        current: Math.round(v.current * 100) / 100,
        days1_30: Math.round(v.days1_30 * 100) / 100,
        days31_60: Math.round(v.days31_60 * 100) / 100,
        days61_90: Math.round(v.days61_90 * 100) / 100,
        days90plus: Math.round(v.days90plus * 100) / 100,
        total: Math.round(v.total * 100) / 100,
    }));

    const summary = {
        current: rows.reduce((s, r) => s + r.current, 0),
        days1_30: rows.reduce((s, r) => s + r.days1_30, 0),
        days31_60: rows.reduce((s, r) => s + r.days31_60, 0),
        days61_90: rows.reduce((s, r) => s + r.days61_90, 0),
        days90plus: rows.reduce((s, r) => s + r.days90plus, 0),
        total: rows.reduce((s, r) => s + r.total, 0),
    };

    return { rows, summary };
};

export const getAPReconciliationStats = async (tenantId: string, asOfDate: string | undefined, apAccountId: string) => {
    const accountObjectId = new Types.ObjectId(apAccountId);

    const account = await ChartOfAccount.findOne({
        _id: accountObjectId,
        tenantId,
        isPosting: true,
        isActive: true,
    })
        .select('normalBalance')
        .lean();

    if (!account) {
        return { glBalance: 0, agingTotal: 0, difference: 0, status: 'MATCHED' as const };
    }

    const parsedAsOfDate = asOfDate ? new Date(asOfDate) : null;
    const safeAsOfDate = parsedAsOfDate && !Number.isNaN(parsedAsOfDate.getTime()) ? parsedAsOfDate : new Date();
    safeAsOfDate.setHours(23, 59, 59, 999);

    const [agingAgg, glAgg] = await Promise.all([
        APInvoice.aggregate([
            {
                $match: {
                    tenantId,
                    status: 'POSTED',
                    isDeleted: false,
                    postingDate: { $lte: safeAsOfDate },
                    'accounting.apAccountId': accountObjectId,
                },
            },
            {
                $group: {
                    _id: null,
                    totalOutstanding: { $sum: { $ifNull: ['$balance', 0] } },
                },
            },
        ]),
        JournalEntry.aggregate([
            {
                $match: {
                    tenantId,
                    status: EntryStatus.POSTED,
                    postingDate: { $lte: safeAsOfDate },
                },
            },
            { $unwind: '$lines' },
            { $match: { 'lines.accountId': accountObjectId } },
            {
                $group: {
                    _id: null,
                    debitTotal: { $sum: { $ifNull: ['$lines.debit', 0] } },
                    creditTotal: { $sum: { $ifNull: ['$lines.credit', 0] } },
                },
            },
        ]),
    ]);

    const agingTotalRaw = agingAgg[0]?.totalOutstanding ?? 0;
    const debitTotal = glAgg[0]?.debitTotal ?? 0;
    const creditTotal = glAgg[0]?.creditTotal ?? 0;

    const glBalanceRaw =
        account.normalBalance === NormalBalance.CREDIT
            ? creditTotal - debitTotal
            : debitTotal - creditTotal;

    const agingTotal = Math.round(agingTotalRaw * 100) / 100;
    const glBalance = Math.round(glBalanceRaw * 100) / 100;
    const difference = Math.round((glBalance - agingTotal) * 100) / 100;
    const status = Math.abs(difference) <= 0.01 ? 'MATCHED' : 'MISMATCH';

    return { glBalance, agingTotal, difference, status };
};

// ─── Vendor Statement ─────────────────────────────────────────────────────────

export const getVendorStatement = async (tenantId: string, vendorId: string, asOfDate?: string, fromDate?: string) => {
    const vendorObjectId = new Types.ObjectId(vendorId);
    const parsedAsOf = asOfDate ? new Date(asOfDate) : new Date();
    const safeAsOf = Number.isNaN(parsedAsOf.getTime()) ? new Date() : parsedAsOf;
    safeAsOf.setHours(23, 59, 59, 999);

    const parsedFrom = fromDate ? new Date(fromDate) : null;
    const safeFrom = parsedFrom && !Number.isNaN(parsedFrom.getTime()) ? parsedFrom : null;
    if (safeFrom) safeFrom.setHours(0, 0, 0, 0);

    const [invoices, payments, vendor] = await Promise.all([
        APInvoice.find({
            tenantId,
            vendorId: vendorObjectId,
            status: 'POSTED',
            isDeleted: false,
            postingDate: { $lte: safeAsOf },
        })
            .sort({ postingDate: 1, createdAt: 1 })
            .lean(),
        APPayment.find({
            tenantId,
            vendorId: vendorObjectId,
            status: 'POSTED',
            isDeleted: false,
            postingDate: { $lte: safeAsOf },
        })
            .sort({ postingDate: 1, createdAt: 1 })
            .lean(),
        BusinessPartner.findOne({ _id: vendorId, tenantId }).lean(),
    ]);

    type StatementEvent = {
        date: Date;
        type: 'BILL' | 'PAYMENT';
        docId: string;
        docNo: string;
        description: string;
        debit: number;
        credit: number;
        journalEntryId?: string;
    };

    const events: StatementEvent[] = [
        ...invoices.map((inv) => ({
            date: new Date(inv.postingDate),
            type: 'BILL' as const,
            docId: inv._id.toString(),
            docNo: inv.invoiceNo,
            description: `Vendor Bill - ${inv.vendorName}`,
            debit: Math.round((inv.totals?.total || 0) * 100) / 100,
            credit: 0,
            journalEntryId: inv.journalEntryId?.toString(),
        })),
        ...payments.map((pay) => ({
            date: new Date(pay.postingDate),
            type: 'PAYMENT' as const,
            docId: pay._id.toString(),
            docNo: pay.paymentNo,
            description: `Payment - ${pay.method}`,
            debit: 0,
            credit: Math.round((pay.amount || 0) * 100) / 100,
            journalEntryId: pay.journalEntryId?.toString(),
        })),
    ].sort((a, b) => a.date.getTime() - b.date.getTime());

    let runningBalance = 0;
    let totalBills = 0;
    let totalPayments = 0;

    const lines = events
        .map((ev) => {
            runningBalance = Math.round((runningBalance + ev.debit - ev.credit) * 100) / 100;
            return {
                id: `${ev.type}-${ev.docId}`,
                type: ev.type,
                docId: ev.docId,
                docNo: ev.docNo,
                postingDate: ev.date.toISOString().split('T')[0],
                description: ev.description,
                debit: ev.debit,
                credit: ev.credit,
                amountSigned: Math.round((ev.debit - ev.credit) * 100) / 100,
                runningBalance,
                journalEntryId: ev.journalEntryId,
                status: 'POSTED',
            };
        })
        .filter((line) => {
            if (!safeFrom) return true;
            return new Date(line.postingDate).getTime() >= safeFrom.getTime();
        });

    for (const line of lines) {
        totalBills += line.debit;
        totalPayments += line.credit;
    }

    const openInvoicesCount = invoices.filter((inv) => (inv.balance || 0) > 0.009).length;

    return {
        vendor: vendor
            ? { id: vendor._id.toString(), name: vendor.name, code: vendor.code }
            : { id: vendorId, name: 'Unknown', code: '' },
        rows: lines,
        summary: {
            vendorId,
            vendorName: vendor?.name || 'Unknown',
            asOfDate: safeAsOf.toISOString().split('T')[0],
            totalBills: Math.round(totalBills * 100) / 100,
            totalPayments: Math.round(totalPayments * 100) / 100,
            closingBalance: Math.round(runningBalance * 100) / 100,
            openInvoicesCount,
        },
    };
};

export const getVendorAllocations = async (tenantId: string, vendorId: string, asOfDate?: string) => {
    const vendorObjectId = new Types.ObjectId(vendorId);
    const parsedAsOf = asOfDate ? new Date(asOfDate) : new Date();
    const safeAsOf = Number.isNaN(parsedAsOf.getTime()) ? new Date() : parsedAsOf;
    safeAsOf.setHours(23, 59, 59, 999);

    const [invoices, payments] = await Promise.all([
        APInvoice.find({
            tenantId,
            vendorId: vendorObjectId,
            status: 'POSTED',
            isDeleted: false,
            postingDate: { $lte: safeAsOf },
        })
            .sort({ postingDate: 1, createdAt: 1 })
            .lean(),
        APPayment.find({
            tenantId,
            vendorId: vendorObjectId,
            status: 'POSTED',
            isDeleted: false,
            postingDate: { $lte: safeAsOf },
        })
            .sort({ postingDate: 1, createdAt: 1 })
            .lean(),
    ]);

    return invoices.map((invoice) => {
        const allocations = payments.flatMap((payment) =>
            (payment.allocations || [])
                .filter((allocation: any) => allocation.invoiceId?.toString() === invoice._id.toString())
                .map((allocation: any) => ({
                    paymentId: payment._id.toString(),
                    paymentNo: payment.paymentNo,
                    paymentPostingDate: payment.postingDate instanceof Date ? payment.postingDate.toISOString().split('T')[0] : String(payment.postingDate),
                    allocatedAmount: Math.round((allocation.allocatedAmount || 0) * 100) / 100,
                    journalEntryId: payment.journalEntryId?.toString(),
                }))
        );

        const paid = allocations.reduce((sum, allocation) => sum + allocation.allocatedAmount, 0);
        const total = Math.round((invoice.totals?.total || 0) * 100) / 100;
        const outstanding = Math.max(0, Math.round((total - paid) * 100) / 100);

        return {
            invoiceId: invoice._id.toString(),
            invoiceNo: invoice.invoiceNo,
            invoicePostingDate: invoice.postingDate instanceof Date ? invoice.postingDate.toISOString().split('T')[0] : String(invoice.postingDate),
            total,
            paid: Math.round(paid * 100) / 100,
            outstanding,
            allocations,
        };
    });
};

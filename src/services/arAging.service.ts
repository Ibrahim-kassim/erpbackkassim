import { Types } from 'mongoose';
import { ARInvoice } from '../models/arInvoice.model';
import { ARReceipt } from '../models/arReceipt.model';
import { BusinessPartner } from '../models/businessPartner.model';

// ─── AR Aging ─────────────────────────────────────────────────────────────────

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

export const getARAging = async (tenantId: string, customerId?: string, asOfDate?: string, includeZeroBalances = false) => {
    const filter: any = { tenantId, status: 'POSTED', isDeleted: false };
    if (!includeZeroBalances) {
        filter.balance = { $gt: 0 };
    }
    if (customerId) filter.customerId = new Types.ObjectId(customerId);

    const parsedAsOfDate = asOfDate ? new Date(asOfDate) : null;
    const today = parsedAsOfDate && !Number.isNaN(parsedAsOfDate.getTime()) ? parsedAsOfDate : new Date();
    today.setHours(23, 59, 59, 999);
    filter.postingDate = { $lte: today };

    const invoices = await ARInvoice.find(filter).lean();

    const customerMap = new Map<string, any>();

    for (const inv of invoices) {
        const cId = inv.customerId.toString();
        const buckets = agingBucket(inv, today);
        const { total: outstandingTotal, daysPastDue, ...bucketAmounts } = buckets;

        if (!customerMap.has(cId)) {
            customerMap.set(cId, {
                customerId: cId,
                customerName: inv.customerName,
                current: 0, days1_30: 0, days31_60: 0, days61_90: 0, days90plus: 0, total: 0,
                invoices: [],
            });
        }

        const entry = customerMap.get(cId);
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
            amountReceived: inv.amountReceived,
            balance: outstandingTotal,
            daysPastDue,
        });
    }

    const rows = Array.from(customerMap.values()).map(c => ({
        ...c,
        current: Math.round(c.current * 100) / 100,
        days1_30: Math.round(c.days1_30 * 100) / 100,
        days31_60: Math.round(c.days31_60 * 100) / 100,
        days61_90: Math.round(c.days61_90 * 100) / 100,
        days90plus: Math.round(c.days90plus * 100) / 100,
        total: Math.round(c.total * 100) / 100,
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

// ─── Customer Statement ───────────────────────────────────────────────────────

export const getCustomerStatement = async (tenantId: string, customerId: string, asOfDate?: string, fromDate?: string) => {
    const customerObjectId = new Types.ObjectId(customerId);
    const parsedAsOf = asOfDate ? new Date(asOfDate) : new Date();
    const safeAsOf = Number.isNaN(parsedAsOf.getTime()) ? new Date() : parsedAsOf;
    safeAsOf.setHours(23, 59, 59, 999);

    const parsedFrom = fromDate ? new Date(fromDate) : null;
    const safeFrom = parsedFrom && !Number.isNaN(parsedFrom.getTime()) ? parsedFrom : null;
    if (safeFrom) safeFrom.setHours(0, 0, 0, 0);

    const [invoices, receipts, customer] = await Promise.all([
        ARInvoice.find({
            tenantId,
            customerId: customerObjectId,
            status: 'POSTED',
            isDeleted: false,
            postingDate: { $lte: safeAsOf },
        })
            .sort({ postingDate: 1, createdAt: 1 })
            .lean(),
        ARReceipt.find({
            tenantId,
            customerId: customerObjectId,
            status: 'POSTED',
            isDeleted: false,
            postingDate: { $lte: safeAsOf },
        })
            .sort({ postingDate: 1, createdAt: 1 })
            .lean(),
        BusinessPartner.findOne({ _id: customerId, tenantId }).lean(),
    ]);

    type StatementEvent = {
        date: Date;
        type: 'INVOICE' | 'RECEIPT';
        docId: string;
        docNo: string;
        description: string;
        debit: number;
        credit: number;
        journalEntryId?: string;
    };

    const events: StatementEvent[] = [
        ...invoices.map((invoice) => ({
            date: new Date(invoice.postingDate),
            type: 'INVOICE' as const,
            docId: invoice._id.toString(),
            docNo: invoice.invoiceNo,
            description: `Customer Invoice - ${invoice.customerName}`,
            debit: Math.round((invoice.totals?.total || 0) * 100) / 100,
            credit: 0,
            journalEntryId: invoice.journalEntryId?.toString(),
        })),
        ...receipts.map((receipt) => ({
            date: new Date(receipt.postingDate),
            type: 'RECEIPT' as const,
            docId: receipt._id.toString(),
            docNo: receipt.receiptNo,
            description: `Payment Received - ${receipt.method}`,
            debit: 0,
            credit: Math.round((receipt.amount || 0) * 100) / 100,
            journalEntryId: receipt.journalEntryId?.toString(),
        })),
    ].sort((a, b) => a.date.getTime() - b.date.getTime());

    let runningBalance = 0;
    const rows = events
        .map((event) => {
            runningBalance = Math.round((runningBalance + event.debit - event.credit) * 100) / 100;
            return {
                id: `${event.type}-${event.docId}`,
                type: event.type,
                customerId,
                customerName: customer?.name || 'Unknown',
                docId: event.docId,
                docNo: event.docNo,
                postingDate: event.date.toISOString().split('T')[0],
                debit: event.debit,
                credit: event.credit,
                signedAmount: Math.round((event.debit - event.credit) * 100) / 100,
                runningBalance,
                journalEntryId: event.journalEntryId,
                status: 'POSTED',
            };
        })
        .filter((line) => {
            if (!safeFrom) return true;
            return new Date(line.postingDate).getTime() >= safeFrom.getTime();
        });

    const totalInvoices = rows.reduce((sum, row) => sum + row.debit, 0);
    const totalReceipts = rows.reduce((sum, row) => sum + row.credit, 0);
    const closingBalance = rows.length ? rows[rows.length - 1].runningBalance : 0;
    const openInvoicesCount = invoices.filter((invoice) => (invoice.balance || 0) > 0.009).length;

    return {
        customer: customer
            ? { id: customer._id.toString(), name: customer.name, code: customer.code }
            : { id: customerId, name: 'Unknown', code: '' },
        rows,
        summary: {
            customerId,
            customerName: customer?.name || 'Unknown',
            asOfDate: safeAsOf.toISOString().split('T')[0],
            totalInvoices: Math.round(totalInvoices * 100) / 100,
            totalReceipts: Math.round(totalReceipts * 100) / 100,
            closingBalance: Math.round(closingBalance * 100) / 100,
            openInvoicesCount,
        },
    };
};

export const getCustomerAllocations = async (tenantId: string, customerId: string, asOfDate?: string) => {
    const customerObjectId = new Types.ObjectId(customerId);
    const parsedAsOf = asOfDate ? new Date(asOfDate) : new Date();
    const safeAsOf = Number.isNaN(parsedAsOf.getTime()) ? new Date() : parsedAsOf;
    safeAsOf.setHours(23, 59, 59, 999);

    const [invoices, receipts] = await Promise.all([
        ARInvoice.find({
            tenantId,
            customerId: customerObjectId,
            status: 'POSTED',
            isDeleted: false,
            postingDate: { $lte: safeAsOf },
        })
            .sort({ postingDate: 1, createdAt: 1 })
            .lean(),
        ARReceipt.find({
            tenantId,
            customerId: customerObjectId,
            status: 'POSTED',
            isDeleted: false,
            postingDate: { $lte: safeAsOf },
        })
            .sort({ postingDate: 1, createdAt: 1 })
            .lean(),
    ]);

    return invoices.map((invoice) => {
        const allocations = receipts.flatMap((receipt) =>
            (receipt.allocations || [])
                .filter((allocation: any) => allocation.invoiceId?.toString() === invoice._id.toString())
                .map((allocation: any) => ({
                    receiptId: receipt._id.toString(),
                    receiptNo: receipt.receiptNo,
                    receiptDate: receipt.postingDate instanceof Date ? receipt.postingDate.toISOString().split('T')[0] : String(receipt.postingDate),
                    allocatedAmount: Math.round((allocation.allocatedAmount || 0) * 100) / 100,
                }))
        );

        const received = allocations.reduce((sum, allocation) => sum + allocation.allocatedAmount, 0);
        const total = Math.round((invoice.totals?.total || 0) * 100) / 100;
        const outstanding = Math.max(0, Math.round((total - received) * 100) / 100);

        return {
            invoiceId: invoice._id.toString(),
            invoiceNo: invoice.invoiceNo,
            invoiceDate: invoice.postingDate instanceof Date ? invoice.postingDate.toISOString().split('T')[0] : String(invoice.postingDate),
            total,
            received: Math.round(received * 100) / 100,
            outstanding,
            allocations,
        };
    });
};

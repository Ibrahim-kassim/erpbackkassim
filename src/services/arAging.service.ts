import { Types } from 'mongoose';
import { ARInvoice } from '../models/arInvoice.model';
import { ARReceipt } from '../models/arReceipt.model';
import { BusinessPartner } from '../models/businessPartner.model';

// ─── AR Aging ─────────────────────────────────────────────────────────────────

const agingBucket = (invoice: any, today: Date) => {
    const due = new Date(invoice.dueDate);
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

export const getARAging = async (tenantId: string, customerId?: string) => {
    const filter: any = { tenantId, status: 'POSTED', isDeleted: false, balance: { $gt: 0 } };
    if (customerId) filter.customerId = new Types.ObjectId(customerId);

    const invoices = await ARInvoice.find(filter).lean();
    const today = new Date();

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

export const getCustomerStatement = async (tenantId: string, customerId: string) => {
    const [invoices, receipts] = await Promise.all([
        ARInvoice.find({ tenantId, customerId: new Types.ObjectId(customerId), isDeleted: false })
            .sort({ postingDate: 1 }).lean(),
        ARReceipt.find({ tenantId, customerId: new Types.ObjectId(customerId), status: 'POSTED', isDeleted: false })
            .sort({ postingDate: 1 }).lean(),
    ]);

    const customer = await BusinessPartner.findOne({ _id: customerId, tenantId }).lean();

    type StatementLine = {
        date: string; type: string; refNo: string; description: string;
        debit: number; credit: number; balance: number;
    };
    const lines: StatementLine[] = [];

    const allEvents = [
        ...invoices.map(inv => ({
            date: inv.postingDate,
            type: 'INVOICE',
            refNo: inv.invoiceNo,
            description: `Customer Invoice`,
            amount: inv.totals.total,
            isDebit: true,
        })),
        ...receipts.map(rec => ({
            date: rec.postingDate,
            type: 'RECEIPT',
            refNo: rec.receiptNo,
            description: `Payment Received - ${rec.method}`,
            amount: rec.amount,
            isDebit: false,
        })),
    ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let runningBalance = 0;
    for (const ev of allEvents) {
        const dateStr = ev.date instanceof Date ? ev.date.toISOString().split('T')[0] : String(ev.date);
        if (ev.isDebit) {
            runningBalance += ev.amount;
            lines.push({ date: dateStr, type: ev.type, refNo: ev.refNo, description: ev.description, debit: ev.amount, credit: 0, balance: Math.round(runningBalance * 100) / 100 });
        } else {
            runningBalance -= ev.amount;
            lines.push({ date: dateStr, type: ev.type, refNo: ev.refNo, description: ev.description, debit: 0, credit: ev.amount, balance: Math.round(runningBalance * 100) / 100 });
        }
    }

    return {
        customer: customer ? { id: customer._id.toString(), name: customer.name, code: customer.code } : { id: customerId, name: 'Unknown', code: '' },
        lines,
        closingBalance: Math.round(runningBalance * 100) / 100,
    };
};

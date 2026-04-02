import { Types } from 'mongoose';
import { APInvoice } from '../models/apInvoice.model';
import { APPayment } from '../models/apPayment.model';
import { BusinessPartner } from '../models/businessPartner.model';

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

export const getAPAging = async (tenantId: string, vendorId?: string) => {
    const filter: any = { tenantId, status: 'POSTED', isDeleted: false, balance: { $gt: 0 } };
    if (vendorId) filter.vendorId = new Types.ObjectId(vendorId);

    const invoices = await APInvoice.find(filter).lean();
    const today = new Date();

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

// ─── Vendor Statement ─────────────────────────────────────────────────────────

export const getVendorStatement = async (tenantId: string, vendorId: string) => {
    const [invoices, payments] = await Promise.all([
        APInvoice.find({ tenantId, vendorId: new Types.ObjectId(vendorId), isDeleted: false })
            .sort({ postingDate: 1 }).lean(),
        APPayment.find({ tenantId, vendorId: new Types.ObjectId(vendorId), status: 'POSTED', isDeleted: false })
            .sort({ postingDate: 1 }).lean(),
    ]);

    const vendor = await BusinessPartner.findOne({ _id: vendorId, tenantId }).lean();

    // Build timeline
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
            description: `Vendor Bill - ${inv.vendorName}`,
            amount: inv.totals.total,
            isCredit: true, // increases amount owed to vendor
        })),
        ...payments.map(pay => ({
            date: pay.postingDate,
            type: 'PAYMENT',
            refNo: pay.paymentNo,
            description: `Payment - ${pay.method}`,
            amount: pay.amount,
            isCredit: false, // decreases amount owed
        })),
    ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let runningBalance = 0;
    for (const ev of allEvents) {
        if (ev.isCredit) {
            runningBalance += ev.amount;
            lines.push({ date: ev.date instanceof Date ? ev.date.toISOString().split('T')[0] : String(ev.date), type: ev.type, refNo: ev.refNo, description: ev.description, debit: 0, credit: ev.amount, balance: Math.round(runningBalance * 100) / 100 });
        } else {
            runningBalance -= ev.amount;
            lines.push({ date: ev.date instanceof Date ? ev.date.toISOString().split('T')[0] : String(ev.date), type: ev.type, refNo: ev.refNo, description: ev.description, debit: ev.amount, credit: 0, balance: Math.round(runningBalance * 100) / 100 });
        }
    }

    return {
        vendor: vendor ? { id: vendor._id.toString(), name: vendor.name, code: vendor.code } : { id: vendorId, name: 'Unknown', code: '' },
        lines,
        closingBalance: Math.round(runningBalance * 100) / 100,
    };
};

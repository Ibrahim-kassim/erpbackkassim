import { APInvoice } from '../models/apInvoice.model';
import { APPayment } from '../models/apPayment.model';
import { ARInvoice } from '../models/arInvoice.model';
import { ARReceipt } from '../models/arReceipt.model';
import { GRN } from '../models/grn.model';
import { Product } from '../models/inventory/product.model';
import { Stock } from '../models/inventory/stock.model';
import { PurchaseOrder } from '../models/purchaseOrder.model';
import { RFQ } from '../models/rfq.model';
import { SystemConfig } from '../models/systemConfig.model';
import { getTenantBaseCurrency } from './systemConfig.defaults';
import type { DashboardQueryDTO } from '../validators/dashboard.schema';

type DashboardSeverity = 'critical' | 'high' | 'medium' | 'low';
type DashboardIntent = 'OVERVIEW' | 'CASH' | 'COLLECTIONS' | 'PAYABLES' | 'PROCUREMENT' | 'INVENTORY';

type DashboardActionItem = {
    id: string;
    title: string;
    detail: string;
    severity: DashboardSeverity;
    href: string;
    metric?: string;
};

type DashboardRecentActivity = {
    id: string;
    type: string;
    status: string;
    title: string;
    subtitle: string;
    amount?: number;
    occurredAt: string;
    href: string;
};

type DashboardRecommendation = {
    id: string;
    title: string;
    detail: string;
    severity: DashboardSeverity;
    href: string;
};

const LOW_STOCK_THRESHOLD = 10;

const monthStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
const nextMonthStart = (date: Date) => new Date(date.getFullYear(), date.getMonth() + 1, 1);
const addMonths = (date: Date, offset: number) => new Date(date.getFullYear(), date.getMonth() + offset, 1);
const monthKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
const monthLabel = (date: Date) => date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
const isoDate = (date: Date) => date.toISOString();

const formatMoney = (amount: number, currency: string) =>
    new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(amount);

function buildMonthSeries(monthsBack = 5) {
    const current = monthStart(new Date());
    return Array.from({ length: monthsBack + 1 }, (_, index) => {
        const date = addMonths(current, index - monthsBack);
        return {
            key: monthKey(date),
            label: monthLabel(date),
            start: date,
            end: nextMonthStart(date),
        };
    });
}

async function aggregateMonthly(
    model: any,
    tenantId: string,
    dateField: string,
    amountField: string,
    additionalMatch: Record<string, any>,
    months: ReturnType<typeof buildMonthSeries>
) {
    const firstMonth = months[0];
    const lastMonth = months[months.length - 1];

    const rows = await model.aggregate([
        {
            $match: {
                tenantId,
                isDeleted: false,
                ...additionalMatch,
                [dateField]: { $gte: firstMonth.start, $lt: lastMonth.end },
            },
        },
        {
            $group: {
                _id: {
                    year: { $year: `$${dateField}` },
                    month: { $month: `$${dateField}` },
                },
                total: { $sum: `$${amountField}` },
                count: { $sum: 1 },
            },
        },
    ]);

    const rowMap = new Map<string, { total: number; count: number }>(
        rows.map((row: any) => [
            `${row._id.year}-${String(row._id.month).padStart(2, '0')}`,
            { total: Number(row.total || 0), count: Number(row.count || 0) },
        ])
    );

    return months.map((month) => ({
        month: month.label,
        key: month.key,
        total: rowMap.get(month.key)?.total || 0,
        count: rowMap.get(month.key)?.count || 0,
    }));
}

async function buildInventorySnapshot(tenantId: string) {
    const rows = await Stock.aggregate([
        { $match: { tenantId, isDeleted: false } },
        {
            $lookup: {
                from: 'products',
                localField: 'productId',
                foreignField: '_id',
                as: 'product',
            },
        },
        { $unwind: '$product' },
        {
            $match: {
                'product.tenantId': tenantId,
                'product.isDeleted': false,
                'product.type': 'PRODUCT',
                'product.inventoryTracked': true,
            },
        },
        {
            $project: {
                quantityOnHand: 1,
                unitValue: { $ifNull: ['$product.costPrice', '$product.unitPrice'] },
            },
        },
    ]);

    return rows.reduce(
        (acc: { inventoryValue: number; lowStockCount: number; outOfStockCount: number; inStockCount: number }, row: any) => {
            const quantityOnHand = Number(row.quantityOnHand || 0);
            const unitValue = Number(row.unitValue || 0);
            acc.inventoryValue += quantityOnHand * unitValue;

            if (quantityOnHand <= 0) acc.outOfStockCount += 1;
            else if (quantityOnHand < LOW_STOCK_THRESHOLD) acc.lowStockCount += 1;
            else acc.inStockCount += 1;

            return acc;
        },
        { inventoryValue: 0, lowStockCount: 0, outOfStockCount: 0, inStockCount: 0 }
    );
}

function buildAttentionQueue(params: {
    currency: string;
    overdueReceivables: number;
    overduePayables: number;
    approvedPOAwaitingReceiptCount: number;
    approvedPOAwaitingReceiptValue: number;
    approvedPOAwaitingBillingCount: number;
    lowStockCount: number;
    outOfStockCount: number;
    draftCustomerInvoices: number;
    draftVendorBills: number;
    draftReceipts: number;
    draftPayments: number;
}) {
    const items: DashboardActionItem[] = [];

    if (params.overdueReceivables > 0) {
        items.push({
            id: 'overdue-ar',
            title: 'Overdue receivables need collection follow-up',
            detail: `${formatMoney(params.overdueReceivables, params.currency)} is overdue from customers.`,
            severity: params.overdueReceivables > 50000 ? 'critical' : 'high',
            href: '/receivables/aging',
            metric: formatMoney(params.overdueReceivables, params.currency),
        });
    }

    if (params.overduePayables > 0) {
        items.push({
            id: 'overdue-ap',
            title: 'Overdue vendor liabilities need settlement planning',
            detail: `${formatMoney(params.overduePayables, params.currency)} is overdue to vendors.`,
            severity: params.overduePayables > 50000 ? 'critical' : 'high',
            href: '/ap-aging',
            metric: formatMoney(params.overduePayables, params.currency),
        });
    }

    if (params.approvedPOAwaitingReceiptCount > 0) {
        items.push({
            id: 'awaiting-receipt',
            title: 'Approved purchase orders are still waiting on receipt',
            detail: `${params.approvedPOAwaitingReceiptCount} approved PO(s) worth ${formatMoney(params.approvedPOAwaitingReceiptValue, params.currency)} are not fully received.`,
            severity: 'medium',
            href: '/purchase-orders',
            metric: `${params.approvedPOAwaitingReceiptCount} PO(s)`,
        });
    }

    if (params.approvedPOAwaitingBillingCount > 0) {
        items.push({
            id: 'awaiting-billing',
            title: 'Approved purchase orders still need vendor billing',
            detail: `${params.approvedPOAwaitingBillingCount} PO(s) are not fully billed yet.`,
            severity: 'medium',
            href: '/purchase-orders',
            metric: `${params.approvedPOAwaitingBillingCount} PO(s)`,
        });
    }

    if (params.outOfStockCount > 0 || params.lowStockCount > 0) {
        items.push({
            id: 'inventory-risk',
            title: 'Inventory requires replenishment review',
            detail: `${params.outOfStockCount} out of stock and ${params.lowStockCount} low stock product(s) detected.`,
            severity: params.outOfStockCount > 0 ? 'high' : 'medium',
            href: '/inventory/stock',
            metric: `${params.outOfStockCount + params.lowStockCount} items`,
        });
    }

    const draftDocs = params.draftCustomerInvoices + params.draftVendorBills + params.draftReceipts + params.draftPayments;
    if (draftDocs > 0) {
        items.push({
            id: 'draft-backlog',
            title: 'Draft finance documents are still waiting for review or posting',
            detail: `${draftDocs} draft document(s) are still open across receivables, payables, and cash.`,
            severity: 'low',
            href: '/dashboard',
            metric: `${draftDocs} drafts`,
        });
    }

    const severityOrder: Record<DashboardSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    return items.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
}

function buildAiBlock(params: {
    currency: string;
    openReceivables: number;
    overdueReceivables: number;
    openPayables: number;
    overduePayables: number;
    inventoryValue: number;
    approvedPOAwaitingReceiptCount: number;
    lowStockCount: number;
    outOfStockCount: number;
    draftCustomerInvoices: number;
    draftVendorBills: number;
    draftReceipts: number;
    draftPayments: number;
}) {
    const focusParts: string[] = [];
    if (params.overdueReceivables > 0) focusParts.push(`collections risk is ${formatMoney(params.overdueReceivables, params.currency)}`);
    if (params.overduePayables > 0) focusParts.push(`vendor arrears stand at ${formatMoney(params.overduePayables, params.currency)}`);
    if (params.approvedPOAwaitingReceiptCount > 0) focusParts.push(`${params.approvedPOAwaitingReceiptCount} approved purchase orders are still open on receipt`);
    if (params.outOfStockCount > 0 || params.lowStockCount > 0) focusParts.push(`${params.outOfStockCount} out-of-stock and ${params.lowStockCount} low-stock items need review`);

    const headline = focusParts.length > 0
        ? 'The ERP assistant sees clear action areas today.'
        : 'Operations and finance look stable right now.';

    const summary = focusParts.length > 0
        ? `Based on live tenant data, ${focusParts.join('; ')}. Open receivables are ${formatMoney(params.openReceivables, params.currency)} and open payables are ${formatMoney(params.openPayables, params.currency)}. Inventory on hand is valued at ${formatMoney(params.inventoryValue, params.currency)}.`
        : `No major exceptions were detected in live tenant data. Open receivables are ${formatMoney(params.openReceivables, params.currency)}, open payables are ${formatMoney(params.openPayables, params.currency)}, and inventory on hand is valued at ${formatMoney(params.inventoryValue, params.currency)}.`;

    const recommendations: DashboardRecommendation[] = [];
    if (params.overdueReceivables > 0) recommendations.push({ id: 'ai-collections', title: 'Prioritize customer collections', detail: 'Start with overdue receivables in the aging report and focus on the largest balances first.', severity: params.overdueReceivables > 50000 ? 'high' : 'medium', href: '/receivables/aging' });
    if (params.overduePayables > 0) recommendations.push({ id: 'ai-payables', title: 'Plan vendor settlements', detail: 'Review overdue AP balances and decide whether to pay, dispute, or reschedule vendor bills.', severity: params.overduePayables > 50000 ? 'high' : 'medium', href: '/ap-aging' });
    if (params.approvedPOAwaitingReceiptCount > 0) recommendations.push({ id: 'ai-procurement', title: 'Clear the receipt bottleneck', detail: 'Move approved purchase orders forward with goods receipts or vendor bills so stock and liabilities stay accurate.', severity: 'medium', href: '/purchase-orders' });
    if (params.outOfStockCount > 0 || params.lowStockCount > 0) recommendations.push({ id: 'ai-stock', title: 'Review stock exposure', detail: 'Open the stock overview and prioritize replenishment for out-of-stock and low-stock items.', severity: params.outOfStockCount > 0 ? 'high' : 'medium', href: '/inventory/stock' });
    const draftDocs = params.draftCustomerInvoices + params.draftVendorBills + params.draftReceipts + params.draftPayments;
    if (draftDocs > 0) recommendations.push({ id: 'ai-drafts', title: 'Review draft document backlog', detail: `${draftDocs} draft finance documents are still waiting for review or posting.`, severity: 'low', href: '/dashboard' });

    return {
        headline,
        summary,
        recommendations,
        quickPrompts: [
            'What needs attention today?',
            'How is cash moving this month?',
            'Where are collection risks?',
            'What is blocking procurement?',
            'What inventory needs attention?',
        ],
    };
}

function detectIntent(question: string): DashboardIntent {
    const normalized = question.toLowerCase();
    if (/(cash|bank|payment flow|receipt flow|inflow|outflow)/.test(normalized)) return 'CASH';
    if (/(collect|collection|receivable|customer aging|overdue customer|ar )/.test(normalized)) return 'COLLECTIONS';
    if (/(payable|vendor aging|vendor bill|supplier|ap )/.test(normalized)) return 'PAYABLES';
    if (/(procurement|purchase order|po|grn|goods receipt|rfq|quotation)/.test(normalized)) return 'PROCUREMENT';
    if (/(inventory|stock|warehouse|replenish|out of stock|low stock)/.test(normalized)) return 'INVENTORY';
    return 'OVERVIEW';
}

export async function getDashboardOverview(tenantId: string) {
    const today = new Date();
    const monthSeries = buildMonthSeries();
    const monthStartDate = monthStart(today);
    const nextMonthDate = nextMonthStart(today);
    const currency = await getTenantBaseCurrency(tenantId);

    const [
        config,
        openReceivables,
        overdueReceivables,
        openPayables,
        overduePayables,
        currentMonthReceipts,
        currentMonthPayments,
        approvedPOAwaitingReceipt,
        approvedPOAwaitingBilling,
        draftGoodsReceipts,
        sentRfqs,
        draftCustomerInvoices,
        draftVendorBills,
        draftReceipts,
        draftPayments,
        inventorySnapshot,
        activeProductsCount,
        cashInSeries,
        cashOutSeries,
        invoiceSeries,
        billSeries,
        receiptSeries,
        paymentSeries,
        grnSeries,
        recentArInvoices,
        recentApInvoices,
        recentReceipts,
        recentPayments,
        recentGrns,
        recentPos,
    ] = await Promise.all([
        SystemConfig.findOne({ tenantId }).select('companyName companyLogo currency').lean(),
        ARInvoice.aggregate([{ $match: { tenantId, isDeleted: false, status: 'POSTED', balance: { $gt: 0 } } }, { $group: { _id: null, total: { $sum: '$balance' } } }]),
        ARInvoice.aggregate([{ $match: { tenantId, isDeleted: false, status: 'POSTED', balance: { $gt: 0 }, dueDate: { $lt: today } } }, { $group: { _id: null, total: { $sum: '$balance' } } }]),
        APInvoice.aggregate([{ $match: { tenantId, isDeleted: false, status: 'POSTED', balance: { $gt: 0 } } }, { $group: { _id: null, total: { $sum: '$balance' } } }]),
        APInvoice.aggregate([{ $match: { tenantId, isDeleted: false, status: 'POSTED', balance: { $gt: 0 }, dueDate: { $lt: today } } }, { $group: { _id: null, total: { $sum: '$balance' } } }]),
        ARReceipt.aggregate([{ $match: { tenantId, isDeleted: false, status: 'POSTED', postingDate: { $gte: monthStartDate, $lt: nextMonthDate } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
        APPayment.aggregate([{ $match: { tenantId, isDeleted: false, status: 'POSTED', postingDate: { $gte: monthStartDate, $lt: nextMonthDate } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
        PurchaseOrder.aggregate([{ $match: { tenantId, isDeleted: false, status: 'APPROVED', receiptStatus: { $in: ['NOT_RECEIVED', 'PARTIALLY_RECEIVED'] } } }, { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$grandTotal' } } }]),
        PurchaseOrder.aggregate([{ $match: { tenantId, isDeleted: false, status: 'APPROVED', billingStatus: { $in: ['NOT_BILLED', 'PARTIALLY_BILLED'] } } }, { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$grandTotal' } } }]),
        GRN.countDocuments({ tenantId, isDeleted: false, status: 'DRAFT' }),
        RFQ.countDocuments({ tenantId, isDeleted: false, status: 'SENT' }),
        ARInvoice.countDocuments({ tenantId, isDeleted: false, status: 'DRAFT' }),
        APInvoice.countDocuments({ tenantId, isDeleted: false, status: 'DRAFT' }),
        ARReceipt.countDocuments({ tenantId, isDeleted: false, status: 'DRAFT' }),
        APPayment.countDocuments({ tenantId, isDeleted: false, status: 'DRAFT' }),
        buildInventorySnapshot(tenantId),
        Product.countDocuments({ tenantId, isDeleted: false, status: 'ACTIVE', type: 'PRODUCT' }),
        aggregateMonthly(ARReceipt, tenantId, 'postingDate', 'amount', { status: 'POSTED' }, monthSeries),
        aggregateMonthly(APPayment, tenantId, 'postingDate', 'amount', { status: 'POSTED' }, monthSeries),
        aggregateMonthly(ARInvoice, tenantId, 'postingDate', 'totals.total', { status: 'POSTED' }, monthSeries),
        aggregateMonthly(APInvoice, tenantId, 'postingDate', 'totals.total', { status: 'POSTED' }, monthSeries),
        aggregateMonthly(ARReceipt, tenantId, 'postingDate', 'amount', { status: 'POSTED' }, monthSeries),
        aggregateMonthly(APPayment, tenantId, 'postingDate', 'amount', { status: 'POSTED' }, monthSeries),
        aggregateMonthly(GRN, tenantId, 'receiptDate', 'totalCost', { status: 'CONFIRMED' }, monthSeries),
        ARInvoice.find({ tenantId, isDeleted: false }).sort({ updatedAt: -1 }).limit(4).select('invoiceNo customerName status totals.total updatedAt').lean(),
        APInvoice.find({ tenantId, isDeleted: false }).sort({ updatedAt: -1 }).limit(4).select('invoiceNo vendorName status totals.total updatedAt').lean(),
        ARReceipt.find({ tenantId, isDeleted: false }).sort({ updatedAt: -1 }).limit(4).select('receiptNo customerName status amount updatedAt').lean(),
        APPayment.find({ tenantId, isDeleted: false }).sort({ updatedAt: -1 }).limit(4).select('paymentNo vendorName status amount updatedAt').lean(),
        GRN.find({ tenantId, isDeleted: false }).sort({ updatedAt: -1 }).limit(4).select('grnNo vendorName status totalCost updatedAt').lean(),
        PurchaseOrder.find({ tenantId, isDeleted: false }).sort({ updatedAt: -1 }).limit(4).select('poNumber vendorName status grandTotal updatedAt').lean(),
    ]);

    const openReceivablesValue = Number(openReceivables[0]?.total || 0);
    const overdueReceivablesValue = Number(overdueReceivables[0]?.total || 0);
    const openPayablesValue = Number(openPayables[0]?.total || 0);
    const overduePayablesValue = Number(overduePayables[0]?.total || 0);
    const cashInMonth = Number(currentMonthReceipts[0]?.total || 0);
    const cashOutMonth = Number(currentMonthPayments[0]?.total || 0);
    const awaitingReceiptCount = Number(approvedPOAwaitingReceipt[0]?.count || 0);
    const awaitingReceiptValue = Number(approvedPOAwaitingReceipt[0]?.total || 0);
    const awaitingBillingCount = Number(approvedPOAwaitingBilling[0]?.count || 0);

    const attention = buildAttentionQueue({
        currency,
        overdueReceivables: overdueReceivablesValue,
        overduePayables: overduePayablesValue,
        approvedPOAwaitingReceiptCount: awaitingReceiptCount,
        approvedPOAwaitingReceiptValue: awaitingReceiptValue,
        approvedPOAwaitingBillingCount: awaitingBillingCount,
        lowStockCount: inventorySnapshot.lowStockCount,
        outOfStockCount: inventorySnapshot.outOfStockCount,
        draftCustomerInvoices,
        draftVendorBills,
        draftReceipts,
        draftPayments,
    });

    const ai = buildAiBlock({
        currency,
        openReceivables: openReceivablesValue,
        overdueReceivables: overdueReceivablesValue,
        openPayables: openPayablesValue,
        overduePayables: overduePayablesValue,
        inventoryValue: inventorySnapshot.inventoryValue,
        approvedPOAwaitingReceiptCount: awaitingReceiptCount,
        lowStockCount: inventorySnapshot.lowStockCount,
        outOfStockCount: inventorySnapshot.outOfStockCount,
        draftCustomerInvoices,
        draftVendorBills,
        draftReceipts,
        draftPayments,
    });

    const recentActivity: DashboardRecentActivity[] = [
        ...recentArInvoices.map((doc: any) => ({ id: `ar-invoice-${doc._id}`, type: 'AR Invoice', status: doc.status, title: doc.invoiceNo, subtitle: doc.customerName, amount: Number(doc.totals?.total || 0), occurredAt: isoDate(doc.updatedAt), href: `/receivables/invoices?search=${doc.invoiceNo}` })),
        ...recentApInvoices.map((doc: any) => ({ id: `ap-invoice-${doc._id}`, type: 'AP Bill', status: doc.status, title: doc.invoiceNo, subtitle: doc.vendorName, amount: Number(doc.totals?.total || 0), occurredAt: isoDate(doc.updatedAt), href: `/ap-invoices?search=${doc.invoiceNo}` })),
        ...recentReceipts.map((doc: any) => ({ id: `ar-receipt-${doc._id}`, type: 'Customer Receipt', status: doc.status, title: doc.receiptNo, subtitle: doc.customerName, amount: Number(doc.amount || 0), occurredAt: isoDate(doc.updatedAt), href: `/receivables/receipts?search=${doc.receiptNo}` })),
        ...recentPayments.map((doc: any) => ({ id: `ap-payment-${doc._id}`, type: 'Vendor Payment', status: doc.status, title: doc.paymentNo, subtitle: doc.vendorName, amount: Number(doc.amount || 0), occurredAt: isoDate(doc.updatedAt), href: `/payments?search=${doc.paymentNo}` })),
        ...recentGrns.map((doc: any) => ({ id: `grn-${doc._id}`, type: 'Goods Receipt', status: doc.status, title: doc.grnNo, subtitle: doc.vendorName, amount: Number(doc.totalCost || 0), occurredAt: isoDate(doc.updatedAt), href: `/goods-receipts?search=${doc.grnNo}` })),
        ...recentPos.map((doc: any) => ({ id: `po-${doc._id}`, type: 'Purchase Order', status: doc.status, title: doc.poNumber, subtitle: doc.vendorName, amount: Number(doc.grandTotal || 0), occurredAt: isoDate(doc.updatedAt), href: `/purchase-orders?search=${doc.poNumber}` })),
    ].sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()).slice(0, 12);

    return {
        generatedAt: isoDate(today),
        company: { name: config?.companyName || 'ERP KASSIM', logo: config?.companyLogo, currency },
        kpis: {
            openReceivables: openReceivablesValue,
            overdueReceivables: overdueReceivablesValue,
            openPayables: openPayablesValue,
            overduePayables: overduePayablesValue,
            inventoryValue: inventorySnapshot.inventoryValue,
            cashInMonth,
            cashOutMonth,
            netCashMonth: cashInMonth - cashOutMonth,
        },
        operations: {
            activeProducts: activeProductsCount,
            lowStockProducts: inventorySnapshot.lowStockCount,
            outOfStockProducts: inventorySnapshot.outOfStockCount,
            inStockProducts: inventorySnapshot.inStockCount,
            sentRfqs,
            approvedPOAwaitingReceiptCount: awaitingReceiptCount,
            approvedPOAwaitingReceiptValue: awaitingReceiptValue,
            approvedPOAwaitingBillingCount: awaitingBillingCount,
            draftGoodsReceipts,
            draftCustomerInvoices,
            draftVendorBills,
            draftReceipts,
            draftPayments,
        },
        trends: {
            cashFlow: monthSeries.map((month, index) => ({
                month: month.label,
                cashIn: cashInSeries[index]?.total || 0,
                cashOut: cashOutSeries[index]?.total || 0,
                netCash: (cashInSeries[index]?.total || 0) - (cashOutSeries[index]?.total || 0),
            })),
            documents: monthSeries.map((month, index) => ({
                month: month.label,
                customerInvoices: invoiceSeries[index]?.count || 0,
                vendorBills: billSeries[index]?.count || 0,
                customerReceipts: receiptSeries[index]?.count || 0,
                vendorPayments: paymentSeries[index]?.count || 0,
                goodsReceipts: grnSeries[index]?.count || 0,
            })),
        },
        attention,
        recentActivity,
        ai,
    };
}

export async function queryDashboard(tenantId: string, dto: DashboardQueryDTO) {
    const overview = await getDashboardOverview(tenantId);
    const intent = detectIntent(dto.question);
    const { currency } = overview.company;
    const recommendations = overview.ai.recommendations.slice(0, 3);
    const evidence = {
        kpis: overview.kpis,
        operations: overview.operations,
        attention: overview.attention.slice(0, 5),
        recentActivity: overview.recentActivity.slice(0, 5),
    };

    let answer = overview.ai.summary;
    let followUps = [
        'What needs attention today?',
        'How is cash moving this month?',
        'Where are collection risks?',
    ];

    if (intent === 'CASH') {
        answer = `Cash collections this month are ${formatMoney(overview.kpis.cashInMonth, currency)} and vendor/cash outflows are ${formatMoney(overview.kpis.cashOutMonth, currency)}. Net cash movement for the month is ${formatMoney(overview.kpis.netCashMonth, currency)} based on posted customer receipts and vendor payments.`;
        followUps = [
            'Show the largest recent cash transactions',
            'Are payables putting pressure on cash?',
            'Which month had the strongest inflow?',
        ];
    } else if (intent === 'COLLECTIONS') {
        answer = `Open receivables currently stand at ${formatMoney(overview.kpis.openReceivables, currency)} and overdue receivables are ${formatMoney(overview.kpis.overdueReceivables, currency)}. The highest-value next step is to review AR aging and prioritize overdue customer follow-up first.`;
        followUps = [
            'Which area should finance work first?',
            'How much is overdue from customers?',
            'What needs attention today?',
        ];
    } else if (intent === 'PAYABLES') {
        answer = `Open payables are ${formatMoney(overview.kpis.openPayables, currency)} and overdue vendor liabilities are ${formatMoney(overview.kpis.overduePayables, currency)}. Review the AP aging report first, then decide which bills should be paid, disputed, or rescheduled.`;
        followUps = [
            'Are payables putting pressure on cash?',
            'Which recent vendor documents changed the picture?',
            'What needs attention today?',
        ];
    } else if (intent === 'PROCUREMENT') {
        answer = `${overview.operations.sentRfqs} RFQ(s) are currently sent to vendors. ${overview.operations.approvedPOAwaitingReceiptCount} approved PO(s) are still waiting for receipt and ${overview.operations.approvedPOAwaitingBillingCount} approved PO(s) are still waiting for vendor billing. ${overview.operations.draftGoodsReceipts} goods receipt draft(s) are open.`;
        followUps = [
            'What is blocking procurement?',
            'Which POs still need receipt?',
            'What inventory needs attention?',
        ];
    } else if (intent === 'INVENTORY') {
        answer = `Inventory on hand is valued at ${formatMoney(overview.kpis.inventoryValue, currency)}. There are ${overview.operations.outOfStockProducts} out-of-stock product(s), ${overview.operations.lowStockProducts} low-stock product(s), and ${overview.operations.inStockProducts} adequately stocked product(s) based on current stock records.`;
        followUps = [
            'What inventory needs attention?',
            'How exposed are we on stock right now?',
            'What is blocking procurement?',
        ];
    }

    return {
        question: dto.question,
        intent,
        answer,
        evidence,
        recommendations,
        followUps,
        groundedNote: 'This dashboard assistant is grounded in live tenant ERP data only. It does not post or modify accounting records.',
    };
}

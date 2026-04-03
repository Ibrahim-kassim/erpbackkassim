import { APInvoice } from '../models/apInvoice.model';
import { APPayment } from '../models/apPayment.model';
import { ARInvoice } from '../models/arInvoice.model';
import { ARReceipt } from '../models/arReceipt.model';
import { BusinessPartner } from '../models/businessPartner.model';
import { ChartOfAccount } from '../models/chartOfAccount.model';
import { FiscalCalendar } from '../models/fiscalCalendar.model';
import { GRN } from '../models/grn.model';
import { Category } from '../models/inventory/category.model';
import { Product } from '../models/inventory/product.model';
import { Uom } from '../models/inventory/uom.model';
import { PurchaseOrder } from '../models/purchaseOrder.model';
import { RFQ } from '../models/rfq.model';
import { listAccounts } from './chartOfAccount.service';

export type CopilotModuleKey =
    | 'BUSINESS_PARTNERS'
    | 'PRODUCTS'
    | 'CATEGORIES'
    | 'UOMS'
    | 'AR_INVOICES'
    | 'AP_INVOICES'
    | 'AR_RECEIPTS'
    | 'AP_PAYMENTS'
    | 'RFQS'
    | 'PURCHASE_ORDERS'
    | 'GOODS_RECEIPTS'
    | 'CHART_ACCOUNTS'
    | 'FISCAL_YEARS';

export type CopilotModuleSummary = {
    moduleKey: CopilotModuleKey;
    title: string;
    summary: string;
    facts: string[];
    columns: string[];
    rows: string[][];
};

export type CopilotModuleFilters = {
    accountType?: string;
    status?: string;
    posting?: boolean;
    role?: 'CUSTOMER' | 'VENDOR';
    itemType?: 'PRODUCT' | 'SERVICE';
};

export type CopilotModuleChart = {
    title: string;
    subtitle?: string;
    chartKind: 'bar' | 'area';
    data: Array<Record<string, string | number>>;
    series: Array<{ key: string; label: string; color: string }>;
};

type ModuleRegistryItem = {
    key: CopilotModuleKey;
    title: string;
    aliases: string[];
    destination: string;
};

const currencyFormatter = (amount: number) =>
    new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(amount);

const shortDate = (value?: Date | string | null) => {
    if (!value) return '-';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toISOString().split('T')[0];
};

const monthLabel = (value?: Date | string | null) => {
    if (!value) return 'Unknown';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return 'Unknown';
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
};

const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();

const normalizeAccountTypeFilter = (message: string) => {
    const normalized = message.toLowerCase();
    if (/\bassets?\b/.test(normalized)) return 'ASSET';
    if (/\bliabilit(y|ies)\b/.test(normalized)) return 'LIABILITY';
    if (/\bequity\b/.test(normalized)) return 'EQUITY';
    if (/\brevenues?\b/.test(normalized)) return 'REVENUE';
    if (/\bincome\b/.test(normalized)) return 'INCOME';
    if (/\bexpenses?\b/.test(normalized)) return 'EXPENSE';
    if (/\bcash\b/.test(normalized)) return 'CASH';
    return undefined;
};

export function extractCopilotModuleFilters(moduleKey: CopilotModuleKey, message: string): CopilotModuleFilters {
    const normalized = message.toLowerCase();
    const filters: CopilotModuleFilters = {};

    if (moduleKey === 'CHART_ACCOUNTS') {
        filters.accountType = normalizeAccountTypeFilter(message);
        if (/\bactive\b/.test(normalized)) filters.status = 'ACTIVE';
        if (/\binactive\b/.test(normalized)) filters.status = 'INACTIVE';
        if (/\bposting\b/.test(normalized)) filters.posting = true;
        if (/\bheader\b|\bfolder\b|\bgroup\b/.test(normalized)) filters.posting = false;
    }

    if (moduleKey === 'BUSINESS_PARTNERS') {
        if (/\bcustomers?\b/.test(normalized)) filters.role = 'CUSTOMER';
        if (/\bvendors?\b|\bsuppliers?\b/.test(normalized)) filters.role = 'VENDOR';
        if (/\bactive\b/.test(normalized)) filters.status = 'ACTIVE';
        if (/\binactive\b/.test(normalized)) filters.status = 'INACTIVE';
    }

    if (moduleKey === 'PRODUCTS') {
        if (/\bproducts?\b/.test(normalized)) filters.itemType = 'PRODUCT';
        if (/\bservices?\b/.test(normalized)) filters.itemType = 'SERVICE';
        if (/\bactive\b/.test(normalized)) filters.status = 'ACTIVE';
        if (/\binactive\b/.test(normalized)) filters.status = 'INACTIVE';
    }

    return filters;
}

function describeAppliedFilters(moduleKey: CopilotModuleKey, filters?: CopilotModuleFilters) {
    if (!filters) return '';

    const parts: string[] = [];

    if (moduleKey === 'CHART_ACCOUNTS') {
        if (filters.accountType) parts.push(`${titleCase(filters.accountType)} type`);
        if (filters.status) parts.push(filters.status.toLowerCase());
        if (typeof filters.posting === 'boolean') parts.push(filters.posting ? 'posting only' : 'header/folder only');
    }

    if (moduleKey === 'BUSINESS_PARTNERS') {
        if (filters.role) parts.push(filters.role === 'CUSTOMER' ? 'customers' : 'vendors');
        if (filters.status) parts.push(filters.status.toLowerCase());
    }

    if (moduleKey === 'PRODUCTS') {
        if (filters.itemType) parts.push(filters.itemType === 'PRODUCT' ? 'products' : 'services');
        if (filters.status) parts.push(filters.status.toLowerCase());
    }

    return parts.length ? `Filtered to ${parts.join(', ')}.` : '';
}

export const copilotModuleRegistry: Record<CopilotModuleKey, ModuleRegistryItem> = {
    BUSINESS_PARTNERS: {
        key: 'BUSINESS_PARTNERS',
        title: 'Business Partners',
        aliases: ['business partner', 'business partners', 'customer', 'customers', 'vendor', 'vendors', 'supplier', 'suppliers', 'partner'],
        destination: '/business-partners',
    },
    PRODUCTS: {
        key: 'PRODUCTS',
        title: 'Products',
        aliases: ['product', 'products', 'item', 'items', 'service', 'services', 'inventory item', 'product master'],
        destination: '/inventory/products',
    },
    CATEGORIES: {
        key: 'CATEGORIES',
        title: 'Categories',
        aliases: ['category', 'categories', 'inventory category', 'product category'],
        destination: '/inventory/products',
    },
    UOMS: {
        key: 'UOMS',
        title: 'UOMs',
        aliases: ['uom', 'uoms', 'unit of measure', 'units of measure', 'measurement unit'],
        destination: '/inventory/products',
    },
    AR_INVOICES: {
        key: 'AR_INVOICES',
        title: 'Customer Invoices',
        aliases: ['customer invoice', 'customer invoices', 'sales invoice', 'sales invoices', 'ar invoice', 'ar invoices', 'receivable invoice', 'receivable invoices'],
        destination: '/receivables/invoices',
    },
    AP_INVOICES: {
        key: 'AP_INVOICES',
        title: 'Vendor Bills',
        aliases: ['vendor bill', 'vendor bills', 'supplier invoice', 'supplier invoices', 'ap invoice', 'ap invoices', 'payable invoice', 'payable invoices', 'vendor invoice', 'vendor invoices'],
        destination: '/ap-invoices',
    },
    AR_RECEIPTS: {
        key: 'AR_RECEIPTS',
        title: 'Customer Receipts',
        aliases: ['receipt', 'receipts', 'customer receipt', 'customer receipts', 'ar receipt', 'ar receipts', 'cash receipt'],
        destination: '/receivables/receipts',
    },
    AP_PAYMENTS: {
        key: 'AP_PAYMENTS',
        title: 'Vendor Payments',
        aliases: ['payment', 'payments', 'vendor payment', 'vendor payments', 'supplier payment', 'supplier payments', 'ap payment', 'ap payments'],
        destination: '/payments',
    },
    RFQS: {
        key: 'RFQS',
        title: 'RFQs',
        aliases: ['rfq', 'rfqs', 'request for quotation', 'request for quotations', 'quotation request'],
        destination: '/rfqs',
    },
    PURCHASE_ORDERS: {
        key: 'PURCHASE_ORDERS',
        title: 'Purchase Orders',
        aliases: ['purchase order', 'purchase orders', 'po', 'pos'],
        destination: '/purchase-orders',
    },
    GOODS_RECEIPTS: {
        key: 'GOODS_RECEIPTS',
        title: 'Goods Receipts',
        aliases: ['goods receipt', 'goods receipts', 'grn', 'grns', 'receipt note'],
        destination: '/goods-receipts',
    },
    CHART_ACCOUNTS: {
        key: 'CHART_ACCOUNTS',
        title: 'Chart Accounts',
        aliases: ['chart of accounts', 'chart account', 'chart accounts', 'coa', 'accounts', 'ledger accounts'],
        destination: '/chart-of-accounts',
    },
    FISCAL_YEARS: {
        key: 'FISCAL_YEARS',
        title: 'Fiscal Years',
        aliases: ['fiscal year', 'fiscal years', 'financial year', 'financial years', 'periods', 'fiscal calendar'],
        destination: '/fiscal-calendar',
    },
};

export const copilotModuleCatalogText = Object.values(copilotModuleRegistry)
    .map((module) => `${module.key} -> ${module.title}`)
    .join('; ');

export function resolveModuleKeyFallback(message: string): CopilotModuleKey | undefined {
    const normalized = message.toLowerCase();
    const ranked = Object.values(copilotModuleRegistry)
        .map((module) => {
            const score = module.aliases.reduce((total, alias) => total + (normalized.includes(alias) ? alias.length : 0), 0);
            return { module, score };
        })
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score);

    return ranked[0]?.module.key;
}

function getDestination(moduleKey: CopilotModuleKey) {
    return copilotModuleRegistry[moduleKey].destination;
}

export function getCopilotModuleDestination(moduleKey: CopilotModuleKey) {
    return getDestination(moduleKey);
}

export async function getCopilotModuleSummary(tenantId: string, moduleKey: CopilotModuleKey, filters?: CopilotModuleFilters): Promise<CopilotModuleSummary> {
    switch (moduleKey) {
        case 'BUSINESS_PARTNERS': {
            const partnerFilter: Record<string, any> = { tenantId, isDeleted: false };
            if (filters?.role) partnerFilter.roles = filters.role;
            if (filters?.status) partnerFilter.status = filters.status;
            const [total, active, customers, vendors, rows] = await Promise.all([
                BusinessPartner.countDocuments(partnerFilter),
                BusinessPartner.countDocuments({ ...partnerFilter, status: 'ACTIVE' }),
                BusinessPartner.countDocuments({ ...partnerFilter, roles: 'CUSTOMER' }),
                BusinessPartner.countDocuments({ ...partnerFilter, roles: 'VENDOR' }),
                BusinessPartner.find(partnerFilter)
                    .sort({ updatedAt: -1 })
                    .limit(8)
                    .select('code name roles status updatedAt')
                    .lean(),
            ]);

            return {
                moduleKey,
                title: 'Business Partners',
                summary: `You have ${total} business partner record(s), including ${customers} customer-tagged partner(s) and ${vendors} vendor-tagged partner(s). ${active} are active. ${describeAppliedFilters(moduleKey, filters)}`.trim(),
                facts: [`Total: ${total}`, `Active: ${active}`, `Customers: ${customers}`, `Vendors: ${vendors}`],
                columns: ['Code', 'Name', 'Roles', 'Status', 'Updated'],
                rows: rows.map((row: any) => [row.code, row.name, (row.roles || []).join(' / '), row.status, shortDate(row.updatedAt)]),
            };
        }
        case 'PRODUCTS': {
            const productFilter: Record<string, any> = { tenantId, isDeleted: false };
            if (filters?.itemType) productFilter.type = filters.itemType;
            if (filters?.status) productFilter.status = filters.status;
            const [products, services, active, inactive, rows] = await Promise.all([
                Product.countDocuments({ ...productFilter, type: 'PRODUCT' }),
                Product.countDocuments({ ...productFilter, type: 'SERVICE' }),
                Product.countDocuments({ ...productFilter, status: 'ACTIVE' }),
                Product.countDocuments({ ...productFilter, status: 'INACTIVE' }),
                Product.find(productFilter)
                    .sort({ updatedAt: -1 })
                    .limit(8)
                    .select('code name type status unitPrice')
                    .lean(),
            ]);
            const total = products + services;
            return {
                moduleKey,
                title: 'Products',
                summary: `You have ${total} item master record(s): ${products} product(s) and ${services} service(s). ${active} are active and ${inactive} are inactive. ${describeAppliedFilters(moduleKey, filters)}`.trim(),
                facts: [`Total: ${total}`, `Products: ${products}`, `Services: ${services}`, `Active: ${active}`],
                columns: ['Code', 'Name', 'Type', 'Status', 'Unit Price'],
                rows: rows.map((row: any) => [row.code, row.name, row.type, row.status, currencyFormatter(Number(row.unitPrice || 0))]),
            };
        }
        case 'CATEGORIES': {
            const [active, inactive, rows] = await Promise.all([
                Category.countDocuments({ tenantId, isDeleted: false, status: 'ACTIVE' }),
                Category.countDocuments({ tenantId, isDeleted: false, status: 'INACTIVE' }),
                Category.find({ tenantId, isDeleted: false })
                    .sort({ updatedAt: -1 })
                    .limit(10)
                    .select('name status updatedAt')
                    .lean(),
            ]);
            const total = active + inactive;
            return {
                moduleKey,
                title: 'Categories',
                summary: `You have ${total} inventory categor${total === 1 ? 'y' : 'ies'}. ${active} are active and ${inactive} are inactive.`,
                facts: [`Total: ${total}`, `Active: ${active}`, `Inactive: ${inactive}`],
                columns: ['Name', 'Status', 'Updated'],
                rows: rows.map((row: any) => [row.name, row.status, shortDate(row.updatedAt)]),
            };
        }
        case 'UOMS': {
            const [active, inactive, rows] = await Promise.all([
                Uom.countDocuments({ tenantId, isDeleted: false, status: 'ACTIVE' }),
                Uom.countDocuments({ tenantId, isDeleted: false, status: 'INACTIVE' }),
                Uom.find({ tenantId, isDeleted: false })
                    .sort({ updatedAt: -1 })
                    .limit(10)
                    .select('name symbol status updatedAt')
                    .lean(),
            ]);
            const total = active + inactive;
            return {
                moduleKey,
                title: 'UOMs',
                summary: `You have ${total} unit-of-measure record(s). ${active} are active and ${inactive} are inactive.`,
                facts: [`Total: ${total}`, `Active: ${active}`, `Inactive: ${inactive}`],
                columns: ['Name', 'Symbol', 'Status', 'Updated'],
                rows: rows.map((row: any) => [row.name, row.symbol, row.status, shortDate(row.updatedAt)]),
            };
        }
        case 'AR_INVOICES': {
            const [draft, posted, voided, openBalanceAgg, overdue, rows] = await Promise.all([
                ARInvoice.countDocuments({ tenantId, isDeleted: false, status: 'DRAFT' }),
                ARInvoice.countDocuments({ tenantId, isDeleted: false, status: 'POSTED' }),
                ARInvoice.countDocuments({ tenantId, isDeleted: false, status: 'VOID' }),
                ARInvoice.aggregate([
                    { $match: { tenantId, isDeleted: false } },
                    { $group: { _id: null, total: { $sum: '$balance' } } },
                ]),
                ARInvoice.countDocuments({ tenantId, isDeleted: false, status: 'POSTED', balance: { $gt: 0 }, dueDate: { $lt: new Date() } }),
                ARInvoice.find({ tenantId, isDeleted: false })
                    .sort({ updatedAt: -1 })
                    .limit(8)
                    .select('invoiceNo customerName status dueDate balance')
                    .lean(),
            ]);
            const total = draft + posted + voided;
            const openBalance = Number(openBalanceAgg[0]?.total || 0);
            return {
                moduleKey,
                title: 'Customer Invoices',
                summary: `You have ${total} customer invoice record(s): ${draft} draft, ${posted} posted, and ${voided} void. Open balance stands at ${currencyFormatter(openBalance)} with ${overdue} overdue invoice(s).`,
                facts: [`Total: ${total}`, `Draft: ${draft}`, `Posted: ${posted}`, `Overdue: ${overdue}`],
                columns: ['Invoice No', 'Customer', 'Status', 'Due Date', 'Balance'],
                rows: rows.map((row: any) => [row.invoiceNo, row.customerName, row.status, shortDate(row.dueDate), currencyFormatter(Number(row.balance || 0))]),
            };
        }
        case 'AP_INVOICES': {
            const [draft, posted, voided, openBalanceAgg, overdue, rows] = await Promise.all([
                APInvoice.countDocuments({ tenantId, isDeleted: false, status: 'DRAFT' }),
                APInvoice.countDocuments({ tenantId, isDeleted: false, status: 'POSTED' }),
                APInvoice.countDocuments({ tenantId, isDeleted: false, status: 'VOID' }),
                APInvoice.aggregate([
                    { $match: { tenantId, isDeleted: false } },
                    { $group: { _id: null, total: { $sum: '$balance' } } },
                ]),
                APInvoice.countDocuments({ tenantId, isDeleted: false, status: 'POSTED', balance: { $gt: 0 }, dueDate: { $lt: new Date() } }),
                APInvoice.find({ tenantId, isDeleted: false })
                    .sort({ updatedAt: -1 })
                    .limit(8)
                    .select('invoiceNo vendorName status dueDate balance')
                    .lean(),
            ]);
            const total = draft + posted + voided;
            const openBalance = Number(openBalanceAgg[0]?.total || 0);
            return {
                moduleKey,
                title: 'Vendor Bills',
                summary: `You have ${total} vendor bill record(s): ${draft} draft, ${posted} posted, and ${voided} void. Open payable balance stands at ${currencyFormatter(openBalance)} with ${overdue} overdue bill(s).`,
                facts: [`Total: ${total}`, `Draft: ${draft}`, `Posted: ${posted}`, `Overdue: ${overdue}`],
                columns: ['Bill No', 'Vendor', 'Status', 'Due Date', 'Balance'],
                rows: rows.map((row: any) => [row.invoiceNo, row.vendorName, row.status, shortDate(row.dueDate), currencyFormatter(Number(row.balance || 0))]),
            };
        }
        case 'AR_RECEIPTS': {
            const [draft, posted, postedAmountAgg, rows] = await Promise.all([
                ARReceipt.countDocuments({ tenantId, isDeleted: false, status: 'DRAFT' }),
                ARReceipt.countDocuments({ tenantId, isDeleted: false, status: 'POSTED' }),
                ARReceipt.aggregate([
                    { $match: { tenantId, isDeleted: false, status: 'POSTED' } },
                    { $group: { _id: null, total: { $sum: '$amount' } } },
                ]),
                ARReceipt.find({ tenantId, isDeleted: false })
                    .sort({ updatedAt: -1 })
                    .limit(8)
                    .select('receiptNo customerName status method amount postingDate')
                    .lean(),
            ]);
            const total = draft + posted;
            return {
                moduleKey,
                title: 'Customer Receipts',
                summary: `You have ${total} customer receipt record(s): ${draft} draft and ${posted} posted. Posted cash receipts total ${currencyFormatter(Number(postedAmountAgg[0]?.total || 0))}.`,
                facts: [`Total: ${total}`, `Draft: ${draft}`, `Posted: ${posted}`],
                columns: ['Receipt No', 'Customer', 'Status', 'Method', 'Amount', 'Posting Date'],
                rows: rows.map((row: any) => [row.receiptNo, row.customerName, row.status, row.method, currencyFormatter(Number(row.amount || 0)), shortDate(row.postingDate)]),
            };
        }
        case 'AP_PAYMENTS': {
            const [draft, posted, postedAmountAgg, rows] = await Promise.all([
                APPayment.countDocuments({ tenantId, isDeleted: false, status: 'DRAFT' }),
                APPayment.countDocuments({ tenantId, isDeleted: false, status: 'POSTED' }),
                APPayment.aggregate([
                    { $match: { tenantId, isDeleted: false, status: 'POSTED' } },
                    { $group: { _id: null, total: { $sum: '$amount' } } },
                ]),
                APPayment.find({ tenantId, isDeleted: false })
                    .sort({ updatedAt: -1 })
                    .limit(8)
                    .select('paymentNo vendorName status method amount postingDate')
                    .lean(),
            ]);
            const total = draft + posted;
            return {
                moduleKey,
                title: 'Vendor Payments',
                summary: `You have ${total} vendor payment record(s): ${draft} draft and ${posted} posted. Posted payments total ${currencyFormatter(Number(postedAmountAgg[0]?.total || 0))}.`,
                facts: [`Total: ${total}`, `Draft: ${draft}`, `Posted: ${posted}`],
                columns: ['Payment No', 'Vendor', 'Status', 'Method', 'Amount', 'Posting Date'],
                rows: rows.map((row: any) => [row.paymentNo, row.vendorName, row.status, row.method, currencyFormatter(Number(row.amount || 0)), shortDate(row.postingDate)]),
            };
        }
        case 'RFQS': {
            const [draft, sent, closed, rows] = await Promise.all([
                RFQ.countDocuments({ tenantId, isDeleted: false, status: 'DRAFT' }),
                RFQ.countDocuments({ tenantId, isDeleted: false, status: 'SENT' }),
                RFQ.countDocuments({ tenantId, isDeleted: false, status: 'CLOSED' }),
                RFQ.find({ tenantId, isDeleted: false })
                    .sort({ updatedAt: -1 })
                    .limit(8)
                    .select('rfqNumber title status createdAt vendorIds')
                    .lean(),
            ]);
            const total = draft + sent + closed;
            return {
                moduleKey,
                title: 'RFQs',
                summary: `You have ${total} RFQ record(s): ${draft} draft, ${sent} sent, and ${closed} closed.`,
                facts: [`Total: ${total}`, `Draft: ${draft}`, `Sent: ${sent}`, `Closed: ${closed}`],
                columns: ['RFQ No', 'Title', 'Status', 'Vendors', 'Created'],
                rows: rows.map((row: any) => [row.rfqNumber, row.title, row.status, String((row.vendorIds || []).length), shortDate(row.createdAt)]),
            };
        }
        case 'PURCHASE_ORDERS': {
            const [draft, approved, cancelled, closed, awaitingReceipt, awaitingBilling, rows] = await Promise.all([
                PurchaseOrder.countDocuments({ tenantId, isDeleted: false, status: 'DRAFT' }),
                PurchaseOrder.countDocuments({ tenantId, isDeleted: false, status: 'APPROVED' }),
                PurchaseOrder.countDocuments({ tenantId, isDeleted: false, status: 'CANCELLED' }),
                PurchaseOrder.countDocuments({ tenantId, isDeleted: false, status: 'CLOSED' }),
                PurchaseOrder.countDocuments({ tenantId, isDeleted: false, status: 'APPROVED', receiptStatus: { $ne: 'FULLY_RECEIVED' } }),
                PurchaseOrder.countDocuments({ tenantId, isDeleted: false, status: 'APPROVED', billingStatus: { $ne: 'FULLY_BILLED' } }),
                PurchaseOrder.find({ tenantId, isDeleted: false })
                    .sort({ updatedAt: -1 })
                    .limit(8)
                    .select('poNumber vendorName status receiptStatus billingStatus grandTotal')
                    .lean(),
            ]);
            const total = draft + approved + cancelled + closed;
            return {
                moduleKey,
                title: 'Purchase Orders',
                summary: `You have ${total} purchase order record(s): ${draft} draft, ${approved} approved, ${closed} closed, and ${cancelled} cancelled. ${awaitingReceipt} approved PO(s) still need receipt and ${awaitingBilling} still need billing.`,
                facts: [`Total: ${total}`, `Approved: ${approved}`, `Awaiting Receipt: ${awaitingReceipt}`, `Awaiting Billing: ${awaitingBilling}`],
                columns: ['PO No', 'Vendor', 'Status', 'Receipt', 'Billing', 'Grand Total'],
                rows: rows.map((row: any) => [row.poNumber, row.vendorName, row.status, row.receiptStatus, row.billingStatus, currencyFormatter(Number(row.grandTotal || 0))]),
            };
        }
        case 'GOODS_RECEIPTS': {
            const [draft, confirmed, cancelled, rows] = await Promise.all([
                GRN.countDocuments({ tenantId, isDeleted: false, status: 'DRAFT' }),
                GRN.countDocuments({ tenantId, isDeleted: false, status: 'CONFIRMED' }),
                GRN.countDocuments({ tenantId, isDeleted: false, status: 'CANCELLED' }),
                GRN.find({ tenantId, isDeleted: false })
                    .sort({ updatedAt: -1 })
                    .limit(8)
                    .select('grnNo poNumber vendorName status totalCost receiptDate')
                    .lean(),
            ]);
            const total = draft + confirmed + cancelled;
            return {
                moduleKey,
                title: 'Goods Receipts',
                summary: `You have ${total} goods receipt record(s): ${draft} draft, ${confirmed} confirmed, and ${cancelled} cancelled.`,
                facts: [`Total: ${total}`, `Draft: ${draft}`, `Confirmed: ${confirmed}`],
                columns: ['GRN No', 'PO No', 'Vendor', 'Status', 'Receipt Date', 'Total Cost'],
                rows: rows.map((row: any) => [row.grnNo, row.poNumber, row.vendorName, row.status, shortDate(row.receiptDate), currencyFormatter(Number(row.totalCost || 0))]),
            };
        }
        case 'CHART_ACCOUNTS': {
            const query = {
                type: filters?.accountType,
                isActive: filters?.status === 'ACTIVE' ? 'true' : filters?.status === 'INACTIVE' ? 'false' : undefined,
                isPosting: typeof filters?.posting === 'boolean' ? String(filters.posting) : undefined,
            };
            const accounts = await listAccounts(query, tenantId);
            const rows = accounts.slice(0, 12) as any[];
            const total = accounts.length;
            const posting = accounts.filter((account: any) => account.isPosting).length;
            const headers = accounts.filter((account: any) => !account.isPosting).length;
            const active = accounts.filter((account: any) => account.isActive).length;
            return {
                moduleKey,
                title: 'Chart of Accounts',
                summary: `You have ${total} chart account record(s). ${posting} are posting accounts, ${headers} are header/folder accounts, and ${active} are active. ${describeAppliedFilters(moduleKey, filters)}`.trim(),
                facts: [`Total: ${total}`, `Posting: ${posting}`, `Headers: ${headers}`, `Active: ${active}`],
                columns: ['Code', 'Name', 'Type', 'Posting', 'Active'],
                rows: rows.map((row: any) => [row.code, row.name, row.type, row.isPosting ? 'Yes' : 'No', row.isActive ? 'Yes' : 'No']),
            };
        }
        case 'FISCAL_YEARS': {
            const [open, closed, active, rows] = await Promise.all([
                FiscalCalendar.countDocuments({ tenantId, status: 'OPEN' }),
                FiscalCalendar.countDocuments({ tenantId, status: 'CLOSED' }),
                FiscalCalendar.countDocuments({ tenantId, isActive: true }),
                FiscalCalendar.find({ tenantId })
                    .sort({ startDate: -1 })
                    .limit(8)
                    .select('yearName startDate endDate status isActive')
                    .lean(),
            ]);
            const total = open + closed;
            return {
                moduleKey,
                title: 'Fiscal Years',
                summary: `You have ${total} fiscal year record(s): ${open} open and ${closed} closed. ${active} are marked active.`,
                facts: [`Total: ${total}`, `Open: ${open}`, `Closed: ${closed}`, `Active: ${active}`],
                columns: ['Year', 'Start', 'End', 'Status', 'Active'],
                rows: rows.map((row: any) => [row.yearName, shortDate(row.startDate), shortDate(row.endDate), row.status, row.isActive ? 'Yes' : 'No']),
            };
        }
        default:
            throw new Error(`Unsupported copilot module: ${moduleKey satisfies never}`);
    }
}

export async function getCopilotModuleChart(tenantId: string, moduleKey: CopilotModuleKey, filters?: CopilotModuleFilters): Promise<CopilotModuleChart> {
    const summary = await getCopilotModuleSummary(tenantId, moduleKey, filters);

    switch (moduleKey) {
        case 'BUSINESS_PARTNERS': {
            const [customers, vendors, active, inactive] = await Promise.all([
                BusinessPartner.countDocuments({ tenantId, isDeleted: false, roles: 'CUSTOMER' }),
                BusinessPartner.countDocuments({ tenantId, isDeleted: false, roles: 'VENDOR' }),
                BusinessPartner.countDocuments({ tenantId, isDeleted: false, status: 'ACTIVE' }),
                BusinessPartner.countDocuments({ tenantId, isDeleted: false, status: 'INACTIVE' }),
            ]);
            return {
                title: summary.title,
                subtitle: 'Live business partner composition',
                chartKind: 'bar',
                data: [
                    { bucket: 'Customers', amount: customers },
                    { bucket: 'Vendors', amount: vendors },
                    { bucket: 'Active', amount: active },
                    { bucket: 'Inactive', amount: inactive },
                ],
                series: [{ key: 'amount', label: 'Count', color: '#2563eb' }],
            };
        }
        case 'PRODUCTS': {
            const [products, services, active, inactive] = await Promise.all([
                Product.countDocuments({ tenantId, isDeleted: false, type: 'PRODUCT' }),
                Product.countDocuments({ tenantId, isDeleted: false, type: 'SERVICE' }),
                Product.countDocuments({ tenantId, isDeleted: false, status: 'ACTIVE' }),
                Product.countDocuments({ tenantId, isDeleted: false, status: 'INACTIVE' }),
            ]);
            return {
                title: summary.title,
                subtitle: 'Current item master mix',
                chartKind: 'bar',
                data: [
                    { bucket: 'Products', amount: products },
                    { bucket: 'Services', amount: services },
                    { bucket: 'Active', amount: active },
                    { bucket: 'Inactive', amount: inactive },
                ],
                series: [{ key: 'amount', label: 'Count', color: '#0f766e' }],
            };
        }
        case 'AR_INVOICES':
        case 'AP_INVOICES':
        case 'AR_RECEIPTS':
        case 'AP_PAYMENTS':
        case 'RFQS':
        case 'PURCHASE_ORDERS':
        case 'GOODS_RECEIPTS':
        case 'CHART_ACCOUNTS':
        case 'FISCAL_YEARS':
        case 'CATEGORIES':
        case 'UOMS': {
            const rows = summary.facts.map((fact) => {
                const [label, raw] = fact.split(':').map((part) => part.trim());
                const parsed = Number(raw);
                return { bucket: label, amount: Number.isFinite(parsed) ? parsed : 0 };
            });
            return {
                title: summary.title,
                subtitle: 'Live module snapshot',
                chartKind: 'bar',
                data: rows,
                series: [{ key: 'amount', label: 'Count', color: '#2563eb' }],
            };
        }
        default:
            throw new Error(`Unsupported chart module: ${moduleKey satisfies never}`);
    }
}

export async function buildCopilotModulePdfLines(tenantId: string, moduleKey: CopilotModuleKey, filters?: CopilotModuleFilters) {
    const summary = await getCopilotModuleSummary(tenantId, moduleKey, filters);
    return [
        summary.summary,
        '',
        'Key facts:',
        ...summary.facts.map((fact) => `- ${fact}`),
        '',
        `Destination: ${getDestination(moduleKey)}`,
        '',
        'Latest rows:',
        ...summary.rows.slice(0, 8).map((row) => `- ${row.join(' | ')}`),
    ];
}

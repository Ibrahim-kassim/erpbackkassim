import { Types } from 'mongoose';
import { APInvoice } from '../models/apInvoice.model';
import { GRN } from '../models/grn.model';
import { Product } from '../models/inventory/product.model';
import { PurchaseOrder, IPOLine, IPurchaseOrder, POBillingStatus, POReceiptStatus } from '../models/purchaseOrder.model';
import { Quotation } from '../models/quotation.model';
import { RFQ } from '../models/rfq.model';
import { BusinessPartner } from '../models/businessPartner.model';
import { getTenantBaseCurrency } from './systemConfig.defaults';

class ServiceError extends Error {
    constructor(message: string, public code: string) {
        super(message);
        this.name = 'ServiceError';
    }
}

// ─── helpers ────────────────────────────────────────────────────────────────

function calcLine(
    qty: number,
    unitPrice: number,
    vatRate: number
): Pick<IPOLine, 'quantity' | 'unitPrice' | 'vatRate' | 'lineNet' | 'vatAmount' | 'lineTotal'> {
    const lineNet = Math.round(qty * unitPrice * 100) / 100;
    const vatAmount = Math.round(lineNet * (vatRate / 100) * 100) / 100;
    const lineTotal = Math.round((lineNet + vatAmount) * 100) / 100;
    return { quantity: qty, unitPrice, vatRate, lineNet, vatAmount, lineTotal };
}

function calcTotals(lines: IPOLine[]) {
    const subtotal = Math.round(lines.reduce((s, l) => s + l.lineNet, 0) * 100) / 100;
    const vatTotal = Math.round(lines.reduce((s, l) => s + l.vatAmount, 0) * 100) / 100;
    const grandTotal = Math.round((subtotal + vatTotal) * 100) / 100;
    return { subtotal, vatTotal, grandTotal };
}

const RECEIPT_EPSILON = 0.0001;

function toObjectIdString(value: unknown) {
    if (!value) return undefined;
    if (typeof value === 'string') return value;
    if (value instanceof Types.ObjectId) return value.toString();
    if (typeof value === 'object' && value && 'toString' in value) return value.toString();
    return undefined;
}

async function calculateReceiptStatus(po: Pick<IPurchaseOrder, '_id' | 'tenantId' | 'lines'> | any): Promise<POReceiptStatus> {
    const lines = Array.isArray(po?.lines) ? po.lines : [];
    const productIds = lines
        .map((line: any) => toObjectIdString(line.productId))
        .filter((value: string | undefined): value is string => !!value);

    const products = productIds.length > 0
        ? await Product.find({
            _id: { $in: productIds.map((id: string) => new Types.ObjectId(id)) },
            tenantId: po.tenantId,
            isDeleted: false,
        }).select('type inventoryTracked').lean()
        : [];

    const productMap = new Map(products.map((product) => [product._id.toString(), product]));

    const receivableIndexes = lines
        .map((line: any, index: number) => {
            const productId = toObjectIdString(line.productId);
            if (!productId) return index;

            const product = productMap.get(productId);
            if (!product) return index;

            return product.type === 'PRODUCT' && product.inventoryTracked ? index : null;
        })
        .filter((value: number | null): value is number => value !== null);

    if (receivableIndexes.length === 0) {
        return 'NOT_APPLICABLE';
    }

    const confirmedGrns = await GRN.find({
        tenantId: po.tenantId,
        poId: po._id,
        status: 'CONFIRMED',
        isDeleted: false,
    }).select('lines').lean();

    const receivedQtyByLine = new Map<number, number>();
    for (const grn of confirmedGrns) {
        for (const line of grn.lines) {
            receivedQtyByLine.set(
                line.poLineIndex,
                (receivedQtyByLine.get(line.poLineIndex) || 0) + line.receivedQty
            );
        }
    }

    let hasReceipt = false;
    let fullyReceived = true;

    for (const lineIndex of receivableIndexes) {
        const orderedQty = Number(lines[lineIndex]?.quantity || 0);
        const receivedQty = receivedQtyByLine.get(lineIndex) || 0;

        if (receivedQty > RECEIPT_EPSILON) {
            hasReceipt = true;
        }
        if (receivedQty + RECEIPT_EPSILON < orderedQty) {
            fullyReceived = false;
        }
    }

    if (!hasReceipt) return 'NOT_RECEIVED';
    return fullyReceived ? 'FULLY_RECEIVED' : 'PARTIALLY_RECEIVED';
}

async function calculateBillingStatus(po: Pick<IPurchaseOrder, '_id' | 'tenantId' | 'grandTotal'> | any): Promise<POBillingStatus> {
    const invoices = await APInvoice.find({
        tenantId: po.tenantId,
        'source.purchaseOrderId': po._id,
        isDeleted: false,
        status: { $ne: 'VOID' },
    }).select('totals.total').lean();

    if (invoices.length === 0) {
        return 'NOT_BILLED';
    }

    const billedTotal = invoices.reduce((sum, invoice) => sum + Number(invoice.totals?.total || 0), 0);
    if (billedTotal + RECEIPT_EPSILON >= Number(po.grandTotal || 0)) {
        return 'FULLY_BILLED';
    }

    return 'PARTIALLY_BILLED';
}

async function buildLifecycle(tenantId: string, po: any) {
    const basePo = typeof po?.toObject === 'function' ? po.toObject() : po;
    const workingPo = {
        ...basePo,
        tenantId,
        lines: Array.isArray(basePo?.lines) ? basePo.lines : [],
    };
    const [receiptStatus, billingStatus] = await Promise.all([
        calculateReceiptStatus(workingPo),
        calculateBillingStatus(workingPo),
    ]);

    return { receiptStatus, billingStatus };
}

function mapPO(po: any) {
    const data = typeof po.toObject === 'function' ? po.toObject() : po;
    return {
        ...data,
        receiptStatus: data.receiptStatus || 'NOT_RECEIVED',
        billingStatus: data.billingStatus || 'NOT_BILLED',
    };
}

export async function refreshPurchaseOrderLifecycle(tenantId: string, poId: string) {
    const po = await PurchaseOrder.findOne({ _id: poId, tenantId, isDeleted: false });
    if (!po) return null;

    const { receiptStatus, billingStatus } = await buildLifecycle(tenantId, po);
    po.receiptStatus = receiptStatus;
    po.billingStatus = billingStatus;
    await po.save();

    return po;
}

async function nextPoNumber(tenantId: string): Promise<string> {
    const year = new Date().getFullYear();
    const count = await PurchaseOrder.countDocuments({ tenantId, isDeleted: false });
    return `PO-${year}-${String(count + 1).padStart(3, '0')}`;
}

// ─── service ────────────────────────────────────────────────────────────────

export async function getAll(tenantId: string, filters: { search?: string; status?: string; dateFrom?: string; dateTo?: string }) {
    const query: any = { tenantId, isDeleted: false };

    if (filters.status && filters.status !== 'ALL') {
        query.status = filters.status;
    }
    if (filters.search) {
        const re = new RegExp(filters.search, 'i');
        query.$or = [{ poNumber: re }, { vendorName: re }];
    }
    if (filters.dateFrom || filters.dateTo) {
        query.orderDate = {};
        if (filters.dateFrom) query.orderDate.$gte = new Date(filters.dateFrom);
        if (filters.dateTo) query.orderDate.$lte = new Date(filters.dateTo);
    }

    const pos = await PurchaseOrder.find(query).sort({ createdAt: -1 }).lean();

    return Promise.all(
        pos.map(async (po) => ({
            ...po,
            ...(await buildLifecycle(tenantId, po)),
        }))
    );
}

export async function getById(id: string, tenantId: string) {
    await refreshPurchaseOrderLifecycle(tenantId, id);
    const po = await PurchaseOrder.findOne({ _id: id, tenantId, isDeleted: false }).lean();
    if (!po) throw new ServiceError('Purchase Order not found', 'NOT_FOUND');
    return mapPO(po);
}

export async function create(
    dto: {
        vendorId: string;
        orderDate: string;
        expectedDeliveryDate?: string;
        currency?: string;
        notes?: string;
        lines: Array<{
            productId?: string;
            uomId?: string;
            description: string;
            quantity: number;
            unitPrice: number;
            vatRate?: number;
        }>;
        source?: { rfqId?: string; quotationId?: string; rfqNo?: string };
    },
    tenantId: string
) {
    // Validate vendor
    const vendor = await BusinessPartner.findOne({ _id: dto.vendorId, tenantId, isDeleted: false });
    if (!vendor) throw new ServiceError('Vendor not found', 'NOT_FOUND');
    if (!vendor.roles?.includes('VENDOR')) throw new ServiceError('Business Partner is not a vendor', 'VALIDATION');

    if (!dto.lines || dto.lines.length === 0) {
        throw new ServiceError('At least one line is required', 'VALIDATION');
    }

    // Build lines with calc
    const lines: IPOLine[] = dto.lines.map((l) => ({
        productId: l.productId ? new Types.ObjectId(l.productId) : undefined,
        uomId: l.uomId ? new Types.ObjectId(l.uomId) : undefined,
        description: l.description,
        ...calcLine(l.quantity, l.unitPrice, l.vatRate ?? 0),
    }));

    const totals = calcTotals(lines);
    const poNumber = await nextPoNumber(tenantId);
    const baseCurrency = dto.currency || await getTenantBaseCurrency(tenantId);

    const po = new PurchaseOrder({
        tenantId,
        poNumber,
        vendorId: dto.vendorId,
        vendorName: vendor.name,
        source: dto.source ? {
            rfqId: dto.source.rfqId || undefined,
            quotationId: dto.source.quotationId || undefined,
            rfqNo: dto.source.rfqNo || undefined,
        } : undefined,
        orderDate: new Date(dto.orderDate),
        expectedDeliveryDate: dto.expectedDeliveryDate ? new Date(dto.expectedDeliveryDate) : undefined,
        currency: baseCurrency,
        receiptStatus: 'NOT_RECEIVED',
        billingStatus: 'NOT_BILLED',
        notes: dto.notes,
        lines,
        ...totals,
    });

    await po.save();
    return mapPO(po);
}

export async function createFromQuotation(quotationId: string, tenantId: string, extras?: { orderDate?: string; expectedDeliveryDate?: string; notes?: string }) {
    // Validate quotation
    const quotation = await Quotation.findOne({ _id: quotationId, tenantId, isDeleted: false });
    if (!quotation) throw new ServiceError('Quotation not found', 'NOT_FOUND');
    if (quotation.status !== 'APPROVED') throw new ServiceError('Only APPROVED quotations can generate a Purchase Order', 'VALIDATION');

    // Check not already converted
    const existing = await PurchaseOrder.findOne({ 'source.quotationId': quotationId, tenantId, isDeleted: false });
    if (existing) throw new ServiceError(`A Purchase Order (${existing.poNumber}) already exists for this quotation`, 'CONFLICT');

    const rfq = await RFQ.findOne({ _id: quotation.rfqId, tenantId }).lean();

    // Get vendor
    const vendor = await BusinessPartner.findOne({ _id: quotation.vendorId, tenantId, isDeleted: false });
    if (!vendor) throw new ServiceError('Vendor not found', 'NOT_FOUND');

    // Build lines from quotation items (match description from RFQ items)
    const lines: IPOLine[] = quotation.items.map((qi) => {
        const rfqItem = (rfq as any)?.items?.find((ri: any) => String(ri._id) === String(qi.rfqItemId));
        const description = rfqItem?.description || 'Unknown Item';
        const quantity = rfqItem?.quantity || 1;
        return {
            productId: rfqItem?.productId ? new Types.ObjectId(rfqItem.productId) : undefined,
            uomId: rfqItem?.uomId ? new Types.ObjectId(rfqItem.uomId) : undefined,
            description,
            ...calcLine(quantity, qi.unitPrice, 0),
        };
    });

    const totals = calcTotals(lines);
    const poNumber = await nextPoNumber(tenantId);
    const orderDate = extras?.orderDate ? new Date(extras.orderDate) : new Date();
    const baseCurrency = await getTenantBaseCurrency(tenantId);

    const po = new PurchaseOrder({
        tenantId,
        poNumber,
        vendorId: quotation.vendorId,
        vendorName: vendor.name,
        source: {
            rfqId: quotation.rfqId,
            quotationId: quotation._id,
            rfqNo: (rfq as any)?.rfqNo,
        },
        orderDate,
        expectedDeliveryDate: extras?.expectedDeliveryDate ? new Date(extras.expectedDeliveryDate) : undefined,
        currency: baseCurrency,
        receiptStatus: 'NOT_RECEIVED',
        billingStatus: 'NOT_BILLED',
        notes: extras?.notes,
        lines,
        ...totals,
    });

    await po.save();
    return mapPO(po);
}

export async function update(
    id: string,
    dto: {
        orderDate?: string;
        expectedDeliveryDate?: string;
        notes?: string;
        lines?: Array<{
            productId?: string;
            uomId?: string;
            description: string;
            quantity: number;
            unitPrice: number;
            vatRate?: number;
        }>;
    },
    tenantId: string
) {
    const po = await PurchaseOrder.findOne({ _id: id, tenantId, isDeleted: false });
    if (!po) throw new ServiceError('Purchase Order not found', 'NOT_FOUND');
    if (po.status !== 'DRAFT') throw new ServiceError('Only DRAFT purchase orders can be updated', 'INVALID_STATUS');

    if (dto.orderDate) po.orderDate = new Date(dto.orderDate);
    if (dto.expectedDeliveryDate !== undefined)
        po.expectedDeliveryDate = dto.expectedDeliveryDate ? new Date(dto.expectedDeliveryDate) : undefined;
    if (dto.notes !== undefined) po.notes = dto.notes;

    if (dto.lines) {
        if (dto.lines.length === 0) throw new ServiceError('Lines cannot be empty', 'VALIDATION');
        po.lines = dto.lines.map((l) => ({
            productId: l.productId ? new Types.ObjectId(l.productId) : undefined,
            uomId: l.uomId ? new Types.ObjectId(l.uomId) : undefined,
            description: l.description,
            ...calcLine(l.quantity, l.unitPrice, l.vatRate ?? 0),
        }));
        const totals = calcTotals(po.lines);
        po.subtotal = totals.subtotal;
        po.vatTotal = totals.vatTotal;
        po.grandTotal = totals.grandTotal;
    }

    await po.save();
    return mapPO(po);
}

export async function approve(id: string, tenantId: string) {
    const po = await PurchaseOrder.findOne({ _id: id, tenantId, isDeleted: false });
    if (!po) throw new ServiceError('Purchase Order not found', 'NOT_FOUND');
    if (po.status !== 'DRAFT') throw new ServiceError('Only DRAFT purchase orders can be approved', 'INVALID_STATUS');
    if (!po.lines || po.lines.length === 0) throw new ServiceError('Cannot approve PO with no lines', 'VALIDATION');

    po.status = 'APPROVED';
    await po.save();
    return mapPO(po);
}

export async function cancel(id: string, tenantId: string) {
    const po = await PurchaseOrder.findOne({ _id: id, tenantId, isDeleted: false });
    if (!po) throw new ServiceError('Purchase Order not found', 'NOT_FOUND');
    if (!['DRAFT', 'APPROVED'].includes(po.status)) {
        throw new ServiceError('Only DRAFT or APPROVED purchase orders can be cancelled', 'INVALID_STATUS');
    }

    po.status = 'CANCELLED';
    await po.save();
    return mapPO(po);
}

export async function close(id: string, tenantId: string) {
    const po = await PurchaseOrder.findOne({ _id: id, tenantId, isDeleted: false });
    if (!po) throw new ServiceError('Purchase Order not found', 'NOT_FOUND');
    if (po.status !== 'APPROVED') throw new ServiceError('Only APPROVED purchase orders can be closed', 'INVALID_STATUS');

    po.status = 'CLOSED';
    await po.save();
    return mapPO(po);
}

export async function softDelete(id: string, tenantId: string) {
    const po = await PurchaseOrder.findOne({ _id: id, tenantId, isDeleted: false });
    if (!po) throw new ServiceError('Purchase Order not found', 'NOT_FOUND');
    if (po.status !== 'DRAFT') throw new ServiceError('Only DRAFT purchase orders can be deleted', 'INVALID_STATUS');

    po.isDeleted = true;
    await po.save();
}

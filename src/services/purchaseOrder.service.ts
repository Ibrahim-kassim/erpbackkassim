import { PurchaseOrder, IPOLine } from '../models/purchaseOrder.model';
import { Quotation } from '../models/quotation.model';
import { RFQ } from '../models/rfq.model';
import { BusinessPartner } from '../models/businessPartner.model';

class ServiceError extends Error {
    constructor(message: string, public code: string) {
        super(message);
        this.name = 'ServiceError';
    }
}

// ─── helpers ────────────────────────────────────────────────────────────────

function calcLine(qty: number, unitPrice: number, vatRate: number): Omit<IPOLine, 'description'> {
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

    return PurchaseOrder.find(query).sort({ createdAt: -1 }).lean();
}

export async function getById(id: string, tenantId: string) {
    const po = await PurchaseOrder.findOne({ _id: id, tenantId, isDeleted: false }).lean();
    if (!po) throw new ServiceError('Purchase Order not found', 'NOT_FOUND');
    return po;
}

export async function create(
    dto: {
        vendorId: string;
        orderDate: string;
        expectedDeliveryDate?: string;
        currency?: string;
        notes?: string;
        lines: Array<{ description: string; quantity: number; unitPrice: number; vatRate?: number }>;
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
        description: l.description,
        ...calcLine(l.quantity, l.unitPrice, l.vatRate ?? 0),
    }));

    const totals = calcTotals(lines);
    const poNumber = await nextPoNumber(tenantId);

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
        currency: dto.currency || 'USD',
        notes: dto.notes,
        lines,
        ...totals,
    });

    await po.save();
    return po.toObject();
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
            description,
            ...calcLine(quantity, qi.unitPrice, 0),
        };
    });

    const totals = calcTotals(lines);
    const poNumber = await nextPoNumber(tenantId);
    const orderDate = extras?.orderDate ? new Date(extras.orderDate) : new Date();

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
        currency: 'USD',
        notes: extras?.notes,
        lines,
        ...totals,
    });

    await po.save();
    return po.toObject();
}

export async function update(
    id: string,
    dto: {
        orderDate?: string;
        expectedDeliveryDate?: string;
        notes?: string;
        lines?: Array<{ description: string; quantity: number; unitPrice: number; vatRate?: number }>;
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
            description: l.description,
            ...calcLine(l.quantity, l.unitPrice, l.vatRate ?? 0),
        }));
        const totals = calcTotals(po.lines);
        po.subtotal = totals.subtotal;
        po.vatTotal = totals.vatTotal;
        po.grandTotal = totals.grandTotal;
    }

    await po.save();
    return po.toObject();
}

export async function approve(id: string, tenantId: string) {
    const po = await PurchaseOrder.findOne({ _id: id, tenantId, isDeleted: false });
    if (!po) throw new ServiceError('Purchase Order not found', 'NOT_FOUND');
    if (po.status !== 'DRAFT') throw new ServiceError('Only DRAFT purchase orders can be approved', 'INVALID_STATUS');
    if (!po.lines || po.lines.length === 0) throw new ServiceError('Cannot approve PO with no lines', 'VALIDATION');

    po.status = 'APPROVED';
    await po.save();
    return po.toObject();
}

export async function cancel(id: string, tenantId: string) {
    const po = await PurchaseOrder.findOne({ _id: id, tenantId, isDeleted: false });
    if (!po) throw new ServiceError('Purchase Order not found', 'NOT_FOUND');
    if (!['DRAFT', 'APPROVED'].includes(po.status)) {
        throw new ServiceError('Only DRAFT or APPROVED purchase orders can be cancelled', 'INVALID_STATUS');
    }

    po.status = 'CANCELLED';
    await po.save();
    return po.toObject();
}

export async function close(id: string, tenantId: string) {
    const po = await PurchaseOrder.findOne({ _id: id, tenantId, isDeleted: false });
    if (!po) throw new ServiceError('Purchase Order not found', 'NOT_FOUND');
    if (po.status !== 'APPROVED') throw new ServiceError('Only APPROVED purchase orders can be closed', 'INVALID_STATUS');

    po.status = 'CLOSED';
    await po.save();
    return po.toObject();
}

export async function softDelete(id: string, tenantId: string) {
    const po = await PurchaseOrder.findOne({ _id: id, tenantId, isDeleted: false });
    if (!po) throw new ServiceError('Purchase Order not found', 'NOT_FOUND');
    if (po.status !== 'DRAFT') throw new ServiceError('Only DRAFT purchase orders can be deleted', 'INVALID_STATUS');

    po.isDeleted = true;
    await po.save();
}

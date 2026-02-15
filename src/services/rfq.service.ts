import { RFQ, IRFQ } from '../models/rfq.model';
import { BusinessPartner } from '../models/businessPartner.model';
import { Counter } from '../models/counter.model';
import { CreateRFQDTO, UpdateRFQDTO } from '../validators/rfq.schema';

class ServiceError extends Error {
    code: string;
    details?: any;

    constructor(message: string, code: string = 'VALIDATION_ERROR', details?: any) {
        super(message);
        this.code = code;
        this.details = details;
    }
}

// Generate RFQ number in format: RFQ-YYYY-XXX
const generateRFQNumber = async (tenantId: string): Promise<string> => {
    const currentYear = new Date().getFullYear();
    const key = `RFQ-${currentYear}`;

    const counter = await Counter.findOneAndUpdate(
        { tenantId, key },
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
    );

    return `RFQ-${currentYear}-${counter.seq.toString().padStart(3, '0')}`;
};

// Validate that all vendors exist, have VENDOR role, and belong to same tenant
const validateVendors = async (vendorIds: string[], tenantId: string): Promise<void> => {
    if (!vendorIds || vendorIds.length === 0) {
        throw new ServiceError('At least one vendor is required', 'VALIDATION_ERROR');
    }

    const vendors = await BusinessPartner.find({
        _id: { $in: vendorIds },
        tenantId,
        isDeleted: false
    });

    if (vendors.length !== vendorIds.length) {
        throw new ServiceError('One or more vendors not found', 'NOT_FOUND');
    }

    const invalidVendors = vendors.filter(v => !v.roles.includes('VENDOR'));
    if (invalidVendors.length > 0) {
        throw new ServiceError(
            'All business partners must have VENDOR role',
            'VALIDATION_ERROR',
            { invalidVendors: invalidVendors.map(v => v.code) }
        );
    }
};

export const createRFQ = async (dto: CreateRFQDTO, tenantId: string): Promise<IRFQ> => {
    // Validate vendors
    await validateVendors(dto.vendorIds, tenantId);

    // Generate RFQ number
    const rfqNumber = await generateRFQNumber(tenantId);

    // Create RFQ
    const rfq = new RFQ({
        ...dto,
        rfqNumber,
        tenantId,
        status: dto.status || 'DRAFT'
    });

    return await rfq.save();
};

export const updateRFQ = async (id: string, dto: UpdateRFQDTO, tenantId: string): Promise<IRFQ> => {
    const rfq = await RFQ.findOne({ _id: id, tenantId, isDeleted: false });
    if (!rfq) {
        throw new ServiceError('RFQ not found', 'NOT_FOUND');
    }

    // Only DRAFT RFQs can be edited
    if (rfq.status !== 'DRAFT') {
        throw new ServiceError(`Cannot edit RFQ in ${rfq.status} status. Only DRAFT RFQs can be modified.`, 'INVALID_STATUS');
    }

    // If vendorIds are being updated, validate them
    if (dto.vendorIds) {
        await validateVendors(dto.vendorIds, tenantId);
    }

    // Update fields
    Object.assign(rfq, dto);
    return await rfq.save();
};

export const getRFQList = async (query: any, tenantId: string): Promise<{ data: IRFQ[], meta: any }> => {
    const filter: any = { tenantId, isDeleted: false };

    // Search by RFQ number or title
    if (query.search) {
        const regex = { $regex: query.search, $options: 'i' };
        filter.$or = [
            { rfqNumber: regex },
            { title: regex }
        ];
    }

    // Filter by status
    if (query.status && query.status !== 'ALL') {
        filter.status = query.status;
    }

    // Pagination
    const page = parseInt(query.page || '1');
    const limit = parseInt(query.limit || '20');
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
        RFQ.find(filter)
            .populate('vendorIds', 'code name')
            .populate('items.uomId', 'symbol')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        RFQ.countDocuments(filter)
    ]);

    return {
        data: data as IRFQ[],
        meta: {
            total,
            page,
            limit,
            pages: Math.ceil(total / limit)
        }
    };
};

export const getRFQById = async (id: string, tenantId: string): Promise<IRFQ> => {
    const rfq = await RFQ.findOne({ _id: id, tenantId, isDeleted: false })
        .populate('vendorIds', 'code name email phone')
        .populate('items.productId', 'code name')
        .populate('items.uomId', 'name symbol');

    if (!rfq) {
        throw new ServiceError('RFQ not found', 'NOT_FOUND');
    }

    return rfq;
};

export const sendRFQ = async (id: string, tenantId: string): Promise<IRFQ> => {
    const rfq = await RFQ.findOne({ _id: id, tenantId, isDeleted: false });
    if (!rfq) {
        throw new ServiceError('RFQ not found', 'NOT_FOUND');
    }

    // Only DRAFT can be sent
    if (rfq.status !== 'DRAFT') {
        throw new ServiceError(`Cannot send RFQ in ${rfq.status} status. Only DRAFT RFQs can be sent.`, 'INVALID_STATUS');
    }

    rfq.status = 'SENT';
    return await rfq.save();
};

export const closeRFQ = async (id: string, tenantId: string): Promise<IRFQ> => {
    const rfq = await RFQ.findOne({ _id: id, tenantId, isDeleted: false });
    if (!rfq) {
        throw new ServiceError('RFQ not found', 'NOT_FOUND');
    }

    // Only SENT can be closed
    if (rfq.status !== 'SENT') {
        throw new ServiceError(`Cannot close RFQ in ${rfq.status} status. Only SENT RFQs can be closed.`, 'INVALID_STATUS');
    }

    rfq.status = 'CLOSED';
    return await rfq.save();
};

export const deleteRFQ = async (id: string, tenantId: string): Promise<IRFQ> => {
    const rfq = await RFQ.findOne({ _id: id, tenantId, isDeleted: false });
    if (!rfq) {
        throw new ServiceError('RFQ not found', 'NOT_FOUND');
    }

    // Soft delete only
    rfq.isDeleted = true;
    return await rfq.save();
};

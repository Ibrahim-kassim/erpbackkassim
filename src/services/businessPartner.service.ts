import { BusinessPartner } from '../models/businessPartner.model';
import { CreateBusinessPartnerDTO, UpdateBusinessPartnerDTO } from '../validators/businessPartner.schema';


class ServiceError extends Error {
    code: string;
    details?: any;

    constructor(message: string, code: string = 'VALIDATION_ERROR', details?: any) {
        super(message);
        this.code = code;
        this.details = details;
    }
}

import { Counter } from '../models/counter.model';

const getNextSequence = async (key: string, tenantId: string): Promise<string> => {
    const counter = await Counter.findOneAndUpdate(
        { tenantId, key },
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
    );
    // Format: KEY-0001
    return `${key}-${counter.seq.toString().padStart(4, '0')}`;
};

export const createBusinessPartner = async (dto: CreateBusinessPartnerDTO, tenantId: string) => {
    // Generate Code Logic
    let prefix = 'PRT';
    if (dto.roles.length === 1) {
        if (dto.roles.includes('VENDOR')) prefix = 'VND';
        if (dto.roles.includes('CUSTOMER')) prefix = 'CUST';
    } else if (dto.roles.includes('VENDOR') && dto.roles.includes('CUSTOMER')) {
        prefix = 'PRT';
    }

    const generatedCode = await getNextSequence(prefix, tenantId);

    // 2. Create Partner
    const partner = new BusinessPartner({
        ...dto,
        code: generatedCode,
        tenantId
    });
    await partner.save();

    return partner;
};

export const updateBusinessPartner = async (id: string, dto: UpdateBusinessPartnerDTO, tenantId: string) => {
    const partner = await BusinessPartner.findOne({ _id: id, tenantId });
    if (!partner) throw new ServiceError('Business Partner not found', 'NOT_FOUND');

    if (dto.code && dto.code !== partner.code) {
        const existing = await BusinessPartner.findOne({ tenantId, code: dto.code });
        if (existing) throw new ServiceError('Business Partner code already exists', 'CONFLICT');
    }

    // Merge updates
    Object.assign(partner, dto);

    return await partner.save();
};

export const getBusinessPartner = async (id: string, tenantId: string) => {
    const partner = await BusinessPartner.findOne({ _id: id, tenantId });
    if (!partner) throw new ServiceError('Business Partner not found', 'NOT_FOUND');
    return partner;
};

export const getBusinessPartners = async (query: any, tenantId: string) => {
    const filter: any = { tenantId, isDeleted: false };

    // Search
    if (query.search) {
        const regex = { $regex: query.search, $options: 'i' };
        filter.$or = [
            { code: regex },
            { name: regex }
        ];
    }

    // Filters
    if (query.role) {
        filter.roles = query.role;
    }
    if (query.status) {
        filter.status = query.status;
    }

    // Pagination
    const page = parseInt(query.page || '1');
    const limit = parseInt(query.limit || '20');
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
        BusinessPartner.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        BusinessPartner.countDocuments(filter)
    ]);

    return { data, meta: { total, page, limit, pages: Math.ceil(total / limit) } };
};

export const updateStatus = async (id: string, status: 'ACTIVE' | 'INACTIVE', tenantId: string) => {
    const partner = await BusinessPartner.findOne({ _id: id, tenantId });
    if (!partner) throw new ServiceError('Business Partner not found', 'NOT_FOUND');

    partner.status = status;
    return await partner.save();
};

export const softDeleteBusinessPartner = async (id: string, tenantId: string) => {
    const partner = await BusinessPartner.findOne({ _id: id, tenantId });
    if (!partner) throw new ServiceError('Business Partner not found', 'NOT_FOUND');

    partner.isDeleted = true;
    return await partner.save();
};

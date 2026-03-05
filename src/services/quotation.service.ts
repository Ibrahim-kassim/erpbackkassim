import { Quotation, IQuotation } from '../models/quotation.model';
import { RFQ } from '../models/rfq.model';
import { CreateQuotationDTO } from '../validators/quotation.schema';

class ServiceError extends Error {
    code: string;
    constructor(message: string, code: string = 'VALIDATION_ERROR') {
        super(message);
        this.code = code;
    }
}

export const createQuotation = async (dto: CreateQuotationDTO, tenantId: string): Promise<IQuotation> => {
    // Check if RFQ exists and is SENT
    const rfq = await RFQ.findOne({ _id: dto.rfqId, tenantId, isDeleted: false });
    if (!rfq) throw new ServiceError('RFQ not found', 'NOT_FOUND');
    if (rfq.status !== 'SENT') {
        throw new ServiceError(`Cannot submit quotation for RFQ in ${rfq.status} status. RFQ must be SENT.`, 'INVALID_STATUS');
    }

    // Check if vendor is part of the RFQ
    if (!rfq.vendorIds.map(v => v.toString()).includes(dto.vendorId)) {
        throw new ServiceError('Vendor is not invited to this RFQ', 'VALIDATION_ERROR');
    }

    // Upsert: update if already exists, create if not
    const existing = await Quotation.findOne({ rfqId: dto.rfqId, vendorId: dto.vendorId, tenantId, isDeleted: false });
    if (existing) {
        existing.items = dto.items as any;
        existing.total = dto.items.reduce((sum: number, i: any) => sum + i.totalPrice, 0);
        existing.status = 'SUBMITTED';
        return await existing.save();
    }

    const quotation = new Quotation({
        ...dto,
        tenantId,
        status: 'SUBMITTED'
    });

    return await quotation.save();
};

export const getQuotationsByRFQ = async (rfqId: string, tenantId: string): Promise<IQuotation[]> => {
    return await Quotation.find({ rfqId, tenantId, isDeleted: false })
        .populate('vendorId', 'code name')
        .sort({ total: 1 }); // Lowest price first
};

export const selectQuotation = async (id: string, tenantId: string): Promise<IQuotation> => {
    const quotation = await Quotation.findOne({ _id: id, tenantId, isDeleted: false });
    if (!quotation) throw new ServiceError('Quotation not found', 'NOT_FOUND');

    const rfq = await RFQ.findOne({ _id: quotation.rfqId, tenantId, isDeleted: false });
    if (!rfq) throw new ServiceError('Linked RFQ not found', 'NOT_FOUND');

    if (rfq.status !== 'SENT') {
        throw new ServiceError('Can only approve a quotation for SENT RFQs', 'INVALID_STATUS');
    }

    // Update this quotation to APPROVED
    quotation.status = 'APPROVED';
    await quotation.save();

    // Reject all other quotations for this RFQ
    await Quotation.updateMany(
        { rfqId: quotation.rfqId, _id: { $ne: id }, tenantId, isDeleted: false },
        { status: 'REJECTED' }
    );

    // Close the RFQ
    rfq.status = 'CLOSED';
    await rfq.save();

    return quotation;
};

export const deleteQuotation = async (id: string, tenantId: string): Promise<void> => {
    const quotation = await Quotation.findOne({ _id: id, tenantId, isDeleted: false });
    if (!quotation) throw new ServiceError('Quotation not found', 'NOT_FOUND');

    // If quotation was selected, it might have closed the RFQ. 
    // Usually, we shouldn't allow deleting a SELECTED quotation if the RFQ is already CLOSED
    // or we should warn that it doesn't reopen the RFQ unless explicitly handled.
    // For now, let's just allow deletion of SUBMITTED/REJECTED ones easily.

    if (quotation.status === 'APPROVED') {
        throw new ServiceError('Cannot delete an APPROVED quotation. Reopen the RFQ first or select another one.', 'INVALID_STATUS');
    }

    quotation.isDeleted = true;
    await quotation.save();
};

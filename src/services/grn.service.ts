import { Types } from 'mongoose';
import { AccountType, ChartOfAccount, IChartOfAccount, NormalBalance } from '../models/chartOfAccount.model';
import { Counter } from '../models/counter.model';
import { GRN, IGRNLine } from '../models/grn.model';
import { Product } from '../models/inventory/product.model';
import { Stock } from '../models/inventory/stock.model';
import { PurchaseOrder } from '../models/purchaseOrder.model';
import { SystemConfig } from '../models/systemConfig.model';
import { CancelGRNDTO, CreateGRNDTO, UpdateGRNDTO } from '../validators/grn.schema';
import { fiscalService } from './fiscal.service';
import { createAndPostDirectly, reverseEntry } from './journalEntry.service';
import { refreshPurchaseOrderLifecycle } from './purchaseOrder.service';

class ServiceError extends Error {
    constructor(message: string, public code: string = 'VALIDATION_ERROR') {
        super(message);
        this.name = 'ServiceError';
    }
}

const round2 = (value: number) => Math.round(value * 100) / 100;

function isUsablePostingAccount(
    account: IChartOfAccount | null,
    expectedType: AccountType,
    expectedNormalBalance: NormalBalance
): account is IChartOfAccount {
    return !!account
        && account.isActive
        && account.isPosting
        && account.type === expectedType
        && account.normalBalance === expectedNormalBalance;
}

const getAvailablePostingCode = async (tenantId: string, baseCode: string) => {
    const existingCodes = new Set(
        (await ChartOfAccount.find({
            tenantId,
            code: { $regex: `^${baseCode}(?:-\\d+)?$` },
        })
            .select('code')
            .lean())
            .map((account) => account.code)
    );

    if (!existingCodes.has(baseCode)) {
        return baseCode;
    }

    let suffix = 1;
    while (existingCodes.has(`${baseCode}-${suffix.toString().padStart(2, '0')}`)) {
        suffix += 1;
    }

    return `${baseCode}-${suffix.toString().padStart(2, '0')}`;
};

const ensureDefaultPostingAccount = async (
    tenantId: string,
    {
        code,
        name,
        type,
        normalBalance,
    }: {
        code: string;
        name: string;
        type: AccountType;
        normalBalance: NormalBalance;
    }
) => {
    let account = await ChartOfAccount.findOne({
        tenantId,
        name,
        type,
        isPosting: true,
    });

    if (isUsablePostingAccount(account, type, normalBalance)) {
        return account;
    }

    const accountByCode: any = await ChartOfAccount.findOne({ tenantId, code });
    if (isUsablePostingAccount(accountByCode, type, normalBalance)) {
        return accountByCode;
    }

    const createCode = await getAvailablePostingCode(tenantId, code);
    let parentAccount: any = null;
    if (accountByCode && !accountByCode.isPosting) {
        parentAccount = accountByCode;
    }

    account = await ChartOfAccount.create({
        tenantId,
        code: createCode,
        name,
        type,
        normalBalance,
        parentId: parentAccount?._id || null,
        level: parentAccount ? parentAccount.level + 1 : 0,
        path: parentAccount ? `${parentAccount.path}/${createCode}` : `${type}/${createCode}`,
        isPosting: true,
        isActive: true,
        systemControlled: true,
    });

    return account;
};

const getNextGrnNo = async (tenantId: string): Promise<string> => {
    const counter = await Counter.findOneAndUpdate(
        { tenantId, key: 'GRN' },
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
    );
    return `GRN-${counter.seq.toString().padStart(6, '0')}`;
};

const getPurchaseOrder = async (tenantId: string, poId: string) => {
    const po = await PurchaseOrder.findOne({ _id: poId, tenantId, isDeleted: false });
    if (!po) throw new ServiceError('Purchase Order not found', 'NOT_FOUND');
    return po;
};

const getResolvedFiscal = async (tenantId: string, date: Date) => {
    const resolved = await fiscalService.resolveDate(tenantId, date);
    if (!resolved) throw new ServiceError('No fiscal period found for receipt date');
    return resolved;
};

const getConfirmedQtyByLine = async (tenantId: string, poId: string, excludeGrnId?: string) => {
    const filter: any = {
        tenantId,
        poId: new Types.ObjectId(poId),
        status: 'CONFIRMED',
        isDeleted: false,
    };
    if (excludeGrnId) {
        filter._id = { $ne: new Types.ObjectId(excludeGrnId) };
    }

    const confirmed = await GRN.find(filter).lean();
    const receivedMap = new Map<number, number>();

    for (const grn of confirmed) {
        for (const line of grn.lines) {
            receivedMap.set(line.poLineIndex, (receivedMap.get(line.poLineIndex) || 0) + line.receivedQty);
        }
    }

    return receivedMap;
};

const buildLines = async (
    tenantId: string,
    po: any,
    inputLines: CreateGRNDTO['lines'] | UpdateGRNDTO['lines']
): Promise<IGRNLine[]> => {
    if (!inputLines || inputLines.length === 0) {
        throw new ServiceError('At least one receipt line is required');
    }

    const seenLineIndexes = new Set<number>();
    const built: IGRNLine[] = [];

    for (const line of inputLines) {
        if (seenLineIndexes.has(line.poLineIndex)) {
            throw new ServiceError(`PO line ${line.poLineIndex} is duplicated in this GRN`);
        }
        seenLineIndexes.add(line.poLineIndex);

        const poLine = po.lines[line.poLineIndex];
        if (!poLine) {
            throw new ServiceError(`PO line ${line.poLineIndex} does not exist`);
        }

        const resolvedProductId = line.productId || poLine.productId?.toString();

        let productId: Types.ObjectId | undefined;
        if (resolvedProductId) {
            const product = await Product.findOne({
                _id: resolvedProductId,
                tenantId,
                isDeleted: false,
                type: 'PRODUCT',
            });
            if (!product) {
                throw new ServiceError(`Product ${line.productId} was not found or is not stockable`);
            }
            if (!product.inventoryTracked) {
                throw new ServiceError(`Product ${product.code} is not inventory tracked`);
            }
            productId = product._id as Types.ObjectId;
        }

        const unitCost = round2(line.unitCost ?? poLine.unitPrice);
        const lineTotal = round2(unitCost * line.receivedQty);

        built.push({
            poLineIndex: line.poLineIndex,
            description: poLine.description,
            productId,
            orderedQty: poLine.quantity,
            receivedQty: line.receivedQty,
            unitCost,
            lineTotal,
        });
    }

    return built;
};

const validateReceivedQuantities = async (
    tenantId: string,
    po: any,
    lines: IGRNLine[],
    excludeGrnId?: string
) => {
    const confirmedQtyMap = await getConfirmedQtyByLine(tenantId, po._id.toString(), excludeGrnId);

    for (const line of lines) {
        const alreadyReceived = confirmedQtyMap.get(line.poLineIndex) || 0;
        if (alreadyReceived + line.receivedQty > line.orderedQty + 0.0001) {
            throw new ServiceError(
                `PO line ${line.poLineIndex} exceeds ordered quantity. Ordered: ${line.orderedQty}, already received: ${alreadyReceived}, attempted: ${line.receivedQty}`
            );
        }
    }
};

const resolvePostingAccounts = async (tenantId: string) => {
    const config = await SystemConfig.findOne({ tenantId })
        || await SystemConfig.create({ tenantId, defaultAccounts: {}, paymentTermsOptions: ['COD', 'Net 15', 'Net 30', 'Net 60'] });

    const [inventoryAssetFallback, grniLiabilityFallback] = await Promise.all([
        ensureDefaultPostingAccount(tenantId, {
            code: '1300',
            name: 'Inventory Asset',
            type: AccountType.ASSET,
            normalBalance: NormalBalance.DEBIT,
        }),
        ensureDefaultPostingAccount(tenantId, {
            code: '2100',
            name: 'GRNI Liability',
            type: AccountType.LIABILITY,
            normalBalance: NormalBalance.CREDIT,
        }),
    ]);

    const [configuredInventoryAsset, configuredGrniLiability] = await Promise.all([
        config?.defaultAccounts?.inventoryAsset
            ? ChartOfAccount.findOne({ _id: config.defaultAccounts.inventoryAsset, tenantId })
            : null,
        config?.defaultAccounts?.grniLiability
            ? ChartOfAccount.findOne({ _id: config.defaultAccounts.grniLiability, tenantId })
            : null,
    ]);

    const inventoryAsset = isUsablePostingAccount(
        configuredInventoryAsset,
        AccountType.ASSET,
        NormalBalance.DEBIT
    )
        ? configuredInventoryAsset
        : inventoryAssetFallback;

    const grniLiability = isUsablePostingAccount(
        configuredGrniLiability,
        AccountType.LIABILITY,
        NormalBalance.CREDIT
    )
        ? configuredGrniLiability
        : grniLiabilityFallback;

    let configChanged = false;

    if (config.defaultAccounts.inventoryAsset?.toString() !== inventoryAsset._id.toString()) {
        config.defaultAccounts.inventoryAsset = inventoryAsset._id as any;
        configChanged = true;
    }

    if (config.defaultAccounts.grniLiability?.toString() !== grniLiability._id.toString()) {
        config.defaultAccounts.grniLiability = grniLiability._id as any;
        configChanged = true;
    }

    if (configChanged) {
        await config.save();
    }

    return {
        inventoryAssetId: inventoryAsset._id.toString(),
        grniLiabilityId: grniLiability._id.toString(),
    };
};

export const create = async (dto: CreateGRNDTO, tenantId: string) => {
    const po = await getPurchaseOrder(tenantId, dto.poId);
    if (po.status !== 'APPROVED') {
        throw new ServiceError('GRN can only be created for APPROVED purchase orders', 'INVALID_STATUS');
    }

    const receiptDate = new Date(dto.receiptDate);
    const resolved = await getResolvedFiscal(tenantId, receiptDate);
    const lines = await buildLines(tenantId, po, dto.lines);
    await validateReceivedQuantities(tenantId, po, lines);

    const grn = await GRN.create({
        tenantId,
        grnNo: await getNextGrnNo(tenantId),
        poId: po._id,
        poNumber: po.poNumber,
        vendorId: po.vendorId,
        vendorName: po.vendorName,
        receiptDate,
        fiscalPeriodId: resolved.periodId,
        fiscalYearId: resolved.fiscalYearId,
        lines,
        totalCost: round2(lines.reduce((sum, line) => sum + line.lineTotal, 0)),
        notes: dto.notes,
    });

    return grn;
};

export const update = async (id: string, dto: UpdateGRNDTO, tenantId: string) => {
    const grn = await GRN.findOne({ _id: id, tenantId, isDeleted: false });
    if (!grn) throw new ServiceError('GRN not found', 'NOT_FOUND');
    if (grn.status !== 'DRAFT') throw new ServiceError('Only DRAFT GRNs can be updated', 'INVALID_STATUS');

    const po = await getPurchaseOrder(tenantId, grn.poId.toString());

    if (dto.receiptDate) {
        const receiptDate = new Date(dto.receiptDate);
        const resolved = await getResolvedFiscal(tenantId, receiptDate);
        grn.receiptDate = receiptDate;
        grn.fiscalPeriodId = resolved.periodId as any;
        grn.fiscalYearId = resolved.fiscalYearId as any;
    }

    if (dto.notes !== undefined) grn.notes = dto.notes;

    if (dto.lines) {
        const lines = await buildLines(tenantId, po, dto.lines);
        await validateReceivedQuantities(tenantId, po, lines, grn._id.toString());
        grn.lines = lines as any;
        grn.totalCost = round2(lines.reduce((sum, line) => sum + line.lineTotal, 0));
    }

    await grn.save();
    return grn;
};

export const list = async (query: any, tenantId: string) => {
    const filter: any = { tenantId, isDeleted: false };
    if (query.status) filter.status = query.status;
    if (query.poId) filter.poId = new Types.ObjectId(query.poId);
    if (query.dateFrom || query.dateTo) {
        filter.receiptDate = {};
        if (query.dateFrom) filter.receiptDate.$gte = new Date(query.dateFrom);
        if (query.dateTo) filter.receiptDate.$lte = new Date(query.dateTo);
    }

    return GRN.find(filter).sort({ receiptDate: -1, createdAt: -1 }).lean();
};

export const getById = async (id: string, tenantId: string) => {
    const grn = await GRN.findOne({ _id: id, tenantId, isDeleted: false }).lean();
    if (!grn) throw new ServiceError('GRN not found', 'NOT_FOUND');
    return grn;
};

export const confirm = async (id: string, tenantId: string) => {
    const grn = await GRN.findOne({ _id: id, tenantId, isDeleted: false });
    if (!grn) throw new ServiceError('GRN not found', 'NOT_FOUND');
    if (grn.status !== 'DRAFT') throw new ServiceError('Only DRAFT GRNs can be confirmed', 'INVALID_STATUS');

    const po = await getPurchaseOrder(tenantId, grn.poId.toString());
    if (po.status !== 'APPROVED') {
        throw new ServiceError('GRN can only be confirmed for APPROVED purchase orders', 'INVALID_STATUS');
    }

    await validateReceivedQuantities(tenantId, po, grn.lines);

    const linesMissingProducts = grn.lines.filter(line => !line.productId);
    if (linesMissingProducts.length > 0) {
        throw new ServiceError('Every GRN line must be linked to a product before confirmation');
    }

    const { inventoryAssetId, grniLiabilityId } = await resolvePostingAccounts(tenantId);

    for (const line of grn.lines) {
        await Stock.findOneAndUpdate(
            { tenantId, productId: line.productId, isDeleted: false },
            {
                $inc: { quantityOnHand: line.receivedQty },
                $setOnInsert: {
                    tenantId,
                    productId: line.productId,
                    reservedQuantity: 0,
                    isDeleted: false,
                },
            },
            { upsert: true, new: true }
        );
    }

    const je = await createAndPostDirectly(tenantId, {
        entryType: 'Goods Receipt Note',
        postingDate: grn.receiptDate,
        description: `Goods receipt for ${grn.poNumber}`,
        reference: grn.grnNo,
        sourceType: 'GRN',
        sourceId: grn._id.toString(),
        sourceNo: grn.grnNo,
        lines: [
            {
                accountId: inventoryAssetId,
                debit: grn.totalCost,
                credit: 0,
                description: `Inventory received via ${grn.grnNo}`,
            },
            {
                accountId: grniLiabilityId,
                debit: 0,
                credit: grn.totalCost,
                description: `GRNI recognized via ${grn.grnNo}`,
            },
        ],
    });

    grn.status = 'CONFIRMED';
    grn.journalEntryId = je._id as any;
    grn.journalEntryNo = je.entryNo;
    await grn.save();

    await refreshPurchaseOrderLifecycle(tenantId, grn.poId.toString());
    return grn;
};

export const cancel = async (id: string, dto: CancelGRNDTO, tenantId: string) => {
    const grn = await GRN.findOne({ _id: id, tenantId, isDeleted: false });
    if (!grn) throw new ServiceError('GRN not found', 'NOT_FOUND');
    if (grn.status === 'CANCELLED') {
        throw new ServiceError('GRN is already cancelled', 'CONFLICT');
    }

    if (grn.status === 'DRAFT') {
        grn.status = 'CANCELLED';
        await grn.save();
        return grn;
    }

    const cancellationDate = dto.cancellationDate ? new Date(dto.cancellationDate) : new Date();
    const resolved = await getResolvedFiscal(tenantId, cancellationDate);

    for (const line of grn.lines) {
        if (!line.productId) continue;

        const stock = await Stock.findOne({ tenantId, productId: line.productId, isDeleted: false });
        if (!stock) {
            throw new ServiceError(`Stock record for product on line ${line.poLineIndex} was not found`, 'CONFLICT');
        }
        if (stock.quantityOnHand < line.receivedQty) {
            throw new ServiceError(
                `Cannot cancel ${grn.grnNo} because stock for line ${line.poLineIndex} has already been consumed`,
                'CONFLICT'
            );
        }

        stock.quantityOnHand = round2(stock.quantityOnHand - line.receivedQty);
        await stock.save();
    }

    if (grn.journalEntryId) {
        await reverseEntry(
            grn.journalEntryId.toString(),
            {
                reason: dto.reason || `Cancellation of ${grn.grnNo}`,
                reversalDate: cancellationDate,
                fiscalPeriodId: resolved.periodId.toString(),
            },
            tenantId
        );
    }

    grn.status = 'CANCELLED';
    await grn.save();

    await refreshPurchaseOrderLifecycle(tenantId, grn.poId.toString());
    return grn;
};

export const remove = async (id: string, tenantId: string) => {
    const grn = await GRN.findOne({ _id: id, tenantId, isDeleted: false });
    if (!grn) throw new ServiceError('GRN not found', 'NOT_FOUND');
    if (grn.status !== 'DRAFT') throw new ServiceError('Only DRAFT GRNs can be deleted', 'INVALID_STATUS');

    grn.isDeleted = true;
    await grn.save();
};

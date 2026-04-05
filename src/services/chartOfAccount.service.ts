import { ChartOfAccount, AccountType, NormalBalance, IChartOfAccount } from '../models/chartOfAccount.model';
import { CreateAccountDTO, ImportAccountRowDTO, UpdateAccountDTO } from '../validators/chartOfAccount.schema';
import mongoose, { Types } from 'mongoose';

class ServiceError extends Error {
    code: string;
    details?: any;

    constructor(message: string, code: string = 'VALIDATION_ERROR', details?: any) {
        super(message);
        this.code = code;
        this.details = details;
    }
}

const deriveNormalBalance = (type: AccountType): NormalBalance => {
    if ([AccountType.ASSET, AccountType.EXPENSE, AccountType.CASH].includes(type)) {
        return NormalBalance.DEBIT;
    }
    // LIABILITY, EQUITY, REVENUE, INCOME
    return NormalBalance.CREDIT;
};

export const createAccount = async (dto: CreateAccountDTO, tenantId: string) => {
    const existing = await ChartOfAccount.findOne({ tenantId, code: dto.code });
    if (existing) {
        throw new ServiceError(`Account with code ${dto.code} already exists`, 'CONFLICT');
    }

    let level = 0;
    let path = '';
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    let parent: IChartOfAccount | null = null;
    const normalBalance = deriveNormalBalance(dto.type);

    if (dto.parentId) {
        if (!Types.ObjectId.isValid(dto.parentId)) {
            throw new ServiceError('Invalid parentId format');
        }
        parent = await ChartOfAccount.findOne({ _id: dto.parentId, tenantId });
        if (!parent) {
            throw new ServiceError('Parent account not found', 'NOT_FOUND');
        }

        if (parent.isPosting) {
            throw new ServiceError('Cannot add child to a posting account. Parent must be a header account.');
        }

        if (parent.type !== dto.type) {
            throw new ServiceError(`Child account type (${dto.type}) must match parent type (${parent.type})`);
        }

        level = parent.level + 1;
        path = `${parent.path}/${dto.code}`;
    } else {
        level = 0;
        path = `${dto.type}/${dto.code}`;
    }

    const account = new ChartOfAccount({
        ...dto,
        tenantId,
        normalBalance,
        level,
        path,
        systemControlled: false
    });

    return await account.save();
};

export const updateAccount = async (id: string, dto: UpdateAccountDTO, tenantId: string) => {
    const account = await ChartOfAccount.findOne({ _id: id, tenantId });
    if (!account) {
        throw new ServiceError('Account not found', 'NOT_FOUND');
    }

    if (account.systemControlled) {
        if (dto.isActive === false) {
            throw new ServiceError('Cannot deactivate a system-controlled account', 'FORBIDDEN');
        }
        if (dto.name && dto.name !== account.name) {
            throw new ServiceError('Cannot rename a system-controlled account', 'FORBIDDEN');
        }
    }

    if (dto.name) account.name = dto.name;
    if (dto.description !== undefined) account.description = dto.description;

    if (dto.isActive === false && account.isActive === true) {
        const activeChildren = await ChartOfAccount.countDocuments({ tenantId, parentId: account._id, isActive: true });
        if (activeChildren > 0) {
            throw new ServiceError('Cannot deactivate account with active children', 'CONFLICT');
        }
        account.isActive = false;
    } else if (dto.isActive === true) {
        account.isActive = true;
    }

    if (dto.isPosting !== undefined && dto.isPosting !== account.isPosting) {
        if (dto.isPosting === true) {
            const childCount = await ChartOfAccount.countDocuments({ tenantId, parentId: account._id });
            if (childCount > 0) {
                throw new ServiceError('Cannot change to posting account because it has children', 'CONFLICT');
            }
        }
        account.isPosting = dto.isPosting;
    }

    if (dto.type && dto.type !== account.type) {
        // Check if has children
        const childCount = await ChartOfAccount.countDocuments({ tenantId, parentId: account._id });
        if (childCount > 0) {
            throw new ServiceError('Cannot change type of an account that has children', 'CONFLICT');
        }

        // Check availability with parent (if exists)
        if (account.parentId) {
            const parent = await ChartOfAccount.findOne({ _id: account.parentId, tenantId });
            if (parent && parent.type !== dto.type) {
                throw new ServiceError('Account type must match parent account type', 'CONFLICT');
            }
        }

        account.type = dto.type;
        account.normalBalance = deriveNormalBalance(dto.type);
    }

    // Parent Change Logic
    if (dto.parentId !== undefined) {
        const newParentIdStr = dto.parentId || null;
        const oldParentIdStr = account.parentId ? account.parentId.toString() : null;

        if (newParentIdStr !== oldParentIdStr) {
            const oldPath = account.path;
            const oldLevel = account.level;

            let newParent: IChartOfAccount | null = null;
            let newLevel = 0;
            let newPathPrefix = '';

            if (newParentIdStr) {
                // Prevent setting parent to itself
                if (newParentIdStr === account._id.toString()) {
                    throw new ServiceError('Cannot set parent to itself', 'CONFLICT');
                }

                newParent = await ChartOfAccount.findOne({ _id: newParentIdStr, tenantId });
                if (!newParent) throw new ServiceError('New parent account not found', 'NOT_FOUND');

                if (newParent.isPosting) throw new ServiceError('Cannot set parent to a posting account');
                if (newParent.type !== account.type) throw new ServiceError(`Parent type must match account type`);

                // Prevent circular reference (newParent should not be a descendant of account)
                if (newParent.path.startsWith(oldPath + '/')) {
                    throw new ServiceError('Cannot move account under its own descendant', 'CONFLICT');
                }

                newLevel = newParent.level + 1;
                newPathPrefix = newParent.path;
            } else {
                newLevel = 0;
                newPathPrefix = account.type;
            }

            // Update current account
            account.parentId = newParentIdStr ? new Types.ObjectId(newParentIdStr) : null;
            account.level = newLevel;
            account.path = `${newPathPrefix}/${account.code}`;

            // Update all descendants
            // We perform this update after saving the main account to ensure atomicity 
            // (though proper transactions would be better, strictness here is handled via logic)

            // Calculate level valid for diff
            const levelDiff = newLevel - oldLevel;

            // Find descendants using oldPath
            // We need to use a regex that matches strictly children
            const descendants = await ChartOfAccount.find({
                tenantId,
                path: new RegExp(`^${oldPath}/`)
            });

            for (const desc of descendants) {
                // Replace prefix
                const suffix = desc.path.substring(oldPath.length);
                desc.path = account.path + suffix;
                desc.level = desc.level + levelDiff;
                await desc.save();
            }
        }
    }

    await account.save();
    return account;
};

export const listAccounts = async (query: any, tenantId: string) => {
    const filter: any = { tenantId };
    if (query.code) filter.code = { $regex: query.code, $options: 'i' };
    if (query.name) filter.name = { $regex: query.name, $options: 'i' };
    if (query.type) filter.type = query.type;
    if (query.isActive !== undefined) filter.isActive = query.isActive === 'true';
    if (query.isPosting !== undefined) filter.isPosting = query.isPosting === 'true';

    if (query.parentId) {
        if (query.parentId === 'null') {
            filter.parentId = null;
        } else if (mongoose.Types.ObjectId.isValid(query.parentId)) {
            filter.parentId = query.parentId;
        }
        // If invalid ID and not 'null', we might want to return empty or ignore.
        // For now, if it's explicitly sent, we filter by it. valid checks prevent 500.
    }

    return await ChartOfAccount.find(filter).sort({ code: 1 }).populate('childrenCount');
};

export const deleteAccount = async (id: string, tenantId: string) => {
    const account = await ChartOfAccount.findOne({ _id: id, tenantId });
    if (!account) throw new ServiceError('Account not found', 'NOT_FOUND');

    if (account.systemControlled) {
        throw new ServiceError('Cannot delete a system-controlled account', 'FORBIDDEN');
    }

    const childrenCount = await ChartOfAccount.countDocuments({ tenantId, parentId: id });
    if (childrenCount > 0) {
        throw new ServiceError('Cannot delete account with children', 'CONFLICT');
    }

    // TODO: Check for existing Journal Entries when that module is built
    // const hasEntries = await JournalEntry.exists({ accountId: id });
    // if (hasEntries) throw new ServiceError('Cannot delete account with transactions', 'CONFLICT');

    await ChartOfAccount.deleteOne({ _id: id });
};

export const getAccountById = async (id: string, tenantId: string) => {
    const account = await ChartOfAccount.findOne({ _id: id, tenantId });
    if (!account) throw new ServiceError('Account not found', 'NOT_FOUND');
    return account;
};

export const getPostingAccounts = async (tenantId: string) => {
    return await ChartOfAccount.find({ tenantId, isPosting: true, isActive: true }).sort({ code: 1 });
};

export const getAccountTree = async (tenantId: string) => {
    const accounts = await ChartOfAccount.find({ tenantId }).sort({ code: 1 }).lean();

    const map = new Map();
    const roots: any[] = [];

    // specific types for frontend
    accounts.forEach(acc => {
        map.set(acc._id.toString(), { ...acc, children: [] });
    });

    accounts.forEach(acc => {
        const node = map.get(acc._id.toString());
        if (acc.parentId) {
            const parent = map.get(acc.parentId.toString());
            if (parent) {
                parent.children.push(node);
            } else {
                // Parent might happen to be missing/inactive if filtered, 
                // but here we fetched all. Fallback to root or strict?
                // Let's treat as root if parent missing in implementation choice,
                // or just ignore. Safety: push to roots.
                roots.push(node);
            }
        } else {
            roots.push(node);
        }
    });

    return roots;
};

type StarterChartTemplateRow = {
    code: string;
    name: string;
    type: AccountType;
    isPosting: boolean;
    isActive?: boolean;
    description?: string;
    systemControlled?: boolean;
    parentCode?: string | null;
};

const defaultStarterTemplate: StarterChartTemplateRow[] = [
    { code: '1000', name: 'Application Of Funds', type: AccountType.ASSET, isPosting: false },
    { code: '1100', name: 'Cash In Hand', type: AccountType.ASSET, isPosting: false, parentCode: '1000' },
    { code: '1200', name: 'Bank Accounts', type: AccountType.ASSET, isPosting: true, parentCode: '1100' },
    { code: '1300', name: 'Accounts Receivable', type: AccountType.ASSET, isPosting: false, parentCode: '1000', systemControlled: true },
    { code: '1400', name: 'Stock Assets', type: AccountType.ASSET, isPosting: false, parentCode: '1000' },
    { code: '1500', name: 'Tax Assets', type: AccountType.ASSET, isPosting: false, parentCode: '1000' },
    { code: '1600', name: 'Loans and Advances', type: AccountType.ASSET, isPosting: false, parentCode: '1000' },
    { code: '1700', name: 'Fixed Assets', type: AccountType.ASSET, isPosting: false, parentCode: '1000' },
    { code: '1800', name: 'Investments', type: AccountType.ASSET, isPosting: true, parentCode: '1000' },
    { code: '1900', name: 'Temporary Accounts', type: AccountType.ASSET, isPosting: false, parentCode: '1000' },
    { code: '2000', name: 'Source Of Funds', type: AccountType.LIABILITY, isPosting: false },
    { code: '2100', name: 'Accounts Payable', type: AccountType.LIABILITY, isPosting: true, parentCode: '2000', systemControlled: true },
    { code: '2200', name: 'Tax Liabilities', type: AccountType.LIABILITY, isPosting: false, parentCode: '2000' },
    { code: '3000', name: 'Equity', type: AccountType.EQUITY, isPosting: false },
    { code: '3999', name: 'Opening Balance Equity', type: AccountType.EQUITY, isPosting: true, parentCode: '3000', systemControlled: true },
    { code: '4000', name: 'Income', type: AccountType.INCOME, isPosting: false },
    { code: '4100', name: 'Sales Revenue', type: AccountType.REVENUE, isPosting: true, parentCode: '4000' },
    { code: '5000', name: 'Expenses', type: AccountType.EXPENSE, isPosting: false },
    { code: '5100', name: 'Operating Expense', type: AccountType.EXPENSE, isPosting: true, parentCode: '5000' },
];

const sanitizeImportRow = (row: ImportAccountRowDTO | StarterChartTemplateRow) => ({
    code: row.code.trim().toUpperCase(),
    name: row.name.trim(),
    type: row.type,
    parentCode: row.parentCode?.trim().toUpperCase() || null,
    isPosting: Boolean(row.isPosting),
    isActive: row.isActive ?? true,
    description: row.description?.trim() || undefined,
    systemControlled: 'systemControlled' in row ? Boolean(row.systemControlled) : false,
});

async function getStarterTemplateRows(): Promise<StarterChartTemplateRow[]> {
    const demoAccounts = await ChartOfAccount.find({ tenantId: 'tenant_demo' }).sort({ code: 1 }).lean();
    if (!demoAccounts.length) {
        return defaultStarterTemplate;
    }

    const codeById = new Map(demoAccounts.map((account: any) => [account._id.toString(), account.code]));
    return demoAccounts.map((account: any) => ({
        code: account.code,
        name: account.name,
        type: account.type,
        isPosting: Boolean(account.isPosting),
        isActive: Boolean(account.isActive),
        description: account.description,
        systemControlled: Boolean(account.systemControlled),
        parentCode: account.parentId ? codeById.get(account.parentId.toString()) || null : null,
    }));
}

async function applyAccountTemplateRows(tenantId: string, rows: Array<ImportAccountRowDTO | StarterChartTemplateRow>, mode: 'create' | 'upsert' = 'upsert') {
    const normalizedRows = rows.map(sanitizeImportRow);
    const seenCodes = new Set<string>();

    for (const row of normalizedRows) {
        if (seenCodes.has(row.code)) {
            throw new ServiceError(`Duplicate account code in import/template: ${row.code}`, 'CONFLICT');
        }
        seenCodes.add(row.code);
    }

    const existingAccounts = await ChartOfAccount.find({ tenantId }).lean();
    const existingByCode = new Map(existingAccounts.map((account: any) => [account.code, account]));
    const stagedByCode = new Map<string, any>();
    const pending = [...normalizedRows];
    let progress = true;

    while (pending.length > 0 && progress) {
        progress = false;

        for (let index = pending.length - 1; index >= 0; index -= 1) {
            const row = pending[index];
            const parent = row.parentCode
                ? stagedByCode.get(row.parentCode) || existingByCode.get(row.parentCode)
                : null;

            if (row.parentCode && !parent) {
                continue;
            }

            if (parent && parent.isPosting) {
                throw new ServiceError(`Parent account ${row.parentCode} must be a header/folder account`, 'VALIDATION_ERROR');
            }

            const level = parent ? parent.level + 1 : 0;
            const path = parent ? `${parent.path}/${row.code}` : `${row.type}/${row.code}`;
            const normalBalance = deriveNormalBalance(row.type);
            const existing = existingByCode.get(row.code);

            if (existing) {
                if (mode === 'create') {
                    throw new ServiceError(`Account with code ${row.code} already exists`, 'CONFLICT');
                }

                const updated = await ChartOfAccount.findOneAndUpdate(
                    { _id: existing._id, tenantId },
                    {
                        $set: {
                            name: row.name,
                            type: row.type,
                            description: row.description,
                            isPosting: row.isPosting,
                            isActive: row.isActive,
                            parentId: parent?._id || null,
                            level,
                            path,
                            normalBalance,
                            systemControlled: row.systemControlled || existing.systemControlled,
                        },
                    },
                    { new: true }
                ).lean();

                existingByCode.set(row.code, updated);
                stagedByCode.set(row.code, updated);
            } else {
                const created = await ChartOfAccount.create({
                    tenantId,
                    code: row.code,
                    name: row.name,
                    type: row.type,
                    description: row.description,
                    isPosting: row.isPosting,
                    isActive: row.isActive,
                    parentId: parent?._id || null,
                    level,
                    path,
                    normalBalance,
                    systemControlled: row.systemControlled,
                });

                const leanCreated = created.toObject();
                existingByCode.set(row.code, leanCreated);
                stagedByCode.set(row.code, leanCreated);
            }

            pending.splice(index, 1);
            progress = true;
        }
    }

    if (pending.length > 0) {
        throw new ServiceError(
            `Some accounts could not be processed because their parents are missing: ${pending.map((row) => `${row.code} -> ${row.parentCode}`).join(', ')}`,
            'VALIDATION_ERROR'
        );
    }
}

export const createStarterChart = async (tenantId: string) => {
    const existingCount = await ChartOfAccount.countDocuments({ tenantId });
    if (existingCount > 0) {
        throw new ServiceError('Chart of Accounts already contains records for this tenant', 'CONFLICT');
    }

    const templateRows = await getStarterTemplateRows();
    await applyAccountTemplateRows(tenantId, templateRows, 'create');
    return getAccountTree(tenantId);
};

export const importAccounts = async (tenantId: string, rows: ImportAccountRowDTO[]) => {
    await applyAccountTemplateRows(tenantId, rows, 'upsert');
    return getAccountTree(tenantId);
};

import { ChartOfAccount, AccountType, NormalBalance, IChartOfAccount } from '../models/chartOfAccount.model';
import { CreateAccountDTO, UpdateAccountDTO } from '../validators/chartOfAccount.schema';
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

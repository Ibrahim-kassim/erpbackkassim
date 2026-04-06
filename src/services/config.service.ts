import { Types } from 'mongoose';
import { ChartOfAccount } from '../models/chartOfAccount.model';
import { SystemConfig } from '../models/systemConfig.model';
import { UpdateSystemConfigDTO } from '../validators/config.schema';

class ServiceError extends Error {
    constructor(message: string, public code: string = 'VALIDATION_ERROR') {
        super(message);
        this.name = 'ServiceError';
    }
}

const accountFields = [
    'accountsPayable',
    'accountsReceivable',
    'inventoryAsset',
    'grniLiability',
    'cashAccount',
    'bankAccount',
    'vatPayable',
    'vatReceivable',
    'inventoryAdjustment',
    'cogsAccount',
    'retainedEarnings',
] as const;

const getOrCreateConfig = async (tenantId: string) => {
    let config = await SystemConfig.findOne({ tenantId });
    if (!config) {
        config = await SystemConfig.create({ tenantId });
    }
    return config;
};

const validateAccount = async (tenantId: string, accountId: string, fieldName: string) => {
    const account = await ChartOfAccount.findOne({ _id: accountId, tenantId });
    if (!account) {
        throw new ServiceError(`Default account "${fieldName}" was not found for this tenant`);
    }
    if (!account.isActive || !account.isPosting) {
        throw new ServiceError(`Default account "${fieldName}" must be active and posting`);
    }
    return account._id;
};

export const getConfig = async (tenantId: string) => {
    return getOrCreateConfig(tenantId);
};

export const updateConfig = async (tenantId: string, dto: UpdateSystemConfigDTO) => {
    const config = await getOrCreateConfig(tenantId);

    if (dto.companyName !== undefined) config.companyName = dto.companyName;
    if (dto.companyLogo !== undefined) config.companyLogo = dto.companyLogo;
    if (dto.documentBranding !== undefined) {
        config.documentBranding = {
            ...(config.documentBranding || {}),
            ...dto.documentBranding,
        };
    }
    if (dto.emailSettings !== undefined) {
        config.emailSettings = {
            ...(config.emailSettings || {}),
            ...dto.emailSettings,
        };
    }
    if (dto.address !== undefined) {
        config.address = {
            ...(config.address || {}),
            ...dto.address,
        };
    }
    if (dto.phone !== undefined) config.phone = dto.phone;
    if (dto.email !== undefined) config.email = dto.email;
    if (dto.taxNumber !== undefined) config.taxNumber = dto.taxNumber;
    if (dto.currency !== undefined) config.currency = dto.currency;
    if (dto.dateFormat !== undefined) config.dateFormat = dto.dateFormat;
    if (dto.paymentTermsOptions !== undefined) config.paymentTermsOptions = dto.paymentTermsOptions;
    if (dto.vatRate !== undefined) config.vatRate = dto.vatRate;

    if (dto.defaultAccounts) {
        for (const field of accountFields) {
            if (!(field in dto.defaultAccounts)) continue;

            const value = dto.defaultAccounts[field];
            if (value === null) {
                (config.defaultAccounts as any)[field] = undefined;
                continue;
            }
            if (value !== undefined) {
                const accountId = await validateAccount(tenantId, value, field);
                (config.defaultAccounts as any)[field] = new Types.ObjectId(accountId.toString());
            }
        }
    }

    await config.save();
    return config;
};

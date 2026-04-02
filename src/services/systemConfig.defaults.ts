import { SystemConfig } from '../models/systemConfig.model';

export const getTenantBaseCurrency = async (tenantId: string) => {
    const config = await SystemConfig.findOne({ tenantId }).select('currency').lean();
    return config?.currency || 'USD';
};

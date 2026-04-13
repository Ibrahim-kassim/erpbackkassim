import { Request } from 'express';
import { ipKeyGenerator } from 'express-rate-limit';

export const getRateLimitCallerKey = (req: Request): string => {
    const tenantId = req.tenantId ?? 'unknown-tenant';
    const userId = req.userId ?? 'unknown-user';
    const safeIp = ipKeyGenerator(req.ip ?? 'unknown-ip');
    return `${tenantId}:${userId}:${safeIp}`;
};


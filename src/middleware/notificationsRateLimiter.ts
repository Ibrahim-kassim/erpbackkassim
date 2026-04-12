import rateLimit from 'express-rate-limit';
import { Request } from 'express';

const getCallerKey = (req: Request): string => {
    const tenantId = req.tenantId ?? 'unknown-tenant';
    const userId = req.userId ?? req.ip ?? 'unknown-caller';
    return `${tenantId}:${userId}`;
};

export const notificationsRateLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 calls per minute per caller
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: getCallerKey,
    message: {
        code: 'TOO_MANY_REQUESTS',
        message: 'Notifications API rate limit exceeded (10 requests/min). Please try again in one minute.',
    },
});

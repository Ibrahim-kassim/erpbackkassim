import rateLimit from 'express-rate-limit';
import { Request } from 'express';
import { getRateLimitCallerKey } from './rateLimitKey';

export const customerReceiptsRateLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 calls per minute per caller
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: getRateLimitCallerKey,
    skip: (req: Request) => req.path === '/aging' || req.path === '/customer-statement',
    message: {
        code: 'TOO_MANY_REQUESTS',
        message: 'Customer Receipts API rate limit exceeded (10 requests/min). Please try again in one minute.',
    },
});

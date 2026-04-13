import rateLimit from 'express-rate-limit';
import { getRateLimitCallerKey } from './rateLimitKey';

export const journalEntryRateLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 calls per minute per caller
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: getRateLimitCallerKey,
    message: {
        code: 'TOO_MANY_REQUESTS',
        message: 'Journal Entries API rate limit exceeded (10 requests/min). Please try again in one minute.',
    },
});

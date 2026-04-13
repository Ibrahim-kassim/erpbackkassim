import rateLimit from 'express-rate-limit';
import { Request } from 'express';
import { getRateLimitCallerKey } from './rateLimitKey';

const buildDashboardChatLimiter = (
    max: number,
    windowMs: number,
    label: string
) =>
    rateLimit({
        windowMs,
        max,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: getRateLimitCallerKey,
        handler: (req, res, _next, options) => {
            const rateLimitInfo = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit;
            const resetTime = rateLimitInfo?.resetTime?.getTime();
            const retryAfterSeconds = Math.max(
                1,
                Math.ceil(
                    ((typeof resetTime === 'number' ? resetTime : Date.now() + windowMs) - Date.now()) / 1000
                )
            );

            res.setHeader('Retry-After', String(retryAfterSeconds));
            res.status(options.statusCode).json({
                code: 'TOO_MANY_REQUESTS',
                message: `${label} rate limit exceeded. Please try again in ${retryAfterSeconds} second(s).`,
                retryAfterSeconds,
            });
        },
    });

// Read endpoints (session lists / fetch / export artifact)
export const dashboardChatReadRateLimiter = buildDashboardChatLimiter(
    120,
    60 * 1000,
    'Dashboard Chat read'
);

// Session bootstrap (new/resume session)
export const dashboardChatSessionRateLimiter = buildDashboardChatLimiter(
    30,
    60 * 1000,
    'Dashboard Chat session'
);

// Conversation requests (LLM-heavy endpoints)
export const dashboardChatConversationRateLimiter = buildDashboardChatLimiter(
    40,
    60 * 1000,
    'Dashboard Chat conversation'
);

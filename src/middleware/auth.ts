import { Request, Response, NextFunction } from 'express';

// Extend Express Request to include tenantId
declare global {
    namespace Express {
        interface Request {
            tenantId?: string;
        }
    }
}

export const auth = (req: Request, res: Response, next: NextFunction) => {
    // Placeholder for real auth. 
    // For now, hardcode a tenantId or read from headers if needed.
    // Using "tenant_demo" as requested for no-auth scenario.
    req.tenantId = 'tenant_demo';
    next();
};

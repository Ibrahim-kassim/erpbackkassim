import { Request, Response, NextFunction } from 'express';

/**
 * Role-based access control middleware.
 * Usage: router.post('/', requireRole('ADMIN', 'ACCOUNTANT'), controller)
 */
export const requireRole = (...roles: string[]) => {
    return (req: Request, res: Response, next: NextFunction): void => {
        if (!req.userRole || !roles.includes(req.userRole)) {
            res.status(403).json({
                code: 'FORBIDDEN',
                message: `Access denied. Required roles: ${roles.join(', ')}`,
            });
            return;
        }
        next();
    };
};

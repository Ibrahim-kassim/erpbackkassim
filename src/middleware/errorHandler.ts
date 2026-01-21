import { Request, Response, NextFunction } from 'express';

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
    const statusCode = res.statusCode === 200 ? 500 : res.statusCode;

    // Custom error shapes can be handled here
    const errorResponse = {
        code: err.code || 'INTERNAL_SERVER_ERROR',
        message: err.message || 'Server Error',
        details: err.details || null,
        stack: process.env.NODE_ENV === 'production' ? null : err.stack,
    };

    res.status(statusCode).json(errorResponse);
};

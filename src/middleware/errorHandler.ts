import { Request, Response, NextFunction } from 'express';

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
    // Log error for debugging
    console.error(' [Error Handler] ', {
        message: err.message,
        code: err.code,
        details: err.details,
        stack: err.stack,
        path: req.path,
        method: req.method
    });

    let statusCode = res.statusCode === 200 ? 500 : res.statusCode;

    // Handle Mongoose Errors
    if (err.name === 'ValidationError') {
        statusCode = 400;
        err.code = 'VALIDATION_ERROR';
        err.details = Object.values(err.errors).map((e: any) => e.message);
    }
    if (err.name === 'CastError') {
        statusCode = 400;
        err.code = 'INVALID_ID';
        err.message = `Invalid ${err.kind}: ${err.value}`;
    }

    // Map ServiceError codes to HTTP status codes
    if (err.code === 'NOT_FOUND') statusCode = 404;
    if (err.code === 'VALIDATION_ERROR') statusCode = 400;
    if (err.code === 'INVALID_STATUS') statusCode = 400;
    if (err.code === 'CONFLICT') statusCode = 409;
    if (err.code === 'FORBIDDEN') statusCode = 403;
    if (err.code === 'UNAUTHORIZED') statusCode = 401;

    const errorResponse = {
        code: err.code || 'INTERNAL_SERVER_ERROR',
        message: err.message || 'Server Error',
        details: err.details || null,
        stack: process.env.NODE_ENV === 'production' ? null : err.stack,
    };

    res.status(statusCode).json(errorResponse);
};

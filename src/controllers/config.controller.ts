import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import * as configService from '../services/config.service';
import { updateSystemConfigSchema } from '../validators/config.schema';

export const getConfig = asyncHandler(async (req: Request, res: Response) => {
    const data = await configService.getConfig(req.tenantId!);
    res.status(200).json({ data });
});

export const updateConfig = asyncHandler(async (req: Request, res: Response) => {
    const validation = updateSystemConfigSchema.safeParse(req.body);
    if (!validation.success) {
        res.status(400).json({
            code: 'VALIDATION_ERROR',
            message: 'Invalid inputs',
            details: validation.error.format(),
        });
        return;
    }

    const data = await configService.updateConfig(req.tenantId!, validation.data);
    res.status(200).json({ data });
});

import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { fiscalService } from '../services/fiscal.service';
import { createFiscalYearSchema, generatePeriodsSchema, updateFiscalYearSchema, updatePeriodStatusSchema } from '../validators/fiscal.schema';

// List Years
export const getFiscalYears = asyncHandler(async (req: Request, res: Response) => {
    const years = await fiscalService.getFiscalYears(req.tenantId!);
    res.json({ data: years });
});

// Create Year
export const createFiscalYear = asyncHandler(async (req: Request, res: Response) => {
    const data = createFiscalYearSchema.parse(req.body);
    const year = await fiscalService.createFiscalYear(req.tenantId!, data);
    res.status(201).json({ data: year });
});

// Get Year Details
export const getFiscalYearById = asyncHandler(async (req: Request, res: Response) => {
    const year = await fiscalService.getFiscalYearById(req.tenantId!, req.params.id);
    if (!year) throw new Error('Fiscal year not found');
    res.json({ data: year });
});

// Update Year
export const updateFiscalYear = asyncHandler(async (req: Request, res: Response) => {
    const data = updateFiscalYearSchema.parse(req.body);
    const year = await fiscalService.updateFiscalYear(req.tenantId!, req.params.id, data);
    res.json({ data: year });
});

// Close Year
export const closeFiscalYear = asyncHandler(async (req: Request, res: Response) => {
    const year = await fiscalService.closeFiscalYear(req.tenantId!, req.params.id);
    res.json({ data: year });
});

// Generate Periods
export const generatePeriods = asyncHandler(async (req: Request, res: Response) => {
    const data = generatePeriodsSchema.parse(req.body);
    const periods = await fiscalService.generatePeriods(req.tenantId!, req.params.id, data);
    res.json({ data: periods });
});

// Update Period Status
export const updatePeriodStatus = asyncHandler(async (req: Request, res: Response) => {
    const { status } = updatePeriodStatusSchema.parse(req.body);
    const result = await fiscalService.updatePeriodStatus(
        req.tenantId!,
        req.params.yearId,
        req.params.periodId,
        status
    );
    res.json({ data: result });
});

// Resolve Date
export const resolveDate = asyncHandler(async (req: Request, res: Response) => {
    const dateStr = req.query.date as string;
    if (!dateStr) throw new Error('Date is required');
    const result = await fiscalService.resolveDate(req.tenantId!, new Date(dateStr));
    res.json({ data: result }); // Can be null
});

// Integrity Check (Admin)
export const checkIntegrity = asyncHandler(async (req: Request, res: Response) => {
    // Ideally this service method would exist in fiscal.service or journalEntry.service
    // For simplicity, we can implement basic logic here or call a new service method.
    // Let's call a service method to keep controller clean.
    const issues = await fiscalService.checkJournalIntegrity(req.tenantId!);
    res.json({ data: issues, count: issues.length });
});

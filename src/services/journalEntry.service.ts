import { JournalEntry, EntryStatus } from '../models/journalEntry.model';
import { ChartOfAccount, IChartOfAccount } from '../models/chartOfAccount.model';
import { FiscalPeriod, FiscalPeriodStatus } from '../models/fiscalPeriod.model';
import { Counter } from '../models/counter.model';
import { CreateDraftDTO, UpdateDraftDTO, ReverseEntryDTO } from '../validators/journalEntry.schema';
import mongoose, { Types } from 'mongoose';

class ServiceError extends Error {
    code: string;
    details?: any;

    constructor(message: string, code: string = 'VALIDATION_ERROR', details?: any) {
        super(message);
        this.code = code;
        this.details = details;
    }
}

import { fiscalService } from './fiscal.service';

// Helper: Get next sequence
const getNextEntryNo = async (tenantId: string): Promise<string> => {
    const ret = await Counter.findOneAndUpdate(
        { tenantId, key: 'JE' },
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
    );
    const num = ret.seq.toString().padStart(6, '0');
    return `JE-${num}`;
};

// Removed local validateFiscalPeriod in favor of fiscalService.resolveDate logic inside post/create logic
// where we need robust Period + Year + Status checks.

// Helper: Validate Lines & Snapshot Accounts
const validateAndSnapshotLines = async (tenantId: string, lines: any[]) => {
    // ... existing implementation
    const accountIds = lines.map(l => l.accountId);
    const accounts = await ChartOfAccount.find({
        _id: { $in: accountIds },
        tenantId
    });

    const accountMap = new Map<string, IChartOfAccount>();
    accounts.forEach(a => accountMap.set(a._id.toString(), a));

    let debitTotal = 0;
    let creditTotal = 0;

    const processedLines = lines.map(line => {
        const acc = accountMap.get(line.accountId.toString());
        if (!acc) throw new ServiceError(`Account ${line.accountId} not found`, 'VALIDATION_ERROR');
        if (!acc.isActive) throw new ServiceError(`Account ${acc.code} is inactive`, 'VALIDATION_ERROR');
        if (!acc.isPosting) throw new ServiceError(`Account ${acc.code} is a header account (not posting)`, 'VALIDATION_ERROR');

        // Round to 2 decimals
        const deb = Math.round((line.debit || 0) * 100) / 100;
        const cred = Math.round((line.credit || 0) * 100) / 100;

        debitTotal += deb;
        creditTotal += cred;

        return {
            accountId: acc._id,
            accountCode: acc.code,
            accountName: acc.name,
            description: line.description,
            debit: deb,
            credit: cred
        };
    });

    debitTotal = Math.round(debitTotal * 100) / 100;
    creditTotal = Math.round(creditTotal * 100) / 100;

    if (Math.abs(debitTotal - creditTotal) > 0.001) {
        throw new ServiceError(`Journal Entry is not balanced. Debit: ${debitTotal}, Credit: ${creditTotal}`, 'VALIDATION_ERROR');
    }

    return { lines: processedLines, debitTotal, creditTotal };
};

export const createDraft = async (dto: CreateDraftDTO, tenantId: string) => {
    const { lines, debitTotal, creditTotal } = await validateAndSnapshotLines(tenantId, dto.lines);
    const entryNo = await getNextEntryNo(tenantId);

    // Initial check for period valid if provided, but strict check is on POST
    // We allow DRAFT to have any period/date initially? 
    // Usually yes, but let's keep it clean.
    // If user provided fiscalPeriodId, we accept it for now.
    // However, schema requires it.

    const entry = new JournalEntry({
        tenantId,
        entryNo,
        status: EntryStatus.DRAFT,
        entryType: dto.entryType || 'Journal Entry',
        postingDate: dto.postingDate,
        fiscalPeriodId: dto.fiscalPeriodId,
        // fiscalYearId set on post usually, or now?
        // Let's set it if we can resolve it, else wait for post.
        description: dto.description,
        reference: dto.reference,
        sourceType: dto.sourceType,
        sourceId: dto.sourceId,
        sourceNo: dto.sourceNo,
        lines,
        totals: { debitTotal, creditTotal }
    });

    // Attempt to resolve to set initial Year ID if possible (optional for Draft)
    try {
        const resolved = await fiscalService.resolveDate(tenantId, new Date(dto.postingDate));
        if (resolved) {
            entry.fiscalYearId = resolved.fiscalYearId;
            entry.fiscalPeriodId = resolved.periodId as any; // Auto-correct period if needed
        }
    } catch (e) {
        // Ignore for draft
    }

    // Temporary hack if fiscalYearId required by validation but not resolved:
    // We made it required in Schema. So we MUST resolve it or fail.
    // Let's relax schema or require valid date.
    // Ideally DRAFT should be flexible. But our schema has required=true.
    // So we invoke resolveDate.

    if (!entry.fiscalYearId) {
        // Try resolve again and fail if cannot
        const resolved = await fiscalService.resolveDate(tenantId, new Date(dto.postingDate));
        if (!resolved) throw new ServiceError('No fiscal year found for this date', 'VALIDATION_ERROR');
        entry.fiscalYearId = resolved.fiscalYearId;
        entry.fiscalPeriodId = resolved.periodId as any;
    }

    return await entry.save();
};

export const updateDraft = async (id: string, dto: UpdateDraftDTO, tenantId: string) => {
    const entry = await JournalEntry.findOne({ _id: id, tenantId });
    if (!entry) throw new ServiceError('Entry not found', 'NOT_FOUND');
    if (entry.status !== EntryStatus.DRAFT) {
        throw new ServiceError('Cannot edit lines of a POSTED/REVERSED entry', 'FORBIDDEN');
    }

    if (dto.lines) {
        const result = await validateAndSnapshotLines(tenantId, dto.lines);
        entry.lines = result.lines as any;
        entry.totals.debitTotal = result.debitTotal;
        entry.totals.creditTotal = result.creditTotal;
    }

    if (dto.postingDate) entry.postingDate = dto.postingDate;
    if (dto.entryType) entry.entryType = dto.entryType as any;
    // We will re-resolve period/year on save or post

    if (dto.description !== undefined) entry.description = dto.description;
    if (dto.reference !== undefined) entry.reference = dto.reference;

    // If date changed, re-resolve year
    if (dto.postingDate) {
        const resolved = await fiscalService.resolveDate(tenantId, new Date(dto.postingDate));
        if (resolved) {
            entry.fiscalYearId = resolved.fiscalYearId;
            entry.fiscalPeriodId = resolved.periodId as any;
        }
    }

    return await entry.save();
};

export const postEntry = async (id: string, tenantId: string) => {
    const entry = await JournalEntry.findOne({ _id: id, tenantId });
    if (!entry) throw new ServiceError('Entry not found', 'NOT_FOUND');

    if (entry.status === EntryStatus.POSTED) return entry;
    if (entry.status === EntryStatus.REVERSED) throw new ServiceError('Cannot post a reversed entry', 'CONFLICT');

    // 1. Resolve and Validate Fiscal Period Integrity
    const resolved = await fiscalService.resolveDate(tenantId, entry.postingDate);
    if (!resolved) {
        throw new ServiceError(`No fiscal period found for date ${entry.postingDate.toISOString().split('T')[0]}`, 'VALIDATION_ERROR');
    }

    if (resolved.status !== 'OPEN') {
        throw new ServiceError(`Fiscal period ${resolved.code} is ${resolved.status}. Cannot post.`, 'FORBIDDEN');
    }

    // Update with authoritative Source of Truth
    entry.fiscalYearId = resolved.fiscalYearId;
    entry.fiscalPeriodId = resolved.periodId as any;
    entry.fiscalPeriodLabelSnapshot = resolved.label;

    // 2. Lock check for source
    if (entry.sourceType && entry.sourceId) {
        const existing = await JournalEntry.findOne({
            tenantId,
            sourceType: entry.sourceType,
            sourceId: entry.sourceId,
            status: EntryStatus.POSTED,
            _id: { $ne: entry._id }
        });
        if (existing) throw new ServiceError('A posted journal entry already exists for this source document', 'CONFLICT');
    }

    // 3. Re-validate accounts
    const lineAccountIds = entry.lines.map(l => l.accountId);
    const accounts = await ChartOfAccount.find({ _id: { $in: lineAccountIds }, tenantId });
    const accMap = new Map(accounts.map(a => [a._id.toString(), a]));

    for (const line of entry.lines) {
        const acc = accMap.get(line.accountId.toString());
        if (!acc || !acc.isActive || !acc.isPosting) {
            throw new ServiceError(`Account ${line.accountCode} is no longer valid for posting`, 'CONFLICT');
        }
    }

    entry.status = EntryStatus.POSTED;
    entry.postedAt = new Date();

    return await entry.save();
};

export const reverseEntry = async (id: string, dto: ReverseEntryDTO, tenantId: string) => {
    const original = await JournalEntry.findOne({ _id: id, tenantId });
    if (!original) throw new ServiceError('Entry not found', 'NOT_FOUND');

    if (original.status !== EntryStatus.POSTED) {
        throw new ServiceError('Only POSTED entries can be reversed', 'FORBIDDEN');
    }
    if (original.reversedByEntryId) {
        throw new ServiceError('Entry is already reversed', 'CONFLICT');
    }

    // Validate new period
    // Validate new period
    const resolved = await fiscalService.resolveDate(tenantId, dto.reversalDate);
    if (!resolved) {
        throw new ServiceError('No fiscal period found for reversal date', 'VALIDATION_ERROR');
    }
    if (resolved.status !== 'OPEN') {
        throw new ServiceError(`Fiscal period ${resolved.code} is ${resolved.status}. Cannot post reversal.`, 'FORBIDDEN');
    }
    // Also check if dto.fiscalPeriodId matches resolved?
    // If user passed a specific period ID, we should check it matches resolved to be safe, 
    // or just trust resolveDate. 
    // Spec says "valid fiscal period".
    if (dto.fiscalPeriodId && resolved.periodId.toString() !== dto.fiscalPeriodId) {
        // mismatch warning or error?
        // Let's rely on resolveDate as truth.
    }

    // Create Reversal Lines (flip debit/credit)
    const reversedLines = original.lines.map(l => ({
        accountId: l.accountId,
        accountCode: l.accountCode, // Keep snapshot or refresh? Usually keep origin to trace.
        accountName: l.accountName,
        description: l.description ? `(Reversal) ${l.description}` : `Reversal`,
        debit: l.credit,
        credit: l.debit
    }));

    const newEntryNo = await getNextEntryNo(tenantId);

    const reversalEntry = new JournalEntry({
        tenantId,
        entryNo: newEntryNo,
        status: EntryStatus.POSTED, // Direct post? or Draft? Requirement says 'status=POSTED directly'
        postingDate: dto.reversalDate,
        fiscalPeriodId: resolved.periodId,
        fiscalYearId: resolved.fiscalYearId,
        fiscalPeriodLabelSnapshot: resolved.label,
        description: `Reversal of ${original.entryNo} - ${original.description || ''}`.substring(0, 500),
        reference: dto.reason || `Reversal of ${original.entryNo}`,
        sourceType: 'REVERSAL',
        sourceId: original._id, // Link to original
        sourceNo: original.entryNo,
        lines: reversedLines,
        totals: { // Swapped totals same magnitude
            debitTotal: original.totals.creditTotal,
            creditTotal: original.totals.debitTotal
        },
        postedAt: new Date()
    });

    await reversalEntry.save();

    // Mark original
    original.status = EntryStatus.REVERSED;
    original.reversedByEntryId = reversalEntry._id as any;
    original.reversedAt = new Date();
    await original.save();

    return reversalEntry;
};

export const listEntries = async (query: any, tenantId: string) => {
    const filter: any = { tenantId };

    // Status filter
    if (query.status) filter.status = query.status;
    if (query.sourceType) filter.sourceType = query.sourceType;
    if (query.fiscalPeriodId) filter.fiscalPeriodId = query.fiscalPeriodId;

    // Dates
    if (query.dateFrom || query.dateTo) {
        filter.postingDate = {};
        if (query.dateFrom) filter.postingDate.$gte = new Date(query.dateFrom);
        if (query.dateTo) filter.postingDate.$lte = new Date(query.dateTo);
    }

    // Search
    if (query.search) {
        const regex = { $regex: query.search, $options: 'i' };
        filter.$or = [
            { entryNo: regex },
            { description: regex },
            { reference: regex },
            { sourceNo: regex }
        ];
    }

    // Pagination
    const page = parseInt(query.page || '1');
    const limit = parseInt(query.limit || '50');
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
        JournalEntry.find(filter)
            .sort({ postingDate: -1, entryNo: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        JournalEntry.countDocuments(filter)
    ]);

    return { data, meta: { total, page, limit, pages: Math.ceil(total / limit) } };
};

export const validateEntryFiscal = async (id: string, tenantId: string) => {
    const entry = await JournalEntry.findOne({ _id: id, tenantId });
    if (!entry) throw new ServiceError('Entry not found', 'NOT_FOUND');

    try {
        const resolved = await fiscalService.resolveDate(tenantId, entry.postingDate);
        if (!resolved) {
            return {
                allowedToPost: false,
                reason: 'No fiscal period matches posting date',
                postingDate: entry.postingDate
            };
        }

        return {
            allowedToPost: resolved.status === 'OPEN',
            reason: resolved.status === 'OPEN' ? null : `Period is ${resolved.status}`,
            period: resolved,
            postingDate: entry.postingDate
        };
    } catch (e: any) {
        return { allowedToPost: false, reason: e.message, postingDate: entry.postingDate };
    }
};

export const getEntryById = async (id: string, tenantId: string) => {
    const entry = await JournalEntry.findOne({ _id: id, tenantId });
    if (!entry) throw new ServiceError('Entry not found', 'NOT_FOUND');
    return entry;
};

export const deleteDraft = async (id: string, tenantId: string) => {
    const entry = await JournalEntry.findOne({ _id: id, tenantId });
    if (!entry) throw new ServiceError('Entry not found', 'NOT_FOUND');

    if (entry.status !== EntryStatus.DRAFT) {
        throw new ServiceError('Only DRAFT entries can be deleted', 'FORBIDDEN');
    }

    await JournalEntry.deleteOne({ _id: id, tenantId });
};

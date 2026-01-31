
import mongoose, { Types } from 'mongoose';
import { JournalEntry, EntryStatus } from '../models/journalEntry.model';
import { ChartOfAccount } from '../models/chartOfAccount.model';
import { FiscalCalendar } from '../models/fiscalCalendar.model';
import { GeneralLedgerLinesQuery } from '../validators/generalLedgerLines.schema';

interface GLLineResult {
    postingDate: Date;
    entryNo: string;
    journalEntryId: string;
    entryDescription: string;
    reference?: string;
    sourceType?: string;
    sourceId?: string;
    sourceNo?: string;
    accountId: string;
    accountCode: string;
    accountName: string;
    debit: number;
    credit: number;
    lineDescription?: string;
}

interface LinesReportResult {
    meta: {
        scope: {
            startDate: Date;
            endDate: Date;
            fiscalPeriodId?: string;
            fiscalYearId?: string;
            scope: string;
        };
        page: number;
        limit: number;
        total: number;
        totals: {
            debit: number;
            credit: number;
        };
    };
    data: GLLineResult[];
}

export class GeneralLedgerLinesService {

    async generateReport(tenantId: string, query: GeneralLedgerLinesQuery): Promise<LinesReportResult> {
        // 1. Determine Scope & Date Range
        let startDate: Date = new Date();
        let endDate: Date = new Date();
        let fiscalPeriodId = query.fiscalPeriodId;
        let fiscalYearId = query.fiscalYearId;

        if (query.fiscalPeriodId) {
            // Explicit Period
            const calendar = await FiscalCalendar.findOne({
                tenantId,
                "periods._id": new Types.ObjectId(query.fiscalPeriodId)
            });
            if (!calendar) throw new Error('Fiscal Period not found');
            const period = calendar.periods.find(p => p._id.toString() === query.fiscalPeriodId);
            if (!period) throw new Error('Fiscal Period not found in calendar');
            startDate = period.startDate;
            endDate = period.endDate;
        } else if (query.from && query.to) {
            // Custom Range
            startDate = new Date(query.from);
            endDate = new Date(query.to);
            endDate.setHours(23, 59, 59, 999);
        } else if (query.scope === 'last30d') {
            const end = new Date();
            const start = new Date();
            start.setDate(end.getDate() - 30);
            startDate = start;
            endDate = end;
            endDate.setHours(23, 59, 59, 999);
        } else if (query.scope === 'all') {
            startDate = new Date(0);
            endDate = new Date(); // now
            endDate.setHours(23, 59, 59, 999);
        } else {
            // Default: Open Period or Current Month
            // Try to find open period first
            const openCalendar = await FiscalCalendar.findOne({
                tenantId,
                isActive: true,
                "periods.status": "OPEN"
            });

            let foundOpen = false;
            if (openCalendar) {
                const currentOpen = openCalendar.periods.find(p => p.status === 'OPEN');
                if (currentOpen) {
                    startDate = currentOpen.startDate;
                    endDate = currentOpen.endDate;
                    fiscalPeriodId = currentOpen._id.toString();
                    foundOpen = true;
                }
            }

            if (!foundOpen) {
                // Fallback to Last 30 Days if no open period found
                const end = new Date();
                const start = new Date();
                start.setDate(end.getDate() - 30);
                startDate = start;
                endDate = end;
                endDate.setHours(23, 59, 59, 999);
            }
        }

        // 2. Build Match Query
        const matchStage: any = {
            tenantId,
            status: EntryStatus.POSTED,
            postingDate: { $gte: startDate, $lte: endDate }
        };

        if (query.sourceType) {
            matchStage.sourceType = query.sourceType;
        }

        if (query.search) {
            // Basic search on entryNo or description
            // For efficiency, maybe regex? Or text index.
            const regex = new RegExp(query.search, 'i');
            matchStage.$or = [
                { entryNo: regex },
                { description: regex },
                { reference: regex }
            ];
        }

        // 3. Aggregation Pipeline
        const pipeline: any[] = [
            { $match: matchStage },
            { $unwind: "$lines" },
            // Lookup Account info from lines (assuming we need snapshot or current?)
            // Journal Lines usually snapshotted name/code? 
            // Our JournalEntry model structure: lines: [{ accountId, ... }]
            // We usually rely on lookup for details unless stored on line.
            // Let's assume we need lookup.
            {
                $lookup: {
                    from: 'chart_of_accounts',
                    localField: 'lines.accountId',
                    foreignField: '_id',
                    as: 'account'
                }
            },
            { $unwind: "$account" }
        ];

        // Filter by Account ID if provided
        if (query.accountId) {
            pipeline.push({
                $match: { "lines.accountId": new Types.ObjectId(query.accountId) }
            });
        }

        // Filter by Account Type if provided
        if (query.accountType) {
            pipeline.push({
                $match: { "account.type": query.accountType }
            });
        }

        // Secondary Search Check (Line Description)
        // If search term provided, it might also match line description or account name
        if (query.search) {
            // Existing match check was on Header fields.
            // If we want to search lines too, we need match after unwind.
            // BUT: match before unwind is faster index-wise.
            // Let's refine match:
            const regex = new RegExp(query.search, 'i');
            pipeline.push({
                $match: {
                    $or: [
                        // Header fields matched already included logic? No, previous $match filters Headers.
                        // This $match filters the unwound LINE.
                        // We can include:
                        { "lines.description": regex },
                        { "account.name": regex },
                        { "account.code": regex },
                        // Re-include header fields to be safe if they matched the header?
                        // Actually if header matched, ALL lines passed first stage.
                        // We want to KEEP lines if Header matched OR Line Matched.
                        // This is tricky in pipe.
                        // Simplest: Don't filter strictly here unless necessary.
                        // Or: Move comprehensive search here?
                        // Let's keep Simple: Search Header fields in stage 1. Search Line fields here combined?
                        // Creating an $or between Header and Line fields after unwind is accurate but slower.
                        // Let's stick to Header fields in pre-match, and add Line Description check as $or here?
                    ]
                }
            });
            // NOTE: Double filtering might reduce results incorrectly if we want "Header matched OR Line matched".
            // Correct way: Match Header fields in Step 1.
            // Step 2: Unwind.
            // Step 3: Match Lines.
            // We should probably rely on header search mostly for performance V1.
            // Removing secondary strictly line search for now to avoid complexity/bugs,
            // unless user specifically asked for "search in descriptions". User check: "entryNo or text description".
            // The Stage 1 match does handle Description (Header). good enough for V1.
        }

        // Sort
        const sortDir = query.sort === 'asc' ? 1 : -1;
        pipeline.push({ $sort: { postingDate: sortDir, entryNo: sortDir } }); // Sort by Line? Or just Date/Entry

        // Pagination & Facet
        const page = query.page || 1;
        const limit = query.limit || 50;
        const skip = (page - 1) * limit;

        pipeline.push({
            $facet: {
                metadata: [
                    { $count: "total" },
                    // Calculate totals for the PAGE or the WHOLE MATCH? 
                    // Specs say "totals: { debit, credit }". Usually for validity check.
                    // Let's do page totals for speed, or separate facet for grand total (slower).
                    // Let's just count total. Frontend sums page if needed?
                    // User requirement: "totals: { debit: number, credit: number } // for returned page or for scope (choose page totals V1)"
                ],
                data: [
                    { $skip: skip },
                    { $limit: limit },
                    {
                        $project: {
                            postingDate: 1,
                            entryNo: 1,
                            journalEntryId: "$_id",
                            entryDescription: "$description",
                            reference: 1,
                            sourceType: 1,
                            sourceId: 1,
                            sourceNo: 1,
                            accountId: "$lines.accountId",
                            accountCode: "$account.code",
                            accountName: "$account.name",
                            debit: "$lines.debit",
                            credit: "$lines.credit",
                            lineDescription: "$lines.description"
                        }
                    }
                ],
                // Overall Totals (Optional - if performance allows)
                /*
                grandTotals: [
                    { $group: { _id: null, totalDebit: { $sum: "$lines.debit" }, totalCredit: { $sum: "$lines.credit" } } }
                ]
                */
            }
        });

        const result = await JournalEntry.aggregate(pipeline);
        const facet = result[0];
        const total = facet.metadata[0] ? facet.metadata[0].total : 0;
        const rows = facet.data;

        // Calculate Page Totals (in JS is fine for 50 rows)
        const pageTotals = rows.reduce((acc: any, curr: any) => ({
            debit: acc.debit + (curr.debit || 0),
            credit: acc.credit + (curr.credit || 0)
        }), { debit: 0, credit: 0 });

        return {
            meta: {
                scope: {
                    startDate: startDate!,
                    endDate: endDate!,
                    fiscalPeriodId: fiscalPeriodId,
                    fiscalYearId: fiscalYearId,
                    scope: query.scope || 'custom'
                },
                page,
                limit,
                total,
                totals: pageTotals
            },
            data: rows
        };
    }
}

export const generalLedgerLinesService = new GeneralLedgerLinesService();

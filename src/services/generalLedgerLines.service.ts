import { Types } from 'mongoose';
import { JournalEntry, EntryStatus } from '../models/journalEntry.model';
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
    accountType: string;
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
            label: string;
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
        let startDate = new Date();
        let endDate = new Date();
        let fiscalPeriodId = query.fiscalPeriodId;
        let fiscalYearId = query.fiscalYearId;
        let scopeLabel = 'Current Open Period';

        if (query.fiscalPeriodId) {
            const calendar = await FiscalCalendar.findOne({
                tenantId,
                'periods._id': new Types.ObjectId(query.fiscalPeriodId),
            });
            if (!calendar) throw new Error('Fiscal Period not found');

            const period = calendar.periods.find((entry) => entry._id.toString() === query.fiscalPeriodId);
            if (!period) throw new Error('Fiscal Period not found in calendar');

            startDate = period.startDate;
            endDate = period.endDate;
            fiscalYearId = calendar._id.toString();
            scopeLabel = period.label;
        } else if (query.from && query.to) {
            startDate = new Date(query.from);
            endDate = new Date(query.to);
            endDate.setHours(23, 59, 59, 999);
            scopeLabel = `${query.from} to ${query.to}`;
        } else if (query.scope === 'last30d') {
            endDate = new Date();
            startDate = new Date();
            startDate.setDate(endDate.getDate() - 30);
            endDate.setHours(23, 59, 59, 999);
            scopeLabel = 'Last 30 Days';
        } else if (query.scope === 'all') {
            startDate = new Date(0);
            endDate = new Date();
            endDate.setHours(23, 59, 59, 999);
            scopeLabel = 'All Time';
        } else {
            const openCalendar = await FiscalCalendar.findOne({
                tenantId,
                isActive: true,
                'periods.status': 'OPEN',
            });

            const currentOpen = openCalendar?.periods.find((period) => period.status === 'OPEN');
            if (currentOpen) {
                startDate = currentOpen.startDate;
                endDate = currentOpen.endDate;
                fiscalPeriodId = currentOpen._id.toString();
                fiscalYearId = openCalendar!._id.toString();
                scopeLabel = currentOpen.label;
            } else {
                endDate = new Date();
                startDate = new Date();
                startDate.setDate(endDate.getDate() - 30);
                endDate.setHours(23, 59, 59, 999);
                scopeLabel = 'Last 30 Days';
            }
        }

        const matchStage: any = {
            tenantId,
            status: EntryStatus.POSTED,
            postingDate: { $gte: startDate, $lte: endDate },
        };

        if (query.sourceType) {
            matchStage.sourceType = query.sourceType;
        }

        const pipeline: any[] = [
            { $match: matchStage },
            { $unwind: '$lines' },
            {
                $lookup: {
                    from: 'chart_of_accounts',
                    localField: 'lines.accountId',
                    foreignField: '_id',
                    as: 'account',
                },
            },
            { $unwind: '$account' },
        ];

        if (query.accountId) {
            pipeline.push({ $match: { 'lines.accountId': new Types.ObjectId(query.accountId) } });
        }

        if (query.accountType) {
            pipeline.push({ $match: { 'account.type': query.accountType } });
        }

        if (query.search) {
            const regex = new RegExp(query.search, 'i');
            pipeline.push({
                $match: {
                    $or: [
                        { entryNo: regex },
                        { description: regex },
                        { reference: regex },
                        { sourceNo: regex },
                        { 'lines.description': regex },
                        { 'account.name': regex },
                        { 'account.code': regex },
                    ],
                },
            });
        }

        const sortDir = query.sort === 'asc' ? 1 : -1;
        pipeline.push({ $sort: { postingDate: sortDir, entryNo: sortDir, _id: sortDir } });

        const page = query.page || 1;
        const limit = query.limit || 50;
        const skip = (page - 1) * limit;

        pipeline.push({
            $facet: {
                metadata: [
                    {
                        $group: {
                            _id: null,
                            total: { $sum: 1 },
                            debit: { $sum: '$lines.debit' },
                            credit: { $sum: '$lines.credit' },
                        },
                    },
                ],
                data: [
                    { $skip: skip },
                    { $limit: limit },
                    {
                        $project: {
                            postingDate: 1,
                            entryNo: 1,
                            journalEntryId: '$_id',
                            entryDescription: '$description',
                            reference: 1,
                            sourceType: 1,
                            sourceId: 1,
                            sourceNo: 1,
                            accountId: '$lines.accountId',
                            accountCode: '$account.code',
                            accountType: '$account.type',
                            accountName: '$account.name',
                            debit: '$lines.debit',
                            credit: '$lines.credit',
                            lineDescription: '$lines.description',
                        },
                    },
                ],
            },
        });

        const [result] = await JournalEntry.aggregate(pipeline);
        const metadata = result?.metadata?.[0] || { total: 0, debit: 0, credit: 0 };

        return {
            meta: {
                scope: {
                    startDate,
                    endDate,
                    fiscalPeriodId,
                    fiscalYearId,
                    scope: query.fiscalPeriodId || query.from ? 'custom' : (query.scope || 'openPeriod'),
                    label: scopeLabel,
                },
                page,
                limit,
                total: metadata.total || 0,
                totals: {
                    debit: metadata.debit || 0,
                    credit: metadata.credit || 0,
                },
            },
            data: result?.data || [],
        };
    }
}

export const generalLedgerLinesService = new GeneralLedgerLinesService();

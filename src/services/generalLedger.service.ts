
import mongoose, { Types } from 'mongoose';
import { JournalEntry, EntryStatus } from '../models/journalEntry.model';
import { ChartOfAccount, AccountType, NormalBalance } from '../models/chartOfAccount.model';
import { FiscalCalendar } from '../models/fiscalCalendar.model';
import { GeneralLedgerQuery } from '../validators/generalLedger.schema';

interface LedgerRow {
    postingDate: Date;
    entryNo: string;
    journalEntryId: string;
    description: string;
    reference?: string;
    sourceType?: string;
    sourceId?: string;
    sourceNo?: string;
    lineDescription?: string;
    debit: number;
    credit: number;
    runningNet: number;
    runningDr: number;
    runningCr: number;
}

interface GeneralLedgerResult {
    meta: {
        account: {
            id: string;
            code: string;
            name: string;
            type: string;
            normalBalance: string;
        };
        scope: {
            label: string;
            startDate: Date | null;
            endDate: Date;
            filters: any;
        };
        opening: {
            net: number;
            dr: number;
            cr: number;
            debit: number; // Raw sum
            credit: number; // Raw sum
        };
        closing: {
            net: number;
            dr: number;
            cr: number;
        };
        totals: {
            debit: number;
            credit: number;
        };
        count: number;
        computedAt: Date;
    };
    data: LedgerRow[];
}

export class GeneralLedgerService {

    async generateReport(tenantId: string, query: GeneralLedgerQuery): Promise<GeneralLedgerResult> {
        const accountId = new Types.ObjectId(query.accountId);

        // 1. Resolve Account
        const account = await ChartOfAccount.findOne({ _id: accountId, tenantId });
        if (!account) {
            throw new Error(`Account not found: ${query.accountId}`);
        }

        // 2. Resolve Date Scope
        let startDate: Date;
        let endDate: Date;
        let scopeLabel = 'Custom Range';

        if (query.fiscalPeriodId) {
            const calendar = await FiscalCalendar.findOne({
                tenantId,
                "periods._id": new Types.ObjectId(query.fiscalPeriodId)
            });
            if (!calendar) throw new Error('Fiscal Period not found');

            const period = calendar.periods.find(p => p._id.toString() === query.fiscalPeriodId);
            if (!period) throw new Error('Fiscal Period not found in calendar');

            startDate = period.startDate;
            endDate = period.endDate;
            scopeLabel = period.label;
        } else if (query.from && query.to) {
            startDate = new Date(query.from);
            endDate = new Date(query.to);
            endDate.setHours(23, 59, 59, 999);
            scopeLabel = `${query.from} to ${query.to}`;
        } else if (query.asOf) {
            startDate = new Date(0); // Beginning of time
            endDate = new Date(query.asOf);
            endDate.setHours(23, 59, 59, 999);
            scopeLabel = `As of ${query.asOf}`;
        } else if (query.fiscalYearId) {
            const calendar = await FiscalCalendar.findById(query.fiscalYearId);
            if (!calendar) throw new Error('Fiscal Year not found');
            startDate = calendar.startDate;
            endDate = calendar.endDate;
            scopeLabel = calendar.yearName;
        } else {
            // Default: Current Quarter/Month? Or catch-all
            const now = new Date();
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
            scopeLabel = 'Current Month';
        }

        // 3. Calculate Opening Balance
        // Sum of all Posted lines for this account BEFORE startDate
        const openingMatch = {
            tenantId,
            status: EntryStatus.POSTED,
            postingDate: { $lt: startDate },
            "lines.accountId": accountId
        };

        const openingAgg = await JournalEntry.aggregate([
            { $match: openingMatch },
            { $unwind: "$lines" },
            { $match: { "lines.accountId": accountId } },
            { $group: { _id: null, debit: { $sum: "$lines.debit" }, credit: { $sum: "$lines.credit" } } }
        ]);

        const openingRaw = openingAgg[0] || { debit: 0, credit: 0 };
        const openingNet = openingRaw.debit - openingRaw.credit; // Net is typically Dr - Cr (Assets/Exp positive, Liab/Eq/Rev negative logically, but display logic varies)

        // 4. Fetch Activity Entries
        const activityMatch = {
            tenantId,
            status: EntryStatus.POSTED,
            postingDate: { $gte: startDate, $lte: endDate },
            "lines.accountId": accountId
        };

        const entries = await JournalEntry.aggregate([
            { $match: activityMatch },
            { $unwind: "$lines" },
            { $match: { "lines.accountId": accountId } },
            { $sort: { postingDate: 1, _id: 1 } }, // Chronological
            {
                $project: {
                    postingDate: 1,
                    entryNo: 1,
                    entryDescription: "$description",
                    lineDescription: "$lines.description",
                    debit: "$lines.debit",
                    credit: "$lines.credit",
                    reference: 1,
                    sourceType: 1,
                    sourceId: 1,
                    sourceNo: 1
                }
            }
        ]);

        // 5. Calculate Running Balances
        let runningNet = openingNet;
        const totals = { debit: 0, credit: 0 };

        const rows: LedgerRow[] = entries.map((entry: any) => {
            const dr = entry.debit || 0;
            const cr = entry.credit || 0;

            runningNet += (dr - cr);
            totals.debit += dr;
            totals.credit += cr;

            // Interpretation of Running Balance based on Account Type
            // For UI, we usually show Dr/Cr or Net.
            // Let's provide raw Net (Dr-Cr) and derived Dr/Cr
            const runDr = runningNet > 0 ? runningNet : 0;
            const runCr = runningNet < 0 ? Math.abs(runningNet) : 0;

            return {
                postingDate: entry.postingDate,
                entryNo: entry.entryNo,
                journalEntryId: entry._id.toString(),
                description: entry.entryDescription,
                lineDescription: entry.lineDescription,
                reference: entry.reference,
                sourceType: entry.sourceType,
                sourceId: entry.sourceId,
                sourceNo: entry.sourceNo,
                debit: dr,
                credit: cr,
                runningNet: runningNet,
                runningDr: runDr,
                runningCr: runCr
            };
        });

        const closingNet = openingNet + totals.debit - totals.credit;

        return {
            meta: {
                account: {
                    id: account._id.toString(),
                    code: account.code,
                    name: account.name,
                    type: account.type,
                    normalBalance: account.normalBalance
                },
                scope: {
                    label: scopeLabel,
                    startDate: query.asOf ? null : startDate, // If AsOf, start is technically -infinity
                    endDate: endDate,
                    filters: query
                },
                opening: {
                    net: openingNet,
                    dr: openingNet > 0 ? openingNet : 0,
                    cr: openingNet < 0 ? Math.abs(openingNet) : 0,
                    debit: openingRaw.debit,
                    credit: openingRaw.credit
                },
                totals,
                closing: {
                    net: closingNet,
                    dr: closingNet > 0 ? closingNet : 0,
                    cr: closingNet < 0 ? Math.abs(closingNet) : 0
                },
                count: rows.length,
                computedAt: new Date()
            },
            data: rows
        };
    }
}

export const generalLedgerService = new GeneralLedgerService();

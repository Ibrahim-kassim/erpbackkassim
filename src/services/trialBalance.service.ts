import mongoose, { Types } from 'mongoose';
import { JournalEntry, EntryStatus } from '../models/journalEntry.model';
import { ChartOfAccount, NormalBalance } from '../models/chartOfAccount.model';
import { TrialBalanceQuery } from '../validators/trialBalance.schema';

interface TrialBalanceLine {
    accountId: string;
    code: string;
    name: string;
    type: string;
    normalBalance: string;
    debitTotal: number;
    creditTotal: number;
    closingDebit: number;
    closingCredit: number;
    unusualBalance: boolean;
}

interface TrialBalanceResult {
    meta: {
        scope: TrialBalanceQuery;
        totals: {
            debit: number;
            credit: number;
        };
        balanced: boolean;
        difference: number;
    };
    data: TrialBalanceLine[];
}

export class TrialBalanceService {

    async generateReport(tenantId: string, query: TrialBalanceQuery): Promise<TrialBalanceResult> {
        const matchStage: any = {
            tenantId,
            status: EntryStatus.POSTED
        };

        // Date Logic
        if (query.fiscalPeriodId) {
            matchStage.fiscalPeriodId = new Types.ObjectId(query.fiscalPeriodId);
        } else if (query.from && query.to) {
            matchStage.postingDate = {
                $gte: new Date(query.from),
                $lte: new Date(query.to)
            };
        } else {
            // Default or AsOf
            const asOfDate = query.asOf ? new Date(query.asOf) : new Date();
            // Important: set time to end of day? Or just date comparison. 
            // In Mongo Dates are datetime. If user sends 2026-01-22, new Date is 00:00:00.
            // Usually 'asOf' means inclusive of that day.
            // Let's set it to end of day strictly if it is just a date string.
            // But usually JEs are stored with time or 00:00.
            // Safer to use $lte: new Date(asOfDate.setHours(23,59,59,999))
            const eod = new Date(asOfDate);
            eod.setHours(23, 59, 59, 999);
            matchStage.postingDate = { $lte: eod };
        }

        const aggregation = [
            { $match: matchStage },
            { $unwind: "$lines" },
            {
                $group: {
                    _id: "$lines.accountId",
                    debitTotal: { $sum: "$lines.debit" },
                    creditTotal: { $sum: "$lines.credit" }
                }
            },
            {
                $lookup: {
                    from: "chart_of_accounts",
                    localField: "_id",
                    foreignField: "_id",
                    as: "account"
                }
            },
            { $unwind: "$account" },
            {
                $project: {
                    _id: 0,
                    accountId: "$_id",
                    code: "$account.code",
                    name: "$account.name",
                    type: "$account.type",
                    normalBalance: "$account.normalBalance",
                    isPosting: "$account.isPosting",
                    isActive: "$account.isActive",
                    debitTotal: 1,
                    creditTotal: 1
                }
            },
            { $sort: { code: 1 } }
        ];

        const rawResults = await JournalEntry.aggregate(aggregation as any[]);

        // Process results in JS for cleaner logic on "closing" and filtering
        let lines: TrialBalanceLine[] = rawResults.map(r => {
            const net = r.debitTotal - r.creditTotal;
            let closingDebit = 0;
            let closingCredit = 0;

            if (net > 0) {
                closingDebit = net;
            } else if (net < 0) {
                closingCredit = Math.abs(net);
            }

            // Normal Balance Check
            let unusualBalance = false;
            // Tolerance matching? Usually strictly.
            if (r.normalBalance === NormalBalance.DEBIT && net < 0) unusualBalance = true;
            if (r.normalBalance === NormalBalance.CREDIT && net > 0) unusualBalance = true;
            // Ignore zero balance for unusual check usually

            return {
                accountId: r.accountId.toString(),
                code: r.code,
                name: r.name,
                type: r.type,
                normalBalance: r.normalBalance,
                debitTotal: r.debitTotal,
                creditTotal: r.creditTotal,
                closingDebit,
                closingCredit,
                unusualBalance,
                isPosting: r.isPosting,
                isActive: r.isActive
            };
        });

        // Filter Logic
        // 1. includeNonPosting: Although aggregation only finds accounts WITH transactions, 
        // a true TB might should show accounts with 0 balance if they are in the CoA?
        // Use case says: "Aggregates debit/credit per account...". Usually implies only those with activity.
        // But "includeZero" suggests we might want 0 balance rows.
        // If includeZero is true, we technically need the whole CoA.
        // Current aggregation ONLY gets accounts that had JEs in that range.

        // If query.includeZero is true, we must fetch ALL accounts and merge.
        // This is a bit more expensive.
        if (query.includeZero) {
            const allAccounts = await ChartOfAccount.find({ tenantId }).sort({ code: 1 });
            const existingMap = new Map(lines.map(l => [l.accountId, l]));

            lines = allAccounts.map(acc => {
                const existing = existingMap.get(acc._id.toString());
                if (existing) return existing;

                // Return zero row
                return {
                    accountId: acc._id.toString(),
                    code: acc.code,
                    name: acc.name,
                    type: acc.type,
                    normalBalance: acc.normalBalance,
                    debitTotal: 0,
                    creditTotal: 0,
                    closingDebit: 0,
                    closingCredit: 0,
                    unusualBalance: false,
                    isPosting: acc.isPosting,
                    isActive: acc.isActive
                } as any; // Cast to bypass isPosting check below
            });
        }

        // Filter valid lines
        lines = lines.filter(l => {
            // internal helper property access
            const isPosting = (l as any).isPosting;

            // exclude non-posting unless requested
            if (!query.includeNonPosting && !isPosting) return false;

            // exclude zero unless requested (if we didn't just add them back)
            // If includeZero is false, hide zero lines.
            // Note: If we added them above, includeZero was true.
            // So this only applies if includeZero is false loops through original results.
            if (!query.includeZero) {
                if (l.closingDebit === 0 && l.closingCredit === 0) return false;
            }

            return true;
        });

        // Calculate Totals
        const totals = lines.reduce((acc, curr) => ({
            debit: acc.debit + curr.closingDebit,
            credit: acc.credit + curr.closingCredit
        }), { debit: 0, credit: 0 });

        // Round totals to 2 decimals
        totals.debit = Math.round(totals.debit * 100) / 100;
        totals.credit = Math.round(totals.credit * 100) / 100;

        const difference = Math.abs(totals.debit - totals.credit);
        const balanced = difference < 0.01;

        // Clean up internal fields (isPosting, isActive) from output if strict
        const cleanLines = lines.map(({ isPosting, isActive, ...rest }: any) => rest);

        return {
            meta: {
                scope: query,
                totals,
                balanced,
                difference
            },
            data: cleanLines
        };
    }
    async generateHierarchicalReport(tenantId: string, query: TrialBalanceQuery) {
        // 1. Determine Date Ranges
        let startDate: Date;
        let endDate: Date;

        if (query.fiscalPeriodId) {
            const FiscalPeriod = mongoose.model('FiscalPeriod'); // Dynamic import if possible or assume resolved by DI/Lookup? 
            // Better to perform lookup on FiscalCalendar since periods are embedded now.
            // But we don't have easy access to services here without circular dependency?
            // Let's use Mongoose model directly if available or pass in dates? 
            // query logic usually handled by service.

            // We need to fetch period dates.
            const { FiscalCalendar } = await import('../models/fiscalCalendar.model');
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
            startDate = new Date(query.from);
            endDate = new Date(query.to);
            endDate.setHours(23, 59, 59, 999);
        } else if (query.asOf) {
            // AsOf behavior for hier:
            // Opening = 0 (or beginning of time?)
            // Activity = up to AsOf? 
            // Actually AsOf usually implies Closing Balance only. 
            // If we want [Opening, Activity, Closing], we need a "Start" for activity.
            // If AsOf is used, we treat it as: Opening = 0, Activity = All Time (or FY start?), Closing = AsOf.
            // Let's assume startDate = Beginning of Fiscal Year? Or Beginning of Time.
            // For simplicity in V1: StartDate = 1970, EndDate = AsOf.
            startDate = new Date(0);
            endDate = new Date(query.asOf);
            endDate.setHours(23, 59, 59, 999);
        } else {
            // Default to Year to Date? Or Month to Date?
            // Let's default to current month.
            const now = new Date();
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        }

        // 2. Fetch All Accounts (Tree Skeleton)
        const allAccounts = await ChartOfAccount.find({ tenantId }).lean();

        // 3. Aggregation: Opening (Before Start)
        const openingMatch = {
            tenantId,
            status: EntryStatus.POSTED,
            postingDate: { $lt: startDate }
        };
        const openingAgg = await JournalEntry.aggregate([
            { $match: openingMatch },
            { $unwind: "$lines" },
            { $group: { _id: "$lines.accountId", deb: { $sum: "$lines.debit" }, cred: { $sum: "$lines.credit" } } }
        ] as any[]);

        // 4. Aggregation: Activity (Start to End)
        const activityMatch = {
            tenantId,
            status: EntryStatus.POSTED,
            postingDate: { $gte: startDate, $lte: endDate }
        };
        const activityAgg = await JournalEntry.aggregate([
            { $match: activityMatch },
            { $unwind: "$lines" },
            { $group: { _id: "$lines.accountId", deb: { $sum: "$lines.debit" }, cred: { $sum: "$lines.credit" } } }
        ] as any[]);

        // 5. Build Map of Balances
        const balMap = new Map<string, any>();

        openingAgg.forEach(o => {
            const net = o.deb - o.cred;
            balMap.set(o._id.toString(), {
                openingDr: net > 0 ? net : 0,
                openingCr: net < 0 ? Math.abs(net) : 0,
                debit: 0,
                credit: 0
            });
        });

        activityAgg.forEach(a => {
            const current = balMap.get(a._id.toString()) || { openingDr: 0, openingCr: 0, debit: 0, credit: 0 };
            current.debit = a.deb;
            current.credit = a.cred;
            balMap.set(a._id.toString(), current);
        });

        // 6. Build Tree & Rollup
        // Map accounts to node objects
        const nodesMap = new Map<string, any>();
        allAccounts.forEach(acc => {
            const bals = balMap.get(acc._id.toString()) || { openingDr: 0, openingCr: 0, debit: 0, credit: 0 };

            // Calculate Closing logic "Leaf" level
            // Opening Net = OpDr - OpCr
            // Closing Net = (OpDr - OpCr) + (Dr - Cr)
            const opNet = bals.openingDr - bals.openingCr;
            const activityNet = bals.debit - bals.credit;
            const clNet = opNet + activityNet;

            nodesMap.set(acc._id.toString(), {
                ...acc,
                id: acc._id.toString(),
                label: `${acc.code} - ${acc.name}`,
                parentId: acc.parentId ? acc.parentId.toString() : null,
                children: [],
                // Values
                openingDr: bals.openingDr,
                openingCr: bals.openingCr,
                debit: bals.debit,
                credit: bals.credit,
                closingDr: clNet > 0 ? clNet : 0,
                closingCr: clNet < 0 ? Math.abs(clNet) : 0
            });
        });

        // Build Hierarchy & Roll up
        const rootNodes: any[] = [];
        const levels = Array.from(nodesMap.values()).sort((a, b) => b.level - a.level); // Process deepest first? No, leaf to root for totals?
        // Actually simplest is: Build tree structure first, then recursive sum.

        // 1. Link children
        allAccounts.forEach(acc => {
            const node = nodesMap.get(acc._id.toString());
            if (node.parentId && nodesMap.has(node.parentId)) {
                nodesMap.get(node.parentId).children.push(node);
            } else {
                rootNodes.push(node);
            }
        });

        // 2. Recursive Rollup
        const rollup = (node: any) => {
            if (node.children.length > 0) {
                // It's a parent
                // Sort children by code
                node.children.sort((a: any, b: any) => a.code.localeCompare(b.code));

                let opDr = 0, opCr = 0, dr = 0, cr = 0, clDr = 0, clCr = 0;

                node.children.forEach((child: any) => {
                    rollup(child);
                    opDr += child.openingDr;
                    opCr += child.openingCr;
                    dr += child.debit;
                    cr += child.credit;
                    clDr += child.closingDr;
                    clCr += child.closingCr;
                });

                // Set parent totals to exact sum of children (Ignore parent's own postings if any? Usually parents don't post)
                // If parents allow posting, we must add their own map values. 
                // But typically header accounts don't post.
                // We'll assume Header = Sum of Children.
                node.openingDr = opDr;
                node.openingCr = opCr;
                node.debit = dr;
                node.credit = cr;
                node.closingDr = clDr;
                node.closingCr = clCr;
            }
        };

        rootNodes.forEach(rollup);

        // Totals
        const totals = { openingDr: 0, openingCr: 0, debit: 0, credit: 0, closingDr: 0, closingCr: 0 };
        rootNodes.forEach(n => {
            totals.openingDr += n.openingDr;
            totals.openingCr += n.openingCr;
            totals.debit += n.debit;
            totals.credit += n.credit;
            totals.closingDr += n.closingDr;
            totals.closingCr += n.closingCr;
        });

        // Clean nulls or circular structs? JSON stringify handles it if no circular refs.
        // We need to flatten? Or return Tree?
        // UI requested Tree.
        // Let's filter includeZero if needed. 
        // Recursive filter?

        const filterZero = (nodes: any[]): any[] => {
            return nodes.filter(n => {
                if (n.children.length > 0) {
                    n.children = filterZero(n.children);
                    // Keep if has children OR has non-zero values
                    return n.children.length > 0 || Math.abs(n.closingDr) + Math.abs(n.closingCr) > 0.001;
                }
                // Leaf
                return Math.abs(n.closingDr) + Math.abs(n.closingCr) > 0.001 || n.debit !== 0 || n.credit !== 0;
            });
        };

        let finalNodes = rootNodes;
        if (query.includeZero !== true) {
            finalNodes = filterZero(rootNodes);
        }

        // Sort roots
        finalNodes.sort((a, b) => a.code.localeCompare(b.code));

        return {
            meta: {
                scope: query,
                startDate,
                endDate,
                totals,
                balanced: Math.abs(totals.debit - totals.credit) < 0.01,
                debug: {
                    openingEntriesCount: openingAgg.length, // approximation (unwound lines)
                    activityEntriesCount: activityAgg.length // approximation (unwound lines)
                }
            },
            data: finalNodes
        };
    }
}

export const trialBalanceService = new TrialBalanceService();

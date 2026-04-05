import mongoose, { Types } from 'mongoose';
import { JournalEntry, EntryStatus } from '../models/journalEntry.model';
import { ChartOfAccount, AccountType, NormalBalance } from '../models/chartOfAccount.model';
import { FiscalCalendar } from '../models/fiscalCalendar.model';
import { FinancialStatementsQuery } from '../validators/financialStatements.schema';

interface StatementNode {
    id: string;
    code: string;
    name: string;
    level: number;
    amount: number; // The display amount (positive)
    children: StatementNode[];
}

interface FinancialStatementsResult {
    meta: {
        scope: {
            label: string;
            fiscalYearId?: string;
            fiscalPeriodId?: string;
            startDate: Date;
            endDate: Date;
        };
        totals: {
            assets: number;
            liabilities: number;
            equity: number;
            revenue: number;
            expenses: number;
            netIncome: number;
        };
        balanced: boolean;
        difference: number;
    },
    data: {
        balanceSheet: {
            assets: StatementNode[];
            liabilities: StatementNode[];
            equity: StatementNode[];
            computedLines: { label: string; amount: number }[];
        };
        incomeStatement: {
            revenue: StatementNode[];
            expenses: StatementNode[];
            computedLines: { label: string; amount: number }[];
        }
    }
}

export class FinancialStatementsService {

    async generateStatements(tenantId: string, query: FinancialStatementsQuery): Promise<FinancialStatementsResult> {
        // 1. Determine Dates
        let startDate: Date;
        let endDate: Date;
        let scopeLabel = 'Current Period';

        if (query.fiscalPeriodId) {
            const calendar = await FiscalCalendar.findOne({
                tenantId,
                "periods._id": new Types.ObjectId(query.fiscalPeriodId)
            });

            const period = calendar?.periods.find(p => p._id.toString() === query.fiscalPeriodId);

            if (!period) {
                throw new Error('Fiscal Period not found');
            }
            startDate = period.startDate;
            endDate = period.endDate;
            scopeLabel = period.label || 'Selected Period';
        } else if (query.fiscalYearId) {
            const fiscalYear = await FiscalCalendar.findOne({
                tenantId,
                _id: new Types.ObjectId(query.fiscalYearId)
            });

            if (!fiscalYear) {
                throw new Error('Fiscal Year not found');
            }

            startDate = fiscalYear.startDate;
            endDate = fiscalYear.endDate;
            scopeLabel = fiscalYear.yearName || 'Selected Fiscal Year';
        } else if (query.from && query.to) {
            startDate = new Date(query.from);
            endDate = new Date(query.to);
            endDate.setHours(23, 59, 59, 999);
            scopeLabel = 'Date Range';
        } else if (query.asOf) {
            startDate = new Date(0); // Beginning of time for Balance Sheet, but for IS?
            // If only asOf is provided, we usually assume YTD or inception-to-date.
            // For simplicity in V1, let's treat "asOf" as the end date.
            // Typically Fiscal Year start is needed for IS YTD.
            // We'll fallback to a "safe" start date or try to find the FY for that date.

            // Try to find fiscal year containing this date
            const asOfDate = new Date(query.asOf);
            const fiscalYear = await FiscalCalendar.findOne({
                tenantId,
                startDate: { $lte: asOfDate },
                endDate: { $gte: asOfDate }
            });

            // If we found a FY, use its start date. Otherwise epoch.
            startDate = fiscalYear ? fiscalYear.startDate : new Date(0);

            endDate = new Date(query.asOf);
            endDate.setHours(23, 59, 59, 999);
            scopeLabel = 'As Of Date';
        } else {
            // Default to current month
            const now = new Date();
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
            scopeLabel = 'Current Period';
        }

        // 2. Fetch Accounts
        const allAccounts = await ChartOfAccount.find({
            tenantId,
            ...(query.includeInactive ? {} : { isActive: true })
        }).lean();

        // 3. Aggregation
        // BS needs Closing Balances (All Time).
        // IS needs Activity (Start to End).

        // A) Opening Balance (Before Start) - Needed for BS Closing Calc
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

        // B) Activity (Start to End) - Needed for IS and BS Closing Calc
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

        // 4. Merge Data
        const balMap = new Map<string, any>();

        // Initialize from aggregations
        openingAgg.forEach(o => {
            const net = o.deb - o.cred;
            balMap.set(o._id.toString(), {
                opDr: net > 0 ? net : 0,
                opCr: net < 0 ? Math.abs(net) : 0,
                actDr: 0,
                actCr: 0
            });
        });

        activityAgg.forEach(a => {
            const current = balMap.get(a._id.toString()) || { opDr: 0, opCr: 0, actDr: 0, actCr: 0 };
            current.actDr = a.deb;
            current.actCr = a.cred;
            balMap.set(a._id.toString(), current);
        });

        // 5. Build Trees per Type
        // Helper to get balance for node
        // Returns { closing: number, activity: number } signed naturally
        const getRawValues = (accId: string) => {
            return balMap.get(accId) || { opDr: 0, opCr: 0, actDr: 0, actCr: 0 };
        };

        const nodesMap = new Map<string, any>();

        // Create Nodes with Metrics
        allAccounts.forEach(acc => {
            const raw = getRawValues(acc._id.toString());

            /// Metrics (All in terms of DEBIT positive, CREDIT negative for calculation)
            // Opening Net
            const opNet = raw.opDr - raw.opCr;
            // Activity Net
            const actNet = raw.actDr - raw.actCr;
            // Closing Net
            const closeNet = opNet + actNet;

            nodesMap.set(acc._id.toString(), {
                ...acc,
                id: acc._id.toString(),
                label: acc.name,
                children: [],
                // Raw metrics
                opNet,
                actNet,
                closeNet,
            });
        });

        // Link Children
        const roots: any[] = [];
        allAccounts.forEach(acc => {
            const node = nodesMap.get(acc._id.toString());
            if (node.parentId && nodesMap.has(node.parentId.toString())) {
                nodesMap.get(node.parentId.toString()).children.push(node);
            } else {
                roots.push(node);
            }
        });

        // Recursive Rollup (Summing Nets)
        const rollup = (node: any) => {
            if (node.children.length > 0) {
                // Sort by code
                node.children.sort((a: any, b: any) => a.code.localeCompare(b.code));

                let sumOp = 0;
                let sumAct = 0;
                let sumClose = 0;

                node.children.forEach((child: any) => {
                    rollup(child);
                    sumOp += child.opNet;
                    sumAct += child.actNet;
                    sumClose += child.closeNet;
                });

                // Assign sums (Parent total includes its own balance + children)
                // Assuming "Posting" parents don't usually have direct journal entries in a strictly enforced system,
                // BUT in many systems parents might mistakenly have been posted to or are hybrids.
                // Our system: isPosting flag. If isPosting=false, it shouldn't have entries.
                // We'll ADD children totals to the node's own totals.
                node.opNet += sumOp;
                node.actNet += sumAct;
                node.closeNet += sumClose;
            }
        };

        roots.forEach(rollup);

        // 6. Partition and Format
        // Account Types are conventionally:
        // AX, LX, EQ, RV, EX

        const bsAssets: StatementNode[] = [];
        const bsLiabilities: StatementNode[] = [];
        const bsEquity: StatementNode[] = [];
        const isRevenue: StatementNode[] = [];
        const isExpenses: StatementNode[] = [];

        // Totals accumulator
        const totals = {
            assets: 0,
            liabilities: 0,
            equity: 0,
            revenue: 0,
            expenses: 0,
            netIncome: 0
        };

        const formatNode = (node: any, type: string): StatementNode => {
            let amount = 0;

            // Determine "Display Amount" based on Type nature
            // ASSET / EXPENSE = Debit Nature (amount = net > 0)
            // LIABILITY / EQUITY / REVENUE = Credit Nature (amount = -net > 0)

            if (['ASSET', 'LIABILITY', 'EQUITY'].includes(type || node.type)) {
                // Balance Sheet uses Closing Balance
                if (type === 'ASSET' || node.normalBalance === 'DEBIT') { // Assets are Dr nature
                    amount = node.closeNet;
                } else { // Liab/Equity are Cr nature
                    amount = -node.closeNet;
                }
            } else {
                // P&L uses Activity
                if (type === 'EXPENSE' || node.type === 'COST_OF_GOODS_SOLD' || node.normalBalance === 'DEBIT') { // Expense Dr nature
                    amount = node.actNet;
                } else { // Revenue Cr nature
                    amount = -node.actNet;
                }
            }

            return {
                id: node.id,
                code: node.code,
                name: node.name,
                level: node.level,
                amount: amount,
                children: node.children.map((c: any) => formatNode(c, type))
            };
        };


        // Recursive Filter (remove zero rows)
        const filterZero = (node: StatementNode): boolean => {
            // Keep if children exist (after filtering them) OR amount is non-zero
            if (node.children.length > 0) {
                node.children = node.children.filter(filterZero);
                if (node.children.length > 0) return true;
            }
            return Math.abs(node.amount) > 0.01;
        };


        // Distribute Roots
        roots.forEach(node => {
            const type = node.type;
            const formatted = formatNode(node, type);

            // Add to lists
            if (type === 'ASSET') {
                totals.assets += formatted.amount;
                bsAssets.push(formatted);
            } else if (type === 'LIABILITY') {
                totals.liabilities += formatted.amount;
                bsLiabilities.push(formatted);
            } else if (type === 'EQUITY') {
                totals.equity += formatted.amount;
                bsEquity.push(formatted);
            } else if (type === 'REVENUE' || type === 'INCOME') {
                totals.revenue += formatted.amount;
                isRevenue.push(formatted);
            } else if (type === 'EXPENSE' || type === 'COST_OF_GOODS_SOLD') {
                totals.expenses += formatted.amount;
                isExpenses.push(formatted);
            }
        });

        // Filter Zero
        if (!query.includeZero) {
            // Apply filter to all lists
            const lists = [bsAssets, bsLiabilities, bsEquity, isRevenue, isExpenses];
            for (const list of lists) {
                for (let i = list.length - 1; i >= 0; i--) {
                    if (!filterZero(list[i])) {
                        list.splice(i, 1);
                    }
                }
            }
        }

        // Calculate Net Income
        totals.netIncome = totals.revenue - totals.expenses;

        // BS Balancing
        // Assets = Liab + Equity + NetIncome
        // (Displayed Positive Assets) = (Displayed Positive Liab) + (Displayed Positive Equity) + NetIncome
        const rightSide = totals.liabilities + totals.equity + totals.netIncome;
        const difference = totals.assets - rightSide;
        const balanced = Math.abs(difference) < 0.1;

        return {
            meta: {
                scope: {
                    label: scopeLabel,
                    fiscalYearId: query.fiscalYearId,
                    fiscalPeriodId: query.fiscalPeriodId,
                    startDate,
                    endDate
                },
                totals,
                balanced,
                difference
            },
            data: {
                balanceSheet: {
                    assets: bsAssets,
                    liabilities: bsLiabilities,
                    equity: bsEquity,
                    computedLines: [
                        { label: 'Net Income (Current Period)', amount: totals.netIncome }
                    ]
                },
                incomeStatement: {
                    revenue: isRevenue,
                    expenses: isExpenses,
                    computedLines: [
                        { label: 'Net Income', amount: totals.netIncome }
                    ]
                }
            }
        };
    }
}

export const financialStatementsService = new FinancialStatementsService();

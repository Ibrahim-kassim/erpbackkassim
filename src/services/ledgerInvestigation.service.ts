import { Types } from 'mongoose';
import { ChartOfAccount } from '../models/chartOfAccount.model';
import { EntryStatus, JournalEntry } from '../models/journalEntry.model';
import { FiscalCalendar } from '../models/fiscalCalendar.model';
import {
    AnomaliesLedgerQuery,
    ExplainLedgerQuery,
    LedgerQuestionDTO,
    SourceSummaryLedgerQuery,
} from '../validators/generalLedgerAi.schema';
import { generalLedgerService } from './generalLedger.service';

type ScopeQuery = {
    accountId?: string;
    fiscalPeriodId?: string;
    fiscalYearId?: string;
    from?: string;
    to?: string;
    sourceType?: string;
};

type InsightCategory = 'factual' | 'heuristic' | 'inference';
type Severity = 'low' | 'medium' | 'high';

interface LedgerEvidence {
    journalEntryId?: string;
    entryNo?: string;
    postingDate?: Date;
    sourceType?: string;
    sourceNo?: string;
    accountId?: string;
    accountCode?: string;
    accountName?: string;
    amount?: number;
    lineDescription?: string;
}

interface LedgerInsight {
    id: string;
    category: InsightCategory;
    title: string;
    message: string;
    severity?: Severity;
    evidence: LedgerEvidence[];
}

interface LedgerAnomaly {
    id: string;
    rule: string;
    severity: Severity;
    title: string;
    message: string;
    evidence: LedgerEvidence[];
}

interface LedgerSourceSummary {
    id: string;
    sourceType: string;
    sourceLabel: string;
    sourceNo: string;
    entryCount: number;
    lineCount: number;
    debit: number;
    credit: number;
    net: number;
    direction: 'increase' | 'decrease' | 'neutral';
    explanation: string;
    evidence: LedgerEvidence[];
}

const round2 = (value: number) => Math.round(value * 100) / 100;

const sourceTypeLabel = (sourceType?: string) => {
    if (!sourceType) return 'Manual';
    return sourceType.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
};

const formatAmountPhrase = (value: number) => {
    if (Math.abs(value) < 0.005) return 'flat overall';
    return value > 0 ? `net debit ${round2(value).toFixed(2)}` : `net credit ${round2(Math.abs(value)).toFixed(2)}`;
};

const controlAccountPattern = /(receivable|payable|cash|bank|inventory|grni|tax|vat|control)/i;

const resolveScope = async (tenantId: string, query: ScopeQuery) => {
    let startDate = new Date();
    let endDate = new Date();
    let fiscalPeriodId = query.fiscalPeriodId;
    let fiscalYearId = query.fiscalYearId;
    let label = 'Current Open Period';

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
        label = period.label;
    } else if (query.from && query.to) {
        startDate = new Date(query.from);
        endDate = new Date(query.to);
        endDate.setHours(23, 59, 59, 999);
        label = `${query.from} to ${query.to}`;
    } else if (query.fiscalYearId) {
        const calendar = await FiscalCalendar.findById(query.fiscalYearId);
        if (!calendar) throw new Error('Fiscal Year not found');
        startDate = calendar.startDate;
        endDate = calendar.endDate;
        label = calendar.yearName;
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
            label = currentOpen.label;
        } else {
            endDate = new Date();
            startDate = new Date();
            startDate.setDate(endDate.getDate() - 30);
            endDate.setHours(23, 59, 59, 999);
            label = 'Last 30 Days';
        }
    }

    return { startDate, endDate, fiscalPeriodId, fiscalYearId, label };
};

const buildPostedMatch = (tenantId: string, scope: Awaited<ReturnType<typeof resolveScope>>, query: ScopeQuery) => {
    const match: any = {
        tenantId,
        status: EntryStatus.POSTED,
        postingDate: { $gte: scope.startDate, $lte: scope.endDate },
    };

    if (query.sourceType) {
        match.sourceType = query.sourceType;
    }

    return match;
};

const fetchScopedLines = async (tenantId: string, query: ScopeQuery) => {
    const scope = await resolveScope(tenantId, query);
    const match = buildPostedMatch(tenantId, scope, query);

    const pipeline: any[] = [
        { $match: match },
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

    pipeline.push({
        $project: {
            postingDate: 1,
            createdAt: 1,
            entryNo: 1,
            entryType: 1,
            journalEntryId: '$_id',
            description: '$description',
            reference: 1,
            sourceType: 1,
            sourceId: 1,
            sourceNo: 1,
            lineDescription: '$lines.description',
            debit: '$lines.debit',
            credit: '$lines.credit',
            amount: { $subtract: ['$lines.debit', '$lines.credit'] },
            absoluteAmount: { $abs: { $subtract: ['$lines.debit', '$lines.credit'] } },
            accountId: '$account._id',
            accountCode: '$account.code',
            accountName: '$account.name',
            accountType: '$account.type',
            normalBalance: '$account.normalBalance',
        },
    });

    const lines = await JournalEntry.aggregate(pipeline);
    return { scope, lines };
};

const buildSourceSummaryGroups = async (tenantId: string, query: ScopeQuery) => {
    const { scope, lines } = await fetchScopedLines(tenantId, query);
    const groups = new Map<string, LedgerSourceSummary>();

    for (const line of lines) {
        const key = `${line.sourceType || 'MANUAL'}::${line.sourceNo || line.entryNo}`;
        const current: LedgerSourceSummary = groups.get(key) || {
            id: key,
            sourceType: line.sourceType || 'MANUAL',
            sourceLabel: sourceTypeLabel(line.sourceType),
            sourceNo: line.sourceNo || line.entryNo,
            entryCount: 0,
            lineCount: 0,
            debit: 0,
            credit: 0,
            net: 0,
            direction: 'neutral' as const,
            explanation: '',
            evidence: [],
        };

        current.lineCount += 1;
        current.debit = round2(current.debit + (line.debit || 0));
        current.credit = round2(current.credit + (line.credit || 0));
        current.net = round2(current.debit - current.credit);
        current.direction = current.net > 0 ? 'increase' : current.net < 0 ? 'decrease' : 'neutral';
        current.evidence.push({
            journalEntryId: line.journalEntryId?.toString(),
            entryNo: line.entryNo,
            postingDate: line.postingDate,
            sourceType: line.sourceType,
            sourceNo: line.sourceNo,
            accountId: line.accountId?.toString(),
            accountCode: line.accountCode,
            accountName: line.accountName,
            amount: line.amount,
            lineDescription: line.lineDescription,
        });
        groups.set(key, current);
    }

    const entryCounts = new Map<string, Set<string>>();
    for (const line of lines) {
        const key = `${line.sourceType || 'MANUAL'}::${line.sourceNo || line.entryNo}`;
        const set = entryCounts.get(key) || new Set<string>();
        set.add(line.entryNo);
        entryCounts.set(key, set);
    }

    const result = Array.from(groups.values())
        .map((group) => ({
            ...group,
            entryCount: entryCounts.get(group.id)?.size || 0,
            explanation: `${group.sourceLabel} ${group.sourceNo} drove ${formatAmountPhrase(group.net)} across ${group.lineCount} ledger line(s).`,
            evidence: group.evidence.slice(0, 5),
        }))
        .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));

    return { scope, groups: result, lines };
};

export const explainMovement = async (tenantId: string, query: ExplainLedgerQuery) => {
    const ledger = await generalLedgerService.generateReport(tenantId, {
        accountId: query.accountId,
        fiscalPeriodId: query.fiscalPeriodId,
        fiscalYearId: query.fiscalYearId,
        from: query.from,
        to: query.to,
        sort: 'asc',
        page: 1 as any,
        limit: 500 as any,
        includeOpening: true,
        asOf: undefined,
        search: undefined,
    });

    const { groups } = await buildSourceSummaryGroups(tenantId, query);
    const debitDrivers = groups.filter((group) => group.net > 0).slice(0, 3);
    const creditDrivers = groups.filter((group) => group.net < 0).slice(0, 3);

    const movement = round2(ledger.meta.closing.net - ledger.meta.opening.net);
    const direction = movement > 0 ? 'increased' : movement < 0 ? 'decreased' : 'stayed flat';

    const insights: LedgerInsight[] = [
        {
            id: 'movement-factual',
            category: 'factual',
            title: 'Balance movement',
            message: `${ledger.meta.account.code} ${ledger.meta.account.name} ${direction} from ${round2(ledger.meta.opening.net).toFixed(2)} to ${round2(ledger.meta.closing.net).toFixed(2)} over ${ledger.meta.scope.label}.`,
            evidence: [],
        },
        {
            id: 'movement-activity',
            category: 'factual',
            title: 'Activity totals',
            message: `The account posted total debits of ${round2(ledger.meta.totals.debit).toFixed(2)} and total credits of ${round2(ledger.meta.totals.credit).toFixed(2)} across ${ledger.meta.count} ledger line(s).`,
            evidence: [],
        },
    ];

    if (debitDrivers.length > 0) {
        insights.push({
            id: 'movement-top-debits',
            category: 'inference',
            title: 'Biggest upward drivers',
            message: `The main debit-side contributors were ${debitDrivers.map((driver) => `${driver.sourceLabel} ${driver.sourceNo}`).join(', ')}.`,
            evidence: debitDrivers.flatMap((driver) => driver.evidence).slice(0, 5),
        });
    }

    if (creditDrivers.length > 0) {
        insights.push({
            id: 'movement-top-credits',
            category: 'inference',
            title: 'Biggest downward drivers',
            message: `The strongest credit-side pressure came from ${creditDrivers.map((driver) => `${driver.sourceLabel} ${driver.sourceNo}`).join(', ')}.`,
            evidence: creditDrivers.flatMap((driver) => driver.evidence).slice(0, 5),
        });
    }

    return {
        summary: `${ledger.meta.account.name} ${direction} by ${round2(Math.abs(movement)).toFixed(2)} in ${ledger.meta.scope.label}.`,
        metrics: {
            opening: ledger.meta.opening,
            totals: ledger.meta.totals,
            closing: ledger.meta.closing,
            count: ledger.meta.count,
        },
        insights,
        topDebitDrivers: debitDrivers,
        topCreditDrivers: creditDrivers,
    };
};

export const sourceSummary = async (tenantId: string, query: SourceSummaryLedgerQuery) => {
    const { scope, groups } = await buildSourceSummaryGroups(tenantId, query);
    const topGroups = groups.slice(0, 8);

    const insights: LedgerInsight[] = topGroups.slice(0, 3).map((group, index) => ({
        id: `source-${index + 1}`,
        category: 'inference',
        title: `${group.sourceLabel} ${group.sourceNo}`,
        message: group.explanation,
        evidence: group.evidence,
    }));

    return {
        summary: topGroups.length > 0
            ? `The largest source drivers in ${scope.label} were ${topGroups.slice(0, 3).map((group) => `${group.sourceLabel} ${group.sourceNo}`).join(', ')}.`
            : `No posted source activity was found in ${scope.label}.`,
        scope,
        insights,
        groups: topGroups,
    };
};

export const detectAnomalies = async (tenantId: string, query: AnomaliesLedgerQuery) => {
    const { scope, lines } = await fetchScopedLines(tenantId, query);
    const accountIds = Array.from(new Set(lines.map((line) => line.accountId?.toString()).filter(Boolean)));

    const historicalUsage = accountIds.length === 0 ? [] : await JournalEntry.aggregate([
        {
            $match: {
                tenantId,
                status: EntryStatus.POSTED,
                postingDate: { $lt: scope.startDate },
                'lines.accountId': { $in: accountIds.map((id) => new Types.ObjectId(id)) },
            },
        },
        { $unwind: '$lines' },
        { $match: { 'lines.accountId': { $in: accountIds.map((id) => new Types.ObjectId(id)) } } },
        {
            $group: {
                _id: '$lines.accountId',
                count: { $sum: 1 },
                avgAbsAmount: { $avg: { $abs: { $subtract: ['$lines.debit', '$lines.credit'] } } },
            },
        },
    ]);

    const historyMap = new Map<string, { count: number; avgAbsAmount: number }>(
        historicalUsage.map((row: any) => [row._id.toString(), { count: row.count, avgAbsAmount: row.avgAbsAmount || 0 }])
    );

    const anomalies: LedgerAnomaly[] = [];

    for (const line of lines) {
        const history = historyMap.get(line.accountId?.toString()) || { count: 0, avgAbsAmount: 0 };
        const amount = round2(line.absoluteAmount || Math.abs(line.amount || 0));
        const entryDate = new Date(line.postingDate);
        const createdDate = line.createdAt ? new Date(line.createdAt) : entryDate;
        const daysLag = Math.floor((createdDate.getTime() - entryDate.getTime()) / (1000 * 60 * 60 * 24));
        const evidence: LedgerEvidence[] = [{
            journalEntryId: line.journalEntryId?.toString(),
            entryNo: line.entryNo,
            postingDate: line.postingDate,
            sourceType: line.sourceType,
            sourceNo: line.sourceNo,
            accountId: line.accountId?.toString(),
            accountCode: line.accountCode,
            accountName: line.accountName,
            amount,
            lineDescription: line.lineDescription,
        }];

        if (history.avgAbsAmount > 0 && amount >= history.avgAbsAmount * 3) {
            anomalies.push({
                id: `${line.journalEntryId}-size`,
                rule: 'UNUSUALLY_LARGE_MOVEMENT',
                severity: amount >= history.avgAbsAmount * 5 ? 'high' : 'medium',
                title: 'Movement is much larger than recent history',
                message: `${line.accountCode} posted ${amount.toFixed(2)}, which is well above its recent average movement of ${round2(history.avgAbsAmount).toFixed(2)}.`,
                evidence,
            });
        }

        if (history.count < 3) {
            anomalies.push({
                id: `${line.journalEntryId}-rare`,
                rule: 'RARE_ACCOUNT_USAGE',
                severity: 'medium',
                title: 'Rarely used account appears in scope',
                message: `${line.accountCode} has only ${history.count} prior posted line(s) before this scope, so this movement deserves review.`,
                evidence,
            });
        }

        if ((!line.sourceType || line.sourceType === 'MANUAL') && controlAccountPattern.test(`${line.accountCode} ${line.accountName}`)) {
            anomalies.push({
                id: `${line.journalEntryId}-manual-control`,
                rule: 'MANUAL_CONTROL_ACCOUNT_POSTING',
                severity: 'high',
                title: 'Manual posting to a control-like account',
                message: `${line.accountCode} ${line.accountName} looks like a control account but the ledger line has no operational source document.`,
                evidence,
            });
        }

        if ([0, 6].includes(entryDate.getDay())) {
            anomalies.push({
                id: `${line.journalEntryId}-weekend`,
                rule: 'WEEKEND_POSTING',
                severity: 'low',
                title: 'Weekend posting detected',
                message: `${line.entryNo} was posted on ${entryDate.toDateString()}, which may deserve operational context.`,
                evidence,
            });
        }

        if (daysLag > 7) {
            anomalies.push({
                id: `${line.journalEntryId}-backdated`,
                rule: 'BACKDATED_POSTING',
                severity: 'medium',
                title: 'Backdated posting',
                message: `${line.entryNo} was created ${daysLag} day(s) after its posting date.`,
                evidence,
            });
        }

        if (line.sourceType === 'REVERSAL' || /reversal/i.test(line.description || '')) {
            anomalies.push({
                id: `${line.journalEntryId}-reversal`,
                rule: 'REVERSAL_CLUSTER',
                severity: 'medium',
                title: 'Reversal-related posting',
                message: `${line.entryNo} is a reversal-related entry and should be reviewed alongside the original document.`,
                evidence,
            });
        }

        if ((line.normalBalance === 'DEBIT' && line.credit > line.debit) || (line.normalBalance === 'CREDIT' && line.debit > line.credit)) {
            anomalies.push({
                id: `${line.journalEntryId}-direction`,
                rule: 'ABNORMAL_DIRECTION',
                severity: 'low',
                title: 'Posting direction opposes the account normal balance',
                message: `${line.accountCode} normally carries a ${line.normalBalance.toLowerCase()} balance, but this line posts in the opposite direction.`,
                evidence,
            });
        }
    }

    const severityRank: Record<Severity, number> = { high: 3, medium: 2, low: 1 };
    const deduped = Array.from(new Map(anomalies.map((anomaly) => [anomaly.id, anomaly])).values())
        .sort((a, b) => {
            const severityDiff = severityRank[b.severity] - severityRank[a.severity];
            if (severityDiff !== 0) return severityDiff;
            return (b.evidence[0]?.amount || 0) - (a.evidence[0]?.amount || 0);
        })
        .slice(0, 20);

    return {
        summary: deduped.length > 0
            ? `${deduped.length} unusual ledger pattern(s) were flagged in ${scope.label}.`
            : `No unusual ledger patterns were flagged in ${scope.label}.`,
        scope,
        anomalies: deduped,
        counts: {
            high: deduped.filter((entry) => entry.severity === 'high').length,
            medium: deduped.filter((entry) => entry.severity === 'medium').length,
            low: deduped.filter((entry) => entry.severity === 'low').length,
        },
    };
};

export const entryNarrative = async (tenantId: string, entryId: string) => {
    const entry = await JournalEntry.findOne({ _id: entryId, tenantId, status: EntryStatus.POSTED }).lean();
    if (!entry) throw new Error('Journal entry not found');

    const debitLines = entry.lines.filter((line) => line.debit > 0).sort((a, b) => b.debit - a.debit);
    const creditLines = entry.lines.filter((line) => line.credit > 0).sort((a, b) => b.credit - a.credit);

    const primaryDebit = debitLines[0];
    const primaryCredit = creditLines[0];

    const insights: LedgerInsight[] = [
        {
            id: 'entry-factual',
            category: 'factual',
            title: 'Entry totals',
            message: `${entry.entryNo} is a posted ${entry.entryType} dated ${entry.postingDate.toISOString().split('T')[0]} with total debits and credits of ${round2(entry.totals.debitTotal).toFixed(2)}.`,
            evidence: [{
                journalEntryId: entry._id.toString(),
                entryNo: entry.entryNo,
                postingDate: entry.postingDate,
                sourceType: entry.sourceType,
                sourceNo: entry.sourceNo,
            }],
        },
    ];

    if (primaryDebit && primaryCredit) {
        insights.push({
            id: 'entry-inference',
            category: 'inference',
            title: 'Operational interpretation',
            message: `The entry mainly moved value into ${primaryDebit.accountCode} ${primaryDebit.accountName} from ${primaryCredit.accountCode} ${primaryCredit.accountName}.`,
            evidence: [{
                journalEntryId: entry._id.toString(),
                entryNo: entry.entryNo,
                accountId: primaryDebit.accountId.toString(),
                accountCode: primaryDebit.accountCode,
                accountName: primaryDebit.accountName,
                amount: primaryDebit.debit,
            }, {
                journalEntryId: entry._id.toString(),
                entryNo: entry.entryNo,
                accountId: primaryCredit.accountId.toString(),
                accountCode: primaryCredit.accountCode,
                accountName: primaryCredit.accountName,
                amount: primaryCredit.credit,
            }],
        });
    }

    if (entry.sourceType || entry.sourceNo) {
        insights.push({
            id: 'entry-source',
            category: 'factual',
            title: 'Source linkage',
            message: entry.sourceType
                ? `This journal entry is linked to ${sourceTypeLabel(entry.sourceType)} ${entry.sourceNo || ''}.`.trim()
                : 'This journal entry has no operational source document linked.',
            evidence: [{
                journalEntryId: entry._id.toString(),
                entryNo: entry.entryNo,
                sourceType: entry.sourceType,
                sourceNo: entry.sourceNo,
            }],
        });
    }

    return {
        summary: `${entry.entryNo} records a ${entry.entryType} for ${round2(entry.totals.debitTotal).toFixed(2)} total value.`,
        insights,
    };
};

export const askQuestion = async (tenantId: string, dto: LedgerQuestionDTO) => {
    const question = dto.question.trim();
    const normalized = question.toLowerCase();

    const sourceTypeHint = normalized.includes('ap')
        ? 'AP_INVOICE'
        : normalized.includes('ar')
            ? 'AR_INVOICE'
            : normalized.includes('goods receipt') || normalized.includes('grn')
                ? 'GRN'
                : normalized.includes('receipt')
                    ? 'AR_RECEIPT'
                    : normalized.includes('payment')
                        ? 'AP_PAYMENT'
                        : dto.sourceType;

    if ((normalized.includes('entry') || normalized.includes('journal')) && dto.entryId) {
        const narrative = await entryNarrative(tenantId, dto.entryId);
        return {
            question,
            interpretedAction: 'entry-narrative',
            summary: narrative.summary,
            insights: narrative.insights,
            anomalies: [],
            sourceSummary: [],
            followUps: [
                'Ask which accounts carried the largest amounts.',
                'Ask whether this entry looks unusual for the period.',
            ],
        };
    }

    if (/(unusual|anomaly|odd|suspicious|risk)/.test(normalized)) {
        const result = await detectAnomalies(tenantId, { ...dto, sourceType: sourceTypeHint });
        return {
            question,
            interpretedAction: 'anomalies',
            summary: result.summary,
            insights: [],
            anomalies: result.anomalies,
            sourceSummary: [],
            followUps: [
                'Ask which anomaly is highest priority.',
                'Ask for the source documents behind the flagged entries.',
            ],
        };
    }

    if (/(source|sources|contributor|contributors|summary|summarize|ap-related|ar-related|cash|grn)/.test(normalized)) {
        const result = await sourceSummary(tenantId, { ...dto, sourceType: sourceTypeHint });
        return {
            question,
            interpretedAction: 'source-summary',
            summary: result.summary,
            insights: result.insights,
            anomalies: [],
            sourceSummary: result.groups,
            followUps: [
                'Ask why the top source affected the account.',
                'Ask whether any of these source documents look unusual.',
            ],
        };
    }

    if (dto.accountId) {
        const result = await explainMovement(tenantId, dto as ExplainLedgerQuery);
        return {
            question,
            interpretedAction: 'movement-explainer',
            summary: result.summary,
            insights: result.insights,
            anomalies: [],
            sourceSummary: [...result.topDebitDrivers, ...result.topCreditDrivers].slice(0, 6),
            followUps: [
                'Ask for unusual entries in this account.',
                'Ask for the biggest source documents behind the movement.',
            ],
        };
    }

    const fallback = await detectAnomalies(tenantId, { ...dto, sourceType: sourceTypeHint });
    return {
        question,
        interpretedAction: 'anomalies',
        summary: fallback.summary,
        insights: [],
        anomalies: fallback.anomalies,
        sourceSummary: [],
        followUps: [
            'Try filtering to a specific account for a movement explanation.',
            'Ask for a source summary if you want the biggest contributors instead.',
        ],
    };
};

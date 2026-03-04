import { FiscalCalendar, IFiscalCalendar, IFiscalPeriod } from '../models/fiscalCalendar.model';
import mongoose from 'mongoose';

export class FiscalService {

    // 1. List Years
    async getFiscalYears(tenantId: string) {
        return FiscalCalendar.find({ tenantId }).sort({ startDate: -1 });
    }

    // 2. Get Year By ID
    async getFiscalYearById(tenantId: string, id: string) {
        return FiscalCalendar.findOne({ _id: id, tenantId });
    }

    // 3. Create Year
    async createFiscalYear(tenantId: string, data: any) {
        // Overlap check
        const overlap = await FiscalCalendar.findOne({
            tenantId,
            $or: [
                { startDate: { $lte: data.endDate }, endDate: { $gte: data.startDate } }
            ]
        });
        if (overlap) throw new Error('Fiscal year dates overlap with existing year');

        const doc = await FiscalCalendar.create({
            tenantId,
            yearName: data.yearName,
            startDate: data.startDate,
            endDate: data.endDate,
            isActive: data.isActive
        });

        if (data.generatePeriods) {
            await this.generatePeriods(tenantId, doc._id.toString(), { mode: 'MONTHLY', openPeriodNumber: 1 });
            return await this.getFiscalYearById(tenantId, doc._id.toString());
        }

        return doc;
    }

    // 4. Generate Periods (Embedded)
    async generatePeriods(tenantId: string, yearId: string, options: { mode: 'MONTHLY', openPeriodNumber: number }) {
        const doc = await FiscalCalendar.findOne({ _id: yearId, tenantId });
        if (!doc) throw new Error('Fiscal year not found');
        if (doc.periods && doc.periods.length > 0) throw new Error('Periods already exist');

        const periods: Partial<IFiscalPeriod>[] = [];
        let currentStart = new Date(doc.startDate);

        for (let i = 1; i <= 12; i++) {
            // Start of current month (already set in currentStart)
            const pStart = new Date(currentStart);
            pStart.setHours(0, 0, 0, 0);

            // Calculate Start of Next Month to determine End of Current Month
            const nextMonthStart = new Date(pStart);
            nextMonthStart.setMonth(nextMonthStart.getMonth() + 1);
            nextMonthStart.setDate(1);

            // End of Current Month is 1ms before Start of Next Month
            let pEnd = new Date(nextMonthStart.getTime() - 1);

            // Clamp to FY end if needed
            if (pEnd > doc.endDate) {
                pEnd = new Date(doc.endDate);
                pEnd.setHours(23, 59, 59, 999);
            }
            if (i === 12) {
                const fyEnd = new Date(doc.endDate);
                fyEnd.setHours(23, 59, 59, 999);
                pEnd = fyEnd;
            }

            const monthName = pStart.toLocaleString('default', { month: 'short' });
            const y = pStart.getFullYear();

            periods.push({
                periodNumber: i,
                code: `P${i.toString().padStart(2, '0')}`,
                label: `${monthName} ${y}`,
                startDate: pStart,
                endDate: pEnd,
                status: (i === options.openPeriodNumber) ? 'OPEN' : 'LOCKED'
            });

            // Prepare for next iteration
            currentStart = nextMonthStart;
        }

        doc.periods = periods as IFiscalPeriod[];
        await doc.save();
        return doc.periods;
    }

    // 5. Update Year (Top level)
    async updateFiscalYear(tenantId: string, yearId: string, data: { yearName?: string, isActive?: boolean }) {
        return FiscalCalendar.findOneAndUpdate(
            { _id: yearId, tenantId },
            { $set: data },
            { new: true }
        );
    }

    // 6. Update Period Status
    async updatePeriodStatus(tenantId: string, yearId: string, periodId: string, status: 'OPEN' | 'LOCKED' | 'CLOSED') {
        const doc = await FiscalCalendar.findOne({ _id: yearId, tenantId });
        if (!doc) throw new Error('Fiscal year not found');

        const periodIndex = doc.periods.findIndex(p => p._id.toString() === periodId);
        if (periodIndex === -1) throw new Error('Period not found');

        const period = doc.periods[periodIndex];

        // Validations
        if (period.status === 'CLOSED' && status === 'LOCKED') {
            throw new Error('Cannot lock a CLOSED period. Reopen it first.');
        }
        if (period.status === status) return doc; // No change

        period.status = status;
        await doc.save();
        return doc; // Return full doc or period? returning doc is safer for UI refresh
    }

    // 7. Close Year
    async closeFiscalYear(tenantId: string, yearId: string) {
        const doc = await FiscalCalendar.findOne({ _id: yearId, tenantId });
        if (!doc) throw new Error('Fiscal year not found');

        const allClosed = doc.periods.every(p => p.status === 'CLOSED');
        if (!allClosed) throw new Error('All periods must be CLOSED before closing the year');

        doc.status = 'CLOSED';
        await doc.save();
        return doc;
    }

    // 8. Resolve Date
    async resolveDate(tenantId: string, date: Date) {
        // Find Year
        const doc = await FiscalCalendar.findOne({
            tenantId,
            startDate: { $lte: date },
            endDate: { $gte: date }
        });

        if (!doc) return null;

        // Find Period embedded
        const period = doc.periods.find(p => p.startDate <= date && p.endDate >= date);
        if (!period) return null; // Should not happen if periods cover full year, but possible if gaps

        return {
            fiscalYearId: doc._id,
            yearName: doc.yearName,
            periodId: period._id,
            periodNumber: period.periodNumber,
            code: period.code,
            label: period.label,
            status: period.status,
            startDate: period.startDate,
            endDate: period.endDate
        };
    }

    // 9. Integrity Check
    async checkJournalIntegrity(tenantId: string) {
        // Find JEs where:
        // 1. fiscalPeriodId is missing
        // 2. fiscalPeriodId does not match resolved date
        // 3. fiscalYearId is missing

        // Note: We need dynamic import or DI for JournalEntry model to avoid circular depending if JE imports generic?
        // But here we can use mongoose.model('JournalEntry') 

        const JournalEntry = mongoose.model('JournalEntry');

        const postedEntries = await JournalEntry.find({ tenantId, status: 'POSTED' }).limit(1000); // Limit scan

        const issues: any[] = [];

        for (const entry of postedEntries) {
            const resolved = await this.resolveDate(tenantId, entry.postingDate);

            if (!resolved) {
                issues.push({
                    entryId: entry._id,
                    entryNo: entry.entryNo,
                    postingDate: entry.postingDate,
                    issue: 'No fiscal period matches posting date'
                });
                continue;
            }

            if (!entry.fiscalPeriodId || entry.fiscalPeriodId.toString() !== resolved.periodId.toString()) {
                issues.push({
                    entryId: entry._id,
                    entryNo: entry.entryNo,
                    postingDate: entry.postingDate,
                    currentPeriodId: entry.fiscalPeriodId,
                    expectedPeriodId: resolved.periodId,
                    issue: 'Fiscal Period Mismatch'
                });
            }

            if (!entry.fiscalYearId || entry.fiscalYearId.toString() !== resolved.fiscalYearId.toString()) {
                issues.push({
                    entryId: entry._id,
                    entryNo: entry.entryNo,
                    postingDate: entry.postingDate,
                    currentYearId: entry.fiscalYearId,
                    expectedYearId: resolved.fiscalYearId,
                    issue: 'Fiscal Year Mismatch'
                });
            }
        }

        return issues;
    }
}

export const fiscalService = new FiscalService();

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fiscalService } from '../services/fiscal.service';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://ibrahimkassim975_db_user:siUGhXg7RrnZXDuY@cluster0.adf3quy.mongodb.net/';

const seed = async () => {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('Connected to MongoDB');

        const tenantId = 'tenant_demo';

        // Clear existing collection directly using mongoose model
        const collections = await mongoose.connection.db.listCollections({ name: 'fiscal_calendars' }).toArray();
        if (collections.length > 0) {
            await mongoose.connection.db.dropCollection('fiscal_calendars');
            console.log('Cleared fiscal_calendars collection');
        }

        // Create FY 2026
        console.log('Creating Fiscal Year 2026...');
        const fy = await fiscalService.createFiscalYear(tenantId, {
            yearName: 'FY 2026',
            startDate: new Date('2026-01-01'),
            endDate: new Date('2026-12-31'),
            isActive: true,
            generatePeriods: true // This will trigger generatePeriods internal logic
        });

        if (!fy) {
            console.error('Failed to create Fiscal Year');
            process.exit(1);
        }

        console.log('Fiscal Year created:', fy.yearName);
        console.log(`Generated ${fy.periods.length} periods.`);

        // Set Jan 2026 to OPEN
        if (fy.periods.length > 0) {
            const p1 = fy.periods[0];
            await fiscalService.updatePeriodStatus(tenantId, fy.id, p1._id.toString(), 'OPEN');
            console.log('Set Period 1 to OPEN');
        }

        console.log('Done.');
        process.exit(0);
    } catch (error) {
        console.error('Error seeding:', error);
        process.exit(1);
    }
};

seed();

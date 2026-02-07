import mongoose from 'mongoose';
import { FiscalPeriod, FiscalPeriodStatus } from '../models/fiscalPeriod.model';
import dotenv from 'dotenv';
import path from 'path';

// Load env
dotenv.config({ path: path.join(__dirname, '../../.env') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://ibrahimkassim975_db_user:siUGhXg7RrnZXDuY@cluster0.adf3quy.mongodb.net/';

const seed = async () => {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('Connected to MongoDB');

        const tenantId = 'tenant_demo'; // Use default tenant

        // Generate 2026 periods
        const months = [
            '1 (Jan)', '2 (Feb)', '3 (Mar)', '4 (Apr)', '5 (May)', '6 (Jun)',
            '7 (Jul)', '8 (Aug)', '9 (Sep)', '10 (Oct)', '11 (Nov)', '12 (Dec)'
        ];

        for (let i = 0; i < 12; i++) {
            const startDate = new Date(2026, i, 1);
            const endDate = new Date(2026, i + 1, 0); // Last day of month

            const existing = await FiscalPeriod.findOne({ tenantId, startDate });
            if (!existing) {
                await FiscalPeriod.create({
                    tenantId,
                    name: `FY-2026-P${String(i + 1).padStart(2, '0')}`,
                    startDate,
                    endDate,
                    status: FiscalPeriodStatus.OPEN
                });
                console.log(`Created period: ${months[i]}`);
            } else {
                console.log(`Period exists: ${months[i]}`);
            }
        }

        console.log('Seeding complete');
        process.exit(0);
    } catch (error) {
        console.error('Seeding failed:', error);
        process.exit(1);
    }
};

seed();

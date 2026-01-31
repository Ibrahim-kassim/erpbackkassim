
import mongoose from 'mongoose';
import { FiscalCalendar } from './models/fiscalCalendar.model';
import dotenv from 'dotenv';
dotenv.config();

const run = async () => {
    try {
        const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/erp_coa';
        console.log('Connecting to:', uri);
        await mongoose.connect(uri);
        console.log('Connected to DB');

        const calendars = await FiscalCalendar.find({}).lean();
        console.log(`Found ${calendars.length} calendars.`);

        calendars.forEach((c, i) => {
            console.log(`CALENDAR[${i}] Tenant: "${c.tenantId}"`);
            // console.log('Periods:', c.periods.map(p => ({ id: p._id.toString(), code: p.code })));
        });

    } catch (e) {
        console.error(e);
    } finally {
        await mongoose.disconnect();
    }
};

run();

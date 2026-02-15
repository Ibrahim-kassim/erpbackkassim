import mongoose from 'mongoose';
import { config } from './config/env';
import { connectDB } from './config/db';
import { ChartOfAccount, AccountType, NormalBalance } from './models/chartOfAccount.model';

const seed = async () => {
    console.log('Connecting to DB...');
    await connectDB();

    const tenantId = 'tenant_demo';

    console.log('Clearing existing accounts...');
    await ChartOfAccount.deleteMany({ tenantId });

    console.log('Seeding accounts...');

    const accounts = [
        // ASSET
        {
            code: '1000', name: 'Cash', type: AccountType.ASSET, normalBalance: NormalBalance.DEBIT,
            level: 0, path: 'ASSET/1000', isPosting: true, isActive: true, tenantId
        },
        {
            code: '1100', name: 'Bank', type: AccountType.ASSET, normalBalance: NormalBalance.DEBIT,
            level: 0, path: 'ASSET/1100', isPosting: true, isActive: true, tenantId
        },
        {
            code: '1200', name: 'AR Control', type: AccountType.ASSET, normalBalance: NormalBalance.DEBIT,
            level: 0, path: 'ASSET/1200', isPosting: true, isActive: true, systemControlled: true, tenantId
        },
        // LIABILITY
        {
            code: '2000', name: 'AP Control', type: AccountType.LIABILITY, normalBalance: NormalBalance.CREDIT,
            level: 0, path: 'LIABILITY/2000', isPosting: true, isActive: true, systemControlled: true, tenantId
        },
        // EQUITY
        {
            code: '3999', name: 'Opening Balance Equity', type: AccountType.EQUITY, normalBalance: NormalBalance.CREDIT,
            level: 0, path: 'EQUITY/3999', isPosting: true, isActive: true, systemControlled: true, tenantId
        },
        // REVENUE
        {
            code: '4000', name: 'Sales Revenue', type: AccountType.REVENUE, normalBalance: NormalBalance.CREDIT,
            level: 0, path: 'REVENUE/4000', isPosting: true, isActive: true, tenantId
        },
        // EXPENSE
        {
            code: '5000', name: 'Operating Expense', type: AccountType.EXPENSE, normalBalance: NormalBalance.DEBIT,
            level: 0, path: 'EXPENSE/5000', isPosting: true, isActive: true, tenantId
        },
    ];

    await ChartOfAccount.insertMany(accounts);

    console.log('Seeding complete.');
    process.exit(0);
};

seed();

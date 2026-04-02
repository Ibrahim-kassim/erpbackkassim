import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { connectDB } from './config/db';
import { Tenant } from './models/tenant.model';
import { User } from './models/user.model';

const EMAIL = 'me@gmail.com';
const PASSWORD = 'password';
const DEFAULT_TENANT_NAME = 'ERP Kassim';
const DEFAULT_TENANT_SLUG = 'erp-kassim';

const run = async () => {
    await connectDB();

    const existingUsers = await User.find({ email: EMAIL }).sort({ createdAt: 1 });

    if (existingUsers.length > 1) {
        throw new Error(
            `Cannot seed ${EMAIL} because it already exists in multiple tenants: ${existingUsers
                .map((user) => user.tenantId)
                .join(', ')}`
        );
    }

    const passwordHash = await bcrypt.hash(PASSWORD, 12);

    if (existingUsers.length === 1) {
        const user = existingUsers[0];
        user.passwordHash = passwordHash;
        user.isActive = true;
        user.name = user.name || 'Demo User';
        user.role = user.role || 'ADMIN';
        await user.save();

        await Tenant.findOneAndUpdate(
            { slug: user.tenantId },
            {
                $setOnInsert: {
                    name: DEFAULT_TENANT_NAME,
                    slug: user.tenantId,
                    currency: 'USD',
                },
                $set: {
                    isActive: true,
                },
            },
            { upsert: true, new: true }
        );

        console.log(`Updated existing user ${EMAIL} in tenant ${user.tenantId}`);
        console.log(`Login email: ${EMAIL}`);
        console.log(`Login password: ${PASSWORD}`);
        return;
    }

    let tenant = await Tenant.findOne({ slug: DEFAULT_TENANT_SLUG });
    if (!tenant) {
        tenant = await Tenant.create({
            name: DEFAULT_TENANT_NAME,
            slug: DEFAULT_TENANT_SLUG,
            currency: 'USD',
            isActive: true,
        });
    } else if (!tenant.isActive) {
        tenant.isActive = true;
        await tenant.save();
    }

    await User.create({
        tenantId: tenant.slug,
        email: EMAIL,
        passwordHash,
        name: 'Demo User',
        role: 'ADMIN',
        isActive: true,
    });

    console.log(`Created login user ${EMAIL} in tenant ${tenant.slug}`);
    console.log(`Login email: ${EMAIL}`);
    console.log(`Login password: ${PASSWORD}`);
};

run()
    .catch((error) => {
        console.error('Failed to seed login user:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.connection.close();
    });

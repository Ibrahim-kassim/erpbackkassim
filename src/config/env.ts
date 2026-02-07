import dotenv from 'dotenv';

// Local only (Vercel ignores dotenv)
dotenv.config();

export const config = {
    env: process.env.NODE_ENV || 'development',
    port: Number(process.env.PORT) || 5000,

    // ALWAYS Atlas – from env only
    mongoUri: process.env.MONGO_URI as string,
};

// Safety check (optional but recommended)
if (!config.mongoUri) {
    throw new Error('❌ MONGO_URI is not defined');
}

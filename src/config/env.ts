import dotenv from 'dotenv';

// Local only (Vercel ignores dotenv)
dotenv.config();

export const config = {
    env: process.env.NODE_ENV || 'development',
    port: Number(process.env.PORT) || 5000,

    // ALWAYS Atlas – from env only
    mongoUri: process.env.MONGO_URI as string,

    // JWT
    jwtSecret: process.env.JWT_SECRET || 'dev_jwt_secret_change_in_production',
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'dev_refresh_secret_change_in_production',

    // AI
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    openaiModel: process.env.OPENAI_MODEL || 'gpt-5.2',
};

// Safety check
if (!config.mongoUri) {
    throw new Error('❌ MONGO_URI is not defined');
}

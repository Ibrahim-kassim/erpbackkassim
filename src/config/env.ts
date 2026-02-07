import dotenv from 'dotenv';
import path from 'path';

// Load .env file based on NODE_ENV
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env';
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

export const config = {
    port: process.env.PORT || 5000,
    mongoUri: process.env.MONGO_URI || 'mongodb+srv://ibrahimkassim975_db_user:siUGhXg7RrnZXDuY@cluster0.adf3quy.mongodb.net/',
    env: process.env.NODE_ENV || 'development',
};

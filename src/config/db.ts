import mongoose from 'mongoose';
import { config } from './env';

export const connectDB = async () => {
    // ✅ إذا في اتصال شغال، لا تعيد الاتصال
    if (mongoose.connection.readyState >= 1) {
        return;
    }

    try {
        await mongoose.connect(config.mongoUri);
        console.log('✅ MongoDB connected');
    } catch (error) {
        console.error('❌ MongoDB connection error:', error);
        throw error; // مهم بدل process.exit
    }
};

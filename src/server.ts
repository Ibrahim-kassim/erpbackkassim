import app from './app';
import { config } from './config/env';
import { connectDB } from './config/db';
import { startMailboxSyncScheduler } from './services/mailSyncScheduler.service';

const start = async () => {
    await connectDB();
    startMailboxSyncScheduler();

    app.listen(config.port, () => {
        console.log(`Server running in ${config.env} mode on port ${config.port}`);
    });
};

start();

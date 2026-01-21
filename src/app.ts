import express from 'express';
import cors from 'cors';
import { auth } from './middleware/auth';
import { errorHandler } from './middleware/errorHandler';
import coaRoutes from './routes/chartOfAccount.route';
import jeRoutes from './routes/journalEntry.route';
import fiscalRoutes from './routes/fiscal.route';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Auth (Set tenant)
app.use(auth);

// Routes
app.use('/api/v1/accounts', coaRoutes);
app.use('/api/v1/journal-entries', jeRoutes);
app.use('/api/v1/fiscal-periods', fiscalRoutes);

// Error Handling
app.use(errorHandler);

export default app;

import express from 'express';
import cors from 'cors';
import path from 'path';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import mongoSanitize from 'express-mongo-sanitize';

import { requireAuth } from './middleware/requireAuth';
import { errorHandler } from './middleware/errorHandler';

// ── Existing routes ────────────────────────────────────────────────────────────
import coaRoutes from './routes/chartOfAccount.route';
import jeRoutes from './routes/journalEntry.route';
import fiscalRoutes from './routes/fiscal.route';
import reportsRoutes from './routes/reports.route';
import adminRoutes from './routes/admin.route';
import businessPartnerRoutes from './routes/businessPartner.route';
import inventoryRoutes from './routes/inventory.route';
import rfqRoutes from './routes/rfq.route';
import quotationRoutes from './routes/quotation.route';
import purchaseOrderRoutes from './routes/purchaseOrder.route';
import configRoutes from './routes/config.route';
import grnRoutes from './routes/grn.route';

// ── New routes ─────────────────────────────────────────────────────────────────
import authRoutes from './routes/auth.route';
import apInvoiceRoutes from './routes/apInvoice.route';
import apPaymentRoutes from './routes/apPayment.route';
import arInvoiceRoutes from './routes/arInvoice.route';
import arReceiptRoutes from './routes/arReceipt.route';

const app = express();

// ── Security headers ───────────────────────────────────────────────────────────
app.use(helmet());

// ── CORS ───────────────────────────────────────────────────────────────────────
app.use(cors());

// ── Body parsing ───────────────────────────────────────────────────────────────
app.use(express.json());

// ── Static uploads ─────────────────────────────────────────────────────────────
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// ── Sanitize MongoDB operators from user input ─────────────────────────────────
app.use(mongoSanitize());

// ── Rate limiting on auth ──────────────────────────────────────────────────────
const authLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
app.use('/api/v1/auth/login', authLimiter);
app.use('/api/v1/auth/register', authLimiter);

// ── Public routes (no auth required) ──────────────────────────────────────────
app.use('/api/v1/auth', authRoutes);

// ── Auth middleware for all other routes ───────────────────────────────────────
app.use(requireAuth);

// ── Protected routes ───────────────────────────────────────────────────────────
app.use('/api/v1/accounts', coaRoutes);
app.use('/api/v1/journal-entries', jeRoutes);
app.use('/api/v1/fiscal', fiscalRoutes);
app.use('/api/v1/reports', reportsRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/business-partners', businessPartnerRoutes);
app.use('/api/v1/inventory', inventoryRoutes);
app.use('/api/v1/rfq', rfqRoutes);
app.use('/api/v1/quotations', quotationRoutes);
app.use('/api/v1/purchase-orders', purchaseOrderRoutes);
app.use('/api/v1/config', configRoutes);
app.use('/api/v1/grn', grnRoutes);

// ── AP / AR routes ─────────────────────────────────────────────────────────────
app.use('/api/v1/ap/invoices', apInvoiceRoutes);
app.use('/api/v1/ap/payments', apPaymentRoutes);
app.use('/api/v1/ar/invoices', arInvoiceRoutes);
app.use('/api/v1/ar/receipts', arReceiptRoutes);

// ── Global error handler ───────────────────────────────────────────────────────
app.use(errorHandler);

export default app;

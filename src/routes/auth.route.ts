import { Router } from 'express';
import * as controller from '../controllers/auth.controller';
import { requireAuth } from '../middleware/requireAuth';
import { requireRole } from '../middleware/requireRole';

const router = Router();

// ── Public routes (no auth required) ─────────────────────────────────────────
router.post('/login', controller.login);
router.post('/refresh', controller.refresh);

// ── Authenticated routes ──────────────────────────────────────────────────────
router.post('/logout', requireAuth, controller.logout);
router.get('/me', requireAuth, controller.getMe);
router.patch('/me/password', requireAuth, controller.changePassword);

// ── Admin: user management ────────────────────────────────────────────────────
router.get('/users', requireAuth, requireRole('ADMIN'), controller.listUsers);
router.post('/users', requireAuth, requireRole('ADMIN'), controller.createUser);
router.patch('/users/:id', requireAuth, requireRole('ADMIN'), controller.updateUser);

export default router;

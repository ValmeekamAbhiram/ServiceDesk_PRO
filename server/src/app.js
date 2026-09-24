/**
 * ServiceDesk Pro — Express application.
 *
 * Composition only: no route logic lives here. The middleware order is the one
 * documented at the top of `middleware/index.ts`, and each position is
 * load-bearing — read that comment before rearranging anything here.
 *
 * `createApp()` returns the app without listening, so `index.ts` can attach
 * Socket.IO to the same HTTP server and the test suite can drive it with supertest
 * without opening a port.
 */
import express from 'express';
import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';
import { env, publicConfig } from '@/config/env';
import { getClock } from '@/config/clock';
import { dbHealth } from '@/config/db';
import { errorHandler, globalRateLimit, notFoundHandler, requestId, requestLog, } from '@/middleware';
import { attachmentRouter } from '@/modules/attachments/attachment.routes';
import { authRouter } from '@/modules/auth/auth.routes';
import { assetRouter } from '@/modules/assets/asset.routes';
import { articleRouter } from '@/modules/articles/article.routes';
import { userRouter } from '@/modules/users/user.routes';
import { dashboardRouter } from '@/modules/dashboard/dashboard.routes';
import { notificationRouter } from '@/modules/notifications/notification.routes';
import { suggestionRouter } from '@/modules/suggestions/suggestion.routes';
import { slaRouter } from '@/modules/sla/sla.routes';
import { auditRouter } from '@/modules/audit/audit.routes';
import { settingsRouter } from '@/modules/settings/settings.routes';
import { demoRouter } from '@/modules/settings/demo.routes';
import { categoryRouter } from '@/modules/categories/category.routes';
import { ticketRouter } from '@/modules/tickets/ticket.routes';
import { ok } from '@/utils/respond';
export function createApp() {
    const app = express();
    /*
     * Behind a reverse proxy (Render, Railway, nginx) `req.ip` is the proxy's address
     * unless Express is told to trust the forwarding header. The rate limiter keys on
     * `req.ip`, so without this every visitor would share one bucket.
     */
    app.set('trust proxy', 1);
    app.disable('x-powered-by');
    app.use(requestId());
    app.use(helmet());
    app.use(cors({
        origin: env.corsOrigins,
        credentials: false, // tokens travel in the Authorization header, not cookies
        exposedHeaders: ['X-Request-Id', 'Retry-After'],
    }));
    app.use(compression());
    app.use(express.json({ limit: '1mb' }));
    app.use(express.urlencoded({ extended: true, limit: '1mb' }));
    app.use(requestLog());
    app.use(globalRateLimit());
    /* ─────────────────────────────── health ─────────────────────────────────
     * Unauthenticated and unmetered on purpose: a platform health check must not
     * need a credential, and must not be able to exhaust the rate limiter. It
     * reports only what `publicConfig()` allows — never the environment wholesale.
     * --------------------------------------------------------------------------- */
    app.get('/api/health', (_req, res) => {
        const db = dbHealth();
        const health = {
            status: db.status === 'up' ? 'ok' : 'degraded',
            time: getClock().now().toISOString(),
            db,
            ...publicConfig(),
        };
        return ok(res, health);
    });
    /* ──────────────────────────────── routes ─────────────────────────────── */
    app.use('/api/auth', authRouter);
    app.use('/api/categories', categoryRouter);
    app.use('/api/tickets', ticketRouter);
    app.use('/api/attachments', attachmentRouter);
    app.use('/api/assets', assetRouter);
    app.use('/api/articles', articleRouter);
    app.use('/api/users', userRouter);
    app.use('/api/dashboard', dashboardRouter);
    app.use('/api/notifications', notificationRouter);
    app.use('/api/suggestions', suggestionRouter);
    app.use('/api/sla-policy', slaRouter);
    app.use('/api/audit', auditRouter);
    app.use('/api/settings', settingsRouter);
    app.use('/api/demo', demoRouter);
    /* Must stay last, in this order. */
    app.use(notFoundHandler());
    app.use(errorHandler());
    return app;
}

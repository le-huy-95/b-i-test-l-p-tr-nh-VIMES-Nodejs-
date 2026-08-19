import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import pino from 'pino';
import routes from './routes';
import facebookWebhookRoutes from './modules/webhook/facebook-webhook.routes';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler';
import { env } from './config/env';

const app: Application = express();

// Behind Cloudflare / reverse proxy — required for express-rate-limit client IP
app.set('trust proxy', 1);

const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  ...(env.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : {}),
});

app.use(helmet());

app.use(
  cors({
    origin: env.CORS_ORIGINS.split(',').map((o) => o.trim()),
    credentials: true,
  }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(pinoHttp({ logger }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
});
app.use('/api/v1', apiLimiter);

app.use('/api/v1', routes);

app.use('/api/health', (req, res, next) => {
  req.url = '/';
  routes(req, res, next);
});

app.use('/webhook/facebook', facebookWebhookRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;

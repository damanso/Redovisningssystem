import express from 'express';
import helmet from 'helmet';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { authenticate } from './middleware/authenticate.js';
import { errorHandler } from './middleware/errorHandler.js';
import { authRouter } from './routes/auth.js';
import { companiesRouter } from './routes/companies.js';

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  // Bakom en reverse proxy måste TRUST_PROXY sättas så req.ip (och därmed
  // rate-limitern) ser klientens riktiga IP i stället för proxyns. Numeriskt
  // värde = antal hop; annars 'true'/'false' eller ett subnät.
  app.set('trust proxy', parseTrustProxy(config.TRUST_PROXY));
  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'db_unavailable' });
    }
  });

  app.use('/api/auth', authRouter);
  app.use('/api/companies', authenticate, companiesRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });
  app.use(errorHandler);

  return app;
}

function parseTrustProxy(value: string): boolean | number | string {
  if (value === 'true') return true;
  if (value === 'false') return false;
  const asNumber = Number(value);
  if (Number.isInteger(asNumber) && asNumber >= 0) return asNumber;
  return value; // subnät/IP-lista lämnas som den är till Express
}

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { authenticate } from './middleware/authenticate.js';
import { errorHandler } from './middleware/errorHandler.js';
import { authRouter } from './routes/auth.js';
import { companiesRouter } from './routes/companies.js';
import { viewRouter } from './view/routes.js';

// Typsnittskatalogen ligger bredvid dist/, inte i den: tsc kopierar inte
// binarfiler, och en katalog som forsvinner vid bygge hade gjort ytan
// typsnittslos utan att nagot sa nagot.
const TYPSNITTSKATALOG = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'typsnitt');

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  // Bakom en reverse proxy måste TRUST_PROXY sättas så req.ip (och därmed
  // rate-limitern) ser klientens riktiga IP i stället för proxyns. Numeriskt
  // värde = antal hop; annars 'true'/'false' eller ett subnät.
  app.set('trust proxy', parseTrustProxy(config.TRUST_PROXY));
  // CSP för den JS-fria webbvyn: skript är HELT förbjudna (script-src 'none'),
  // så även om HTML-escapingen skulle brista kan ingen skriptkod köras. Inline-
  // stil tillåts (vyn har en <style>-block men noll JavaScript).
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'none'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          objectSrc: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      // Helmets default är 'no-referrer', vilket får webbläsare att skicka
      // Origin: null på formulär-POST:ar — då nekas VÅRA EGNA inloggnings-/
      // åtgärds-POST:ar av assertSameOrigin (CSRF-kontrollen). Webbläsarens
      // standard 'strict-origin-when-cross-origin' skickar en riktig Origin för
      // samma-ursprung (så kontrollen fungerar) och läcker aldrig full sökväg
      // till främmande värdar (bara ursprunget). CSRF-skyddet är oförändrat.
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'db_unavailable' });
    }
  });

  // Typsnitten serveras harifran, aldrig fran en extern vard. CSP:n har
  // defaultSrc 'self' och ingen egen font-src, sa font-src arver 'self'.
  // Vitlistan ar en UPPRAKNING, inte ett monster: en regex over filnamn hade
  // varit ett skydd som gar att lura, och katalogen ar liten nog att rakna upp.
  app.get('/typsnitt/:fil', (req, res) => {
    const TILLATNA = new Set([
      'public-sans-latin-400-normal.woff2',
      'public-sans-latin-600-normal.woff2',
      'public-sans-latin-700-normal.woff2',
      'ibm-plex-mono-latin-400-normal.woff2',
      'ibm-plex-mono-latin-600-normal.woff2',
      'LICENSE-public-sans.txt',
      'LICENSE-ibm-plex-mono.txt',
    ]);
    const fil = String(req.params.fil ?? '');
    if (!TILLATNA.has(fil)) {
      res.status(404).type('text/plain').send('Finns inte');
      return;
    }
    res.type(fil.endsWith('.woff2') ? 'font/woff2' : 'text/plain');
    // Filnamnen bar version i innehallet, inte i namnet, sa cachen halls
    // kort nog att ett byte slar igenom samma dygn.
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(fil, { root: TYPSNITTSKATALOG }, (err) => {
      if (err && !res.headersSent) res.status(404).type('text/plain').send('Finns inte');
    });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/companies', authenticate, companiesRouter);

  // Läsbar, i huvudsak read-only webbvy (Fas 4) — serverrenderad HTML.
  app.use('/app', viewRouter);
  app.get('/', (_req, res) => res.redirect('/app'));

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

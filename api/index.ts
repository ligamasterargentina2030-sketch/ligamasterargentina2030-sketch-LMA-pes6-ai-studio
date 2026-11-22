import type { Request, Response } from 'express';
import { getExpressApp } from '../server';

export const config = {
  api: {
    bodyParser: false,
  },
};

function restoreRequestUrl(req: Request): void {
  const rawUrl = req.url || '/';
  const parsed = new URL(rawUrl, 'http://localhost');
  const rewrittenPath = parsed.searchParams.get('__path');

  if (rewrittenPath) {
    parsed.searchParams.delete('__path');
    const cleanPath = rewrittenPath.startsWith('/') ? rewrittenPath : `/${rewrittenPath}`;
    const qs = parsed.searchParams.toString();
    const restored = qs ? `${cleanPath}?${qs}` : cleanPath;
    req.url = restored;
    if ('originalUrl' in req) {
      (req as Request & { originalUrl?: string }).originalUrl = restored;
    }
  }
}

export default async function handler(req: Request, res: Response): Promise<void> {
  restoreRequestUrl(req);

  try {
    const app = await getExpressApp();
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        res.off('finish', done);
        res.off('close', done);
        resolve();
      };
      res.once('finish', done);
      res.once('close', done);
      app(req, res);
    });
  } catch (err) {
    console.error('Vercel serverless API error:', err);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Error interno inicializando el servidor API.',
      });
    } else if (!res.writableEnded) {
      res.end();
    }
  }
}

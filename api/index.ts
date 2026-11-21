import type { Request, Response } from 'express';
import { getExpressApp } from '../server';

export default async function handler(req: Request, res: Response) {
  const app = await getExpressApp();
  return app(req, res);
}

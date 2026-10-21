import express from 'express';
import path from 'node:path';
import { runtimeConfig } from '../../config/runtime.js';
export function serveFrontends(app: any) {
  const distribution = path.join(runtimeConfig.root, 'apps/web/dist');
  app.use(express.static(distribution, { index: false }));
  for (const edition of ['enterprise', 'student']) {
    app.use(
      '/' + edition,
      express.static(path.join(distribution, edition), { index: false }),
    );
  }
  app.use(
    (r: express.Request, s: express.Response, next: express.NextFunction) => {
      if (
        r.method !== 'GET' ||
        r.path.startsWith('/api/') ||
        path.extname(r.path)
      )
        return next();
      const edition = /^\/student(?:\/|$)/.test(r.path)
        ? 'student'
        : 'enterprise';
      s.sendFile(path.join(distribution, edition, 'index.html'));
    },
  );
}

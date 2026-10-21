import 'dotenv/config';

import 'reflect-metadata';
import type { Router } from 'express';
import { qqRoutes } from '../../shared/context.js';
export function installAccountRoutes(router: Router) {
  router.use(qqRoutes.account);
}

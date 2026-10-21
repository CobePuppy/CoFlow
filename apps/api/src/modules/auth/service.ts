import 'dotenv/config';
import 'reflect-metadata';

import { db } from '../../shared/access.js';
import { createQQRoutes } from '../qq/routes.js';
const attempts = new Map<string, { count: number; until: number }>();
const registrationAttempts = new Map<
  string,
  { count: number; until: number }
>();
const qqRoutes = createQQRoutes(db);
export { attempts, qqRoutes, registrationAttempts };

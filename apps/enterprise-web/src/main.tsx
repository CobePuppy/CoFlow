import { configureEdition } from '@coflow/web-core/app/edition';
import { appDefinition } from './app.config.js';
configureEdition('enterprise', appDefinition);
void import('@coflow/web-core/app/mount');

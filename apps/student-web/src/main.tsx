import { configureEdition } from '@coflow/web-core/app/edition';
import { registerEditionPage } from '@coflow/web-core/app/edition-pages';
import { appDefinition } from './app.config.js';
configureEdition('student', appDefinition);
registerEditionPage('competitions', () => import('./features/Competitions.js'));
registerEditionPage('writing', () => import('./features/StudentWriting.js'));
registerEditionPage('firststep', () => import('./features/FirstStepAgent.js'));
void import('@coflow/web-core/app/mount');

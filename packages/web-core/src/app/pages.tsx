import { page } from '@coflow/ui/lazy-page';
import { editionPage } from './edition-pages.js';
export const Workspace = page(
  () => import('../features/requirements/Workspace.js'),
);
export const Documents = page(
  () => import('../features/documents/Documents.js'),
);
export const Management = page(
  () => import('../features/projects/Management.js'),
);
export const Portal = page(() =>
  import('../features/portal/components/Portal.js').then((m) => ({
    default: m.Portal,
  })),
);

export const Templates = page(
  () => import('../features/requirements/Templates.js'),
);
export const ProjectForks = page(
  () => import('../features/forks/ProjectForks.js'),
);

export const Competitions = editionPage('competitions');
export const StudentWriting = editionPage('writing');

export const FirstStepAgent = editionPage('firststep');

export const Settings = page(() => import('../features/settings/Settings.js'));

export const ProofLoop = page(
  () => import('../features/proofloop/ProofLoop.js'),
);

export const ProjectSettings = page(
  () => import('../features/projects/ProjectSettings.js'),
);

export const AIQuality = page(
  () => import('../features/requirements/AIQuality.js'),
);
export const FileImport = page(
  () => import('../features/documents/components/FileImport.js'),
);

export const Iterations = page(
  () => import('../features/iterations/Iterations.js'),
);

export const DiscussionCenter = page(
  () => import('../features/requirements/DiscussionCenter.js'),
);

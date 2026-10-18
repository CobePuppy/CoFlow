export type Experiment = {
  id: string;
  title: string;
  ownerId: string;
  status: 'TODO' | 'DOING' | 'DONE';
  result: string;
};
export type ForkRoute = {
  name: string;
  hypothesis: string;
  plan: string;
  hoursBudget: number;
  costBudget: number;
  deadline: string;
  actualHours: number | null;
  actualCost: number | null;
  outcome: string;
  artifacts: { id: string; title: string; content: string }[];
  experiments: Experiment[];
};
export type ProjectFork = {
  deletedTaskIds?: string[];
  id: string;
  projectId: string;
  title: string;
  goal: string;
  criterion: string;
  version: number;
  data: {
    routes: ForkRoute[];
    snapshot: {
      at: string;
      description: string;
      documents: {
        id: string;
        title: string;
        content: string;
        version: number;
      }[];
      tasks: {
        id: string;
        number: number;
        title: string;
        status: string;
        version: number;
      }[];
    };
    decision?: {
      selectedRoute: number;
      reason: string;
      by: string;
      at: string;
      documentIds: string[];
      retained: string[];
    };
  };
};

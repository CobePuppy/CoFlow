import type { TaskOption } from '../../../packages/contracts/index.js';
type Request = (url: string) => Promise<{ items: TaskOption[]; total: number }>;
export async function loadTaskOptions(
  request: Request,
  projectId: string,
): Promise<TaskOption[]> {
  const result = new Map<string, TaskOption>();
  for (let page = 1; ; page++) {
    const response = await request(
      `/projects/${projectId}/task-options?page=${page}&pageSize=100`,
    );
    for (const item of response.items) result.set(item.id, item);
    if (page * 100 >= response.total) return [...result.values()];
    if (!response.items.length) throw new Error('关联任务加载不完整，请重试');
  }
}

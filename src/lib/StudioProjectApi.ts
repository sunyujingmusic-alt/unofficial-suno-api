import type { SunoApi } from '@/lib/SunoApi';

export async function createStudioProject(api: SunoApi, title?: string): Promise<any> {
  return api.studioRequest({
    method: 'POST',
    endpoint: '/api/studio/create-project',
    data: {},
    params: title?.trim() ? { title: title.trim() } : undefined,
    timeout: 30000,
  });
}

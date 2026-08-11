import { NextRequest } from 'next/server';
import { createStudioProject } from '@/lib/StudioProjectApi';
import { listStudioProjects } from '@/lib/StudioDirectApi';
import { studioApiFromRequest, studioError, studioJson, studioOptions } from '@/lib/studioHttp';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const params: Record<string, unknown> = {};
    for (const key of ['cursor', 'limit', 'include_archived']) {
      const value = url.searchParams.get(key);
      if (value !== null) params[key] = value;
    }
    return studioJson(await listStudioProjects(await studioApiFromRequest(), params));
  } catch (error: any) {
    return studioError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    return studioJson(await createStudioProject(await studioApiFromRequest(), body.title));
  } catch (error: any) {
    return studioError(error);
  }
}

export async function OPTIONS() {
  return studioOptions();
}

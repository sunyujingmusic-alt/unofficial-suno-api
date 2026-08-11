import { NextRequest } from 'next/server';
import { getStudioRevision } from '@/lib/StudioDirectApi';
import { studioApiFromRequest, studioError, studioJson, studioOptions } from '@/lib/studioHttp';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { revisionId: string } }) {
  try {
    return studioJson(await getStudioRevision(await studioApiFromRequest(), params.revisionId));
  } catch (error: any) {
    return studioError(error);
  }
}

export async function OPTIONS() {
  return studioOptions();
}

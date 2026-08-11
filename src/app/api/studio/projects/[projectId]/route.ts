import { NextRequest } from 'next/server';
import { getStudioProject, saveStudioProject, studioProjectMutation } from '@/lib/StudioDirectApi';
import { studioApiFromRequest, studioError, studioJson, studioOptions } from '@/lib/studioHttp';
import { unverifiedStudioWriteRejection } from '@/lib/studioSecurity';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { projectId: string } }) {
  try {
    return studioJson(await getStudioProject(await studioApiFromRequest(), params.projectId));
  } catch (error: any) {
    return studioError(error);
  }
}

export async function POST(req: NextRequest, { params }: { params: { projectId: string } }) {
  try {
    const body = await req.json();
    const action = body.action || 'save';
    if (action === 'save') {
      const payload = body.payload && typeof body.payload === 'object' ? body.payload : body;
      const { action: _action, payload: _payload, ...directPayload } = payload;
      if (directPayload.studio_project_id && directPayload.studio_project_id !== params.projectId) {
        return studioJson({ error: 'studio_project_id does not match the URL project id' }, 400);
      }
      if (directPayload.workspace_project_id) {
        return studioJson({ error: 'workspace_project_id is not accepted by save-project; this endpoint saves a Studio project only' }, 400);
      }
      const { workspace_project_id: _workspace_project_id, studio_project_id: _studio_project_id, project_id: supplied_project_id, ...saveBody } = directPayload;
      if (supplied_project_id && supplied_project_id !== params.projectId) {
        return studioJson({ error: 'save-project project_id does not match the Studio project id in the URL' }, 400);
      }
      // Suno's save-project wire contract names the Studio ID `project_id`.
      // This route prevents a Workspace ID from being substituted into it.
      return studioJson(await saveStudioProject(await studioApiFromRequest(), {
        ...saveBody,
        project_id: params.projectId,
      }));
    }
    if (!['archive', 'unarchive', 'bookmark', 'metadata'].includes(action)) {
      return studioJson({ error: 'action must be save, archive, unarchive, bookmark, or metadata' }, 400);
    }
    const rejection = unverifiedStudioWriteRejection(req, body);
    if (rejection) return studioJson(rejection.payload, rejection.status);
    const { action: _action, payload: _payload, ...mutationBody } = body;
    delete mutationBody.confirm_unverified_write;
    return studioJson(await studioProjectMutation(await studioApiFromRequest(), params.projectId, action, mutationBody));
  } catch (error: any) {
    return studioError(error);
  }
}

export async function OPTIONS() {
  return studioOptions();
}

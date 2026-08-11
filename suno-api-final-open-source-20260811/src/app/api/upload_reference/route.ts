import { NextResponse, NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { sunoApi } from '@/lib/SunoApi';
import { corsHeaders, extractErrorMessage, extractErrorStatus } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

const DEFAULT_UPLOAD_WORKSPACE = 'temp';

function parseBoolean(value: FormDataEntryValue | string | null | undefined, fallback?: boolean): boolean | undefined {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  }
  return Boolean(value);
}

function parseNumber(value: FormDataEntryValue | string | null | undefined): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || '';
    const api = await sunoApi((await cookies()).toString());

    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('file');
      if (!(file instanceof File)) {
        return new NextResponse(JSON.stringify({ error: 'file is required for multipart upload' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      const requestedProjectId = String(form.get('project_id') || form.get('projectId') || '').trim() || undefined;
      const requestedProjectName = String(form.get('project_name') || form.get('projectName') || '').trim() || DEFAULT_UPLOAD_WORKSPACE;

      const result = await api.uploadReferenceAudio({
        source_buffer: Buffer.from(await file.arrayBuffer()),
        content_type: file.type,
        upload_filename: String(form.get('upload_filename') || form.get('uploadFilename') || file.name || '').trim() || file.name,
        extension: String(form.get('extension') || '').trim() || undefined,
        is_stem_mix: parseBoolean(form.get('is_stem_mix') || form.get('isStemMix'), false),
        upload_type: String(form.get('upload_type') || form.get('uploadType') || '').trim() || undefined,
        initialize_clip: parseBoolean(form.get('initialize_clip') || form.get('initializeClip'), true),
        wait_upload: parseBoolean(form.get('wait_upload') || form.get('waitUpload'), true),
        poll_interval_seconds: parseNumber(form.get('poll_interval_seconds') || form.get('pollIntervalSeconds')),
        max_poll_attempts: parseNumber(form.get('max_poll_attempts') || form.get('maxPollAttempts')),
        title: String(form.get('title') || '').trim() || undefined,
        lyrics: String(form.get('lyrics') || '').trim() || undefined,
        project_id: requestedProjectId,
        project_name: requestedProjectId ? undefined : requestedProjectName,
      });

      return new NextResponse(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const body = await req.json();
    const requestedProjectId = body.project_id || body.projectId;
    const requestedProjectName = (body.project_name || body.projectName || '').trim() || DEFAULT_UPLOAD_WORKSPACE;
    const result = await api.uploadReferenceAudio({
      audio_url: body.audio_url || body.audioUrl,
      upload_filename: body.upload_filename || body.uploadFilename,
      extension: body.extension,
      is_stem_mix: body.is_stem_mix ?? body.isStemMix,
      upload_type: body.upload_type || body.uploadType,
      initialize_clip: body.initialize_clip ?? body.initializeClip,
      wait_upload: body.wait_upload ?? body.waitUpload,
      poll_interval_seconds: body.poll_interval_seconds ?? body.pollIntervalSeconds,
      max_poll_attempts: body.max_poll_attempts ?? body.maxPollAttempts,
      title: body.title,
      lyrics: body.lyrics,
      project_id: requestedProjectId,
      project_name: requestedProjectId ? undefined : requestedProjectName,
    });

    return new NextResponse(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (error: any) {
    return new NextResponse(JSON.stringify({ error: extractErrorMessage(error) }), {
      status: extractErrorStatus(error),
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 200, headers: corsHeaders });
}

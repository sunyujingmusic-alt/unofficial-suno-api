import { NextResponse, NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { DEFAULT_MODEL, sunoApi } from '@/lib/SunoApi';
import { corsHeaders, extractErrorMessage, extractErrorStatus } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

function parseBoolean(value: unknown, fallback?: boolean): boolean | undefined {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  }
  return Boolean(value);
}

function parseNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const audioId = body.audio_id || body.audioId;

    if (!audioId) {
      return new NextResponse(JSON.stringify({ error: 'audio_id is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const api = await sunoApi((await cookies()).toString());
    const result = await api.extendAudio({
      audio_id: String(audioId),
      prompt: body.prompt || body.lyrics || '',
      continue_at: parseNumber(body.continue_at ?? body.continueAt),
      tags: body.tags || body.style || '',
      negative_tags: body.negative_tags || body.negativeTags,
      title: body.title || '',
      model: body.model || body.mv || DEFAULT_MODEL,
      wait_audio: parseBoolean(body.wait_audio ?? body.waitAudio),
      project_id: body.project_id || body.projectId,
      project_name: body.project_name || body.projectName,
      force_workspace_assignment: parseBoolean(body.force_workspace_assignment ?? body.forceWorkspaceAssignment),
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

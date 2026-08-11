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

function parseMashupClipIds(body: Record<string, any>): string[] {
  const list = body.mashup_clip_ids || body.mashupClipIds || body.clip_ids || body.clipIds;
  if (Array.isArray(list)) {
    return list.map((clipId) => String(clipId).trim()).filter(Boolean);
  }

  return [
    body.first_clip_id || body.firstClipId || body.clip_id_1 || body.clipId1,
    body.second_clip_id || body.secondClipId || body.clip_id_2 || body.clipId2,
  ].map((clipId) => String(clipId || '').trim()).filter(Boolean);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const mashupClipIds = parseMashupClipIds(body);

    if (mashupClipIds.length !== 2) {
      return new NextResponse(JSON.stringify({ error: 'mashup_clip_ids must contain exactly two clip IDs' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const api = await sunoApi((await cookies()).toString());
    const result = await api.mashupGenerate({
      mashup_clip_ids: mashupClipIds,
      lyrics: body.lyrics || body.prompt || '',
      style: body.style || body.tags || '',
      title: body.title || 'mashup-generate',
      negative_tags: body.negative_tags || body.negativeTags,
      make_instrumental: parseBoolean(body.make_instrumental ?? body.makeInstrumental),
      model: body.model || body.mv || DEFAULT_MODEL,
      wait_audio: parseBoolean(body.wait_audio ?? body.waitAudio),
      vocal_gender: body.vocal_gender || body.vocalGender,
      style_weight: parseNumber(body.style_weight ?? body.styleWeight),
      weirdness_constraint: parseNumber(body.weirdness_constraint ?? body.weirdnessConstraint),
      audio_weight: parseNumber(body.audio_weight ?? body.audioWeight),
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

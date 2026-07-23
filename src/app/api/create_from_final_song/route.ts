import path from 'path';
import { NextResponse, NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { DEFAULT_MODEL, getDefaultOutputRoot, getDefaultWorkspaceName, sunoApi } from '@/lib/SunoApi';
import { FinalSongValidationError, validateFinalSongPayload, writeFinalSongJson } from '@/lib/finalSong';
import { corsHeaders, extractErrorMessage, extractErrorStatus } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

function buildPathTimestamp(date: Date = new Date(), timeZone: string = process.env.SUNO_OUTPUT_TIMEZONE || 'Asia/Shanghai'): string {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  return `${byType.year}${byType.month}${byType.day}${byType.hour}${byType.minute}${byType.second}`;
}

function slugify(input?: string): string {
  return (input || 'untitled')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'untitled';
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const finalSongSource = body.final_song || {
      title: body.title,
      lyrics: body.lyrics,
      styles: body.styles,
    };
    const { payload: finalSong, validation } = validateFinalSongPayload(finalSongSource);
    const outputDir = body.output_dir || body.outputDir || path.resolve(
      getDefaultOutputRoot(),
      `${buildPathTimestamp()}_${slugify(finalSong.title)}`
    );
    const finalSongJson = await writeFinalSongJson(outputDir, finalSong);

    const api = await sunoApi((await cookies()).toString());
    const requestedProjectId = body.project_id || body.projectId;
    const requestedProjectName = (body.project_name || body.projectName || '').trim() || getDefaultWorkspaceName();
    const waitAudio = body.wait_audio === undefined ? true : Boolean(body.wait_audio);
    const resolvedWorkspace = requestedProjectId
      ? await api.resolveWorkspace({ project_id: requestedProjectId })
      : requestedProjectName
        ? await api.ensureWorkspace(requestedProjectName)
        : null;

    const clips = await api.customGenerate(
      finalSong.lyrics,
      finalSong.styles,
      finalSong.title,
      Boolean(body.make_instrumental),
      body.model || DEFAULT_MODEL,
      waitAudio,
      body.negative_tags,
      {
        project_id: resolvedWorkspace?.id || requestedProjectId,
        project_name: resolvedWorkspace?.name || requestedProjectName,
      }
    );

    return new NextResponse(JSON.stringify({
      final_song_json: finalSongJson,
      final_song_validation: validation,
      song_ids: clips.map((clip) => clip.id),
      output_dir: outputDir,
      wait_audio: waitAudio,
      workspace: {
        requested_project_id: requestedProjectId || null,
        requested_project_name: requestedProjectName || null,
        resolved_project_id: resolvedWorkspace?.id || null,
        resolved_project_name: resolvedWorkspace?.name || null,
      },
      clips,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (error: any) {
    if (error instanceof FinalSongValidationError) {
      return new NextResponse(JSON.stringify({ error: error.message, validation: error.validation }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    return new NextResponse(JSON.stringify({ error: extractErrorMessage(error) }), {
      status: extractErrorStatus(error),
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 200, headers: corsHeaders });
}

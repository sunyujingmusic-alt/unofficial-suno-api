import { NextResponse, NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { sunoApi } from '@/lib/SunoApi';
import { corsHeaders, extractErrorMessage, extractErrorStatus } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const clips = Array.isArray(body.clips)
      ? body.clips
      : Array.isArray(body.clip_ids || body.clipIds)
        ? (body.clip_ids || body.clipIds).map((id: string, index: number) => ({ clip_id: id, order: index }))
        : [];

    if (clips.length < 2) {
      return new NextResponse(JSON.stringify({ error: 'at least two clips are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const api = await sunoApi((await cookies()).toString());
    const result = await api.concatClipsWithStudio({
      clips,
      title: body.title,
      lyrics: body.lyrics,
      tags: body.tags,
      negative_tags: body.negative_tags || body.negativeTags,
      style_summary: body.style_summary || body.styleSummary,
      caption: body.caption,
      tail_pad_seconds: body.tail_pad_seconds || body.tailPadSeconds,
      wait_audio: body.wait_audio,
      max_poll_attempts: body.max_poll_attempts || body.maxPollAttempts,
      poll_interval_seconds: body.poll_interval_seconds || body.pollIntervalSeconds,
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

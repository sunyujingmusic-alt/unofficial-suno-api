import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';

import { sunoApi } from '@/lib/SunoApi';
import { corsHeaders, extractErrorMessage, extractErrorStatus } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  try {
    const clipId = new URL(req.url).searchParams.get('id')?.trim() || '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clipId)) {
      return Response.json({ error: 'A valid Suno clip id is required' }, {
        status: 400,
        headers: corsHeaders,
      });
    }
    const result = await (await sunoApi((await cookies()).toString())).getPlaybackAudio(clipId);
    return new Response(result.data, {
      status: 200,
      headers: {
        'Content-Type': result.content_type,
        'Content-Length': String(result.data.byteLength),
        'Cache-Control': 'private, no-store',
        'X-Suno-Playback-Delivery': result.delivery,
        'X-Suno-Playback-Encoding': result.encoding || 'none',
        'X-Suno-Playback-Encrypted-Source': result.encrypted_source ? '1' : '0',
        'X-Suno-Playback-File-Extension': result.extension,
        ...corsHeaders,
      },
    });
  } catch (error: any) {
    return Response.json({ error: extractErrorMessage(error) }, {
      status: extractErrorStatus(error),
      headers: corsHeaders,
    });
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 200, headers: corsHeaders });
}

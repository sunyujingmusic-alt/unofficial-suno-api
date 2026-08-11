import { NextResponse, NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { DEFAULT_MODEL, sunoApi } from '@/lib/SunoApi';
import { corsHeaders, extractErrorMessage, extractErrorStatus } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const result = await (await sunoApi((await cookies()).toString())).generate(
      body.prompt,
      Boolean(body.make_instrumental),
      body.model || DEFAULT_MODEL,
      Boolean(body.wait_audio)
    );
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

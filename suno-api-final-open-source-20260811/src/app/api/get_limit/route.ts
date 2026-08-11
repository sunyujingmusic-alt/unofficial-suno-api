import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { sunoApi } from '@/lib/SunoApi';
import { corsHeaders, extractErrorMessage, extractErrorStatus } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const limit = await (await sunoApi((await cookies()).toString())).getCredits();
    return new NextResponse(JSON.stringify(limit), {
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

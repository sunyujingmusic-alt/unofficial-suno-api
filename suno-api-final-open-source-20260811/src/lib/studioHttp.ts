import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { sunoApi } from '@/lib/SunoApi';
import { corsHeaders, extractErrorMessage, extractErrorStatus } from '@/lib/utils';

export async function studioApiFromRequest() {
  return sunoApi((await cookies()).toString());
}

export function studioJson(value: unknown, status = 200): NextResponse {
  return new NextResponse(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

export function studioError(error: any): NextResponse {
  return studioJson({ error: extractErrorMessage(error) }, extractErrorStatus(error));
}

export function studioOptions(): Response {
  return new Response(null, { status: 200, headers: corsHeaders });
}

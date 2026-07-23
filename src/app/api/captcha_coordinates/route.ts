import axios from 'axios';
import { NextRequest, NextResponse } from 'next/server';
import { buildCoordinatesTask } from '@/lib/captchaContext';
import { corsHeaders, extractErrorMessage, extractErrorStatus, logger, sleep } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

const MAX_BASE64_LENGTH = 820_000;

function json(payload: unknown, status: number = 200): NextResponse {
  return new NextResponse(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = (process.env.TWOCAPTCHA_API_KEY || '').trim();
    if (!apiKey) return json({ error: '2Captcha API key is not configured' }, 503);

    const body = await req.json();
    const image = String(body.image_base64 || body.body || '').trim().replace(/^data:image\/[^;]+;base64,/, '');
    if (!image) return json({ error: 'image_base64 is required' }, 400);
    if (image.length > MAX_BASE64_LENGTH) return json({ error: 'captcha image exceeds the 600 kB 2Captcha limit' }, 413);

    const task = buildCoordinatesTask({
      body: image,
      comment: String(body.comment || 'Solve the image challenge and return every required click point').slice(0, 500),
      minClicks: body.min_clicks === undefined ? 1 : Number(body.min_clicks),
      maxClicks: body.max_clicks === undefined ? 16 : Number(body.max_clicks),
    });
    const createResponse = await axios.post(
      'https://api.2captcha.com/createTask',
      { clientKey: apiKey, task },
      { proxy: false, timeout: 35000 }
    );
    if (createResponse.data?.errorId) {
      throw new Error(`2Captcha CoordinatesTask create failed: ${createResponse.data.errorCode || createResponse.data.errorDescription || createResponse.data.errorId}`);
    }
    const taskId = Number(createResponse.data?.taskId);
    if (!Number.isFinite(taskId) || taskId <= 0) {
      throw new Error('2Captcha CoordinatesTask returned no task id');
    }

    logger.info('2Captcha CoordinatesTask submitted: ' + JSON.stringify({ task_id: taskId }));
    const startedAt = Date.now();
    while (Date.now() - startedAt < 120_000) {
      await sleep(3);
      const result = await axios.post(
        'https://api.2captcha.com/getTaskResult',
        { clientKey: apiKey, taskId },
        { proxy: false, timeout: 35000 }
      );
      if (result.data?.errorId) {
        throw new Error(`2Captcha CoordinatesTask poll failed: ${result.data.errorCode || result.data.errorDescription || result.data.errorId}`);
      }
      if (result.data?.status === 'processing') continue;
      if (result.data?.status !== 'ready') {
        throw new Error(`Unexpected 2Captcha CoordinatesTask status: ${String(result.data?.status)}`);
      }
      const coordinates = Array.isArray(result.data?.solution?.coordinates)
        ? result.data.solution.coordinates
          .map((point: any) => ({ x: Number(point?.x), y: Number(point?.y) }))
          .filter((point: any) => Number.isFinite(point.x) && Number.isFinite(point.y))
        : [];
      if (coordinates.length === 0) throw new Error('2Captcha CoordinatesTask returned no coordinates');
      return json({
        task_id: taskId,
        coordinates,
        solve_count: Number(result.data?.solveCount || 0),
        elapsed_ms: Date.now() - startedAt,
      });
    }
    throw new Error('2Captcha CoordinatesTask timed out after 120s');
  } catch (error: any) {
    return json({ error: extractErrorMessage(error) }, extractErrorStatus(error));
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const apiKey = (process.env.TWOCAPTCHA_API_KEY || '').trim();
    if (!apiKey) return json({ error: '2Captcha API key is not configured' }, 503);
    const body = await req.json();
    const taskId = Number(body.task_id);
    if (!Number.isFinite(taskId) || taskId <= 0) return json({ error: 'valid task_id is required' }, 400);
    const response = await axios.post(
      'https://api.2captcha.com/reportIncorrect',
      { clientKey: apiKey, taskId },
      { proxy: false, timeout: 30000 }
    );
    return json({
      task_id: taskId,
      status: response.data?.status || null,
      error_id: Number(response.data?.errorId || 0),
    });
  } catch (error: any) {
    return json({ error: extractErrorMessage(error) }, extractErrorStatus(error));
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 200, headers: corsHeaders });
}

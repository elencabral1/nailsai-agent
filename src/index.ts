/**
 * NailsAI Agent - Cloudflare Worker Entrypoint
 *
 * Routes:
 *   POST /webhook/evolution  - Receives WhatsApp messages from Evolution API
 *   GET  /health             - Health check
 *   POST /api/test-message   - Send a test message directly (for dev/demo)
 */

import { ClientSessionDO, Env } from './durable-objects/ClientSessionDO';
import {
  EvolutionClient,
  EvolutionWebhookPayload,
  extractMessageText,
  normalizePhone,
} from './services/evolution';

export { ClientSessionDO };
export type { Env };

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // ── Health Check ──────────────────────────────────────────────────────────
    if (request.method === 'GET' && url.pathname === '/health') {
      return Response.json({
        status: 'ok',
        service: 'nailsai-agent',
        timestamp: new Date().toISOString(),
      });
    }

    // ── Evolution API Webhook ─────────────────────────────────────────────────
    if (request.method === 'POST' && url.pathname === '/webhook/evolution') {
      return handleEvolutionWebhook(request, env);
    }

    // ── Direct Test Endpoint (Dev/Demo only) ──────────────────────────────────
    if (request.method === 'POST' && url.pathname === '/api/test-message') {
      return handleTestMessage(request, env);
    }

    return new Response('Not Found', { status: 404 });
  },
};

// ─── Evolution Webhook Handler ────────────────────────────────────────────────

async function handleEvolutionWebhook(request: Request, env: Env): Promise<Response> {
  let payload: EvolutionWebhookPayload;

  try {
    payload = (await request.json()) as EvolutionWebhookPayload;
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  // Only handle incoming messages (ignore echoes of our own messages)
  if (payload.event !== 'messages.upsert') {
    return Response.json({ ok: true, skipped: true });
  }

  const { data } = payload;

  // Ignore messages sent by our bot
  if (data.key.fromMe) {
    return Response.json({ ok: true, skipped: 'fromMe' });
  }

  // Extract message text
  const messageText = extractMessageText(payload);
  if (!messageText?.trim()) {
    return Response.json({ ok: true, skipped: 'non-text message' });
  }

  const clientPhone = normalizePhone(data.key.remoteJid);
  const clientName = data.pushName ?? 'Cliente';

  // Get or create the Durable Object instance for this client
  const doId = env.CLIENT_SESSION.idFromName(clientPhone);
  const doStub = env.CLIENT_SESSION.get(doId);

  // Send message to the Durable Object for processing
  const doResponse = await doStub.fetch(
    new Request('http://do/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: clientPhone, message: messageText, name: clientName }),
    })
  );

  const { responseText, audioUrl } = (await doResponse.json()) as {
    responseText: string;
    audioUrl?: string;
  };

  // Send the response back to the client via Evolution API
  const evolution = new EvolutionClient({
    apiUrl: env.EVOLUTION_API_URL,
    apiKey: env.EVOLUTION_API_KEY,
    instanceName: env.EVOLUTION_INSTANCE_NAME,
  });

  // If the agent returned an audio URL, send it as a WhatsApp Voice Note (PTT)
  if (audioUrl) {
    try {
      await evolution.sendAudio({ to: clientPhone, audioUrl });
      return Response.json({ ok: true, sent: 'audio' });
    } catch (err) {
      console.error('Failed to send audio voice note, falling back to text:', err);
    }
  }

  // Send text response if no audio was sent
  if (responseText?.trim()) {
    await evolution.sendText({ to: clientPhone, text: responseText });
  }

  return Response.json({ ok: true });
}

// ─── Test Message Handler (Dev/Demo) ─────────────────────────────────────────

async function handleTestMessage(request: Request, env: Env): Promise<Response> {
  const { phone, message, name } = (await request.json()) as {
    phone: string;
    message: string;
    name?: string;
  };

  if (!phone || !message) {
    return Response.json({ error: 'phone and message are required' }, { status: 400 });
  }

  const doId = env.CLIENT_SESSION.idFromName(phone);
  const doStub = env.CLIENT_SESSION.get(doId);

  const doResponse = await doStub.fetch(
    new Request('http://do/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, message, name: name ?? 'Teste' }),
    })
  );

  const result = await doResponse.json();
  return Response.json(result);
}

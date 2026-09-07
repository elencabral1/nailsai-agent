/**
 * ClientSessionDO - Cloudflare Durable Object
 *
 * One instance per client (keyed by WhatsApp phone number).
 * Responsibilities:
 *  - Maintains conversation history (last N messages)
 *  - Runs the agent loop (LLM → tool calls → response)
 *  - Schedules and fires reminder alarms:
 *      - 24h before appointment (confirmation + reminder)
 *      - 30 days after appointment (maintenance reminder)
 */

import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import { D1Client } from '../db/d1-client';
import { EvolutionClient } from '../services/evolution';
import { TOOL_DEFINITIONS, executeTool, ToolResult } from '../mcp/tools';

// ─── Environment Bindings ─────────────────────────────────────────────────────

export interface Env {
  DB: D1Database;
  CLIENT_SESSION: DurableObjectNamespace;
  AUDIO_BUCKET: R2Bucket;

  // Worker Secrets (set via `wrangler secret put`)
  GEMINI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  EVOLUTION_API_KEY: string;
  GOOGLE_SERVICE_ACCOUNT_JSON: string;
  GOOGLE_CALENDAR_ID: string;

  // Vars (wrangler.json [vars])
  EVOLUTION_API_URL: string;
  EVOLUTION_INSTANCE_NAME: string;
  STUDIO_PHONE: string;
  STUDIO_TIMEZONE: string;
  PUBLIC_AUDIO_BASE_URL: string;
}

// ─── Conversation Message Types ───────────────────────────────────────────────

type ConversationMessage = Anthropic.MessageParam;

interface AlarmPayload {
  type: 'reminder_24h' | 'reminder_maintenance';
  appointmentId: string;
  clientPhone: string;
  scheduledAt: string;
  serviceType: string;
}

// ─── System Prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Você é a assistente virtual do Nail Studio da Carol, especializado em atendimento de clientes via WhatsApp.

Sua personalidade:
- Simpática, carinhosa e profissional 💅
- Usa emojis com moderação para deixar as mensagens mais agradáveis
- Responde em português brasileiro de forma natural e descontraída
- É direta e objetiva, sem enrolação

Seus serviços:
- Alongamento de unhas em gel e fibra de vidro
- Manutenção de alongamentos
- Banho de gel
- Remoção

Suas ferramentas:
- query_faq: Use para responder dúvidas sobre serviços, preços, durabilidade e cuidados
- get_pre_recorded_audio: Use quando a cliente pedir uma explicação detalhada sobre procedimentos
- check_availability: Use para verificar horários disponíveis na agenda
- book_appointment: Use para realizar agendamentos após a cliente escolher um horário
- cancel_appointment: Use quando a cliente quiser cancelar ou reagendar

Regras importantes:
- Sempre use query_faq antes de responder perguntas sobre serviços ou preços
- Se a cliente pedir para "explicar" ou "contar mais" sobre um procedimento, use get_pre_recorded_audio
- Para agendamentos, sempre verifique disponibilidade primeiro com check_availability
- Se não souber algo, seja honesta e peça para a cliente aguardar ou entrar em contato por voz
- Nunca invente preços ou informações que não estejam na sua base de conhecimento
- Se a pergunta não for sobre o estúdio, redirecione gentilmente

Quando confirmar um agendamento, sempre inclua:
- Data e hora formatada (ex: "Quinta, 11 de Setembro às 14h00")
- Tipo de serviço
- Duração estimada
- Lembrete sobre o pagamento e política de cancelamento`;

// ─── Durable Object Class ─────────────────────────────────────────────────────

export class ClientSessionDO {
  private state: DurableObjectState;
  private env: Env;
  private history: ConversationMessage[] = [];
  private clientPhone: string = '';

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  // ─── HTTP Handler ──────────────────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/message') {
      return this.handleMessage(request);
    }

    if (request.method === 'POST' && url.pathname === '/schedule-reminders') {
      return this.handleScheduleReminders(request);
    }

    if (request.method === 'GET' && url.pathname === '/history') {
      return Response.json({ history: this.history });
    }

    return new Response('Not Found', { status: 404 });
  }

  // ─── Message Handler ───────────────────────────────────────────────────────

  private async handleMessage(request: Request): Promise<Response> {
    const { phone, message } = (await request.json()) as {
      phone: string;
      message: string;
    };

    this.clientPhone = phone;

    // Load persisted history from Durable Object storage
    const storedHistory = await this.state.storage.get<ConversationMessage[]>('history');
    if (storedHistory) this.history = storedHistory;

    // Log incoming message
    const db = new D1Client(this.env.DB);
    await db.logMessage({ clientPhone: phone, role: 'user', content: message });

    // Add user message to history
    this.history.push({ role: 'user', content: message });

    // Keep last 20 messages to avoid context overflow
    if (this.history.length > 20) {
      this.history = this.history.slice(-20);
    }

    // Run agent loop
    const { responseText, audioUrl } = await this.runAgentLoop(phone);

    // Log assistant response
    await db.logMessage({ clientPhone: phone, role: 'assistant', content: responseText });

    // Persist updated history
    await this.state.storage.put('history', this.history);

    return Response.json({ responseText, audioUrl });
  }

  // ─── Agent Loop ────────────────────────────────────────────────────────────

  private async runAgentLoop(
    clientPhone: string
  ): Promise<{ responseText: string; audioUrl?: string }> {
    if (this.env.GEMINI_API_KEY && this.env.GEMINI_API_KEY.trim().length > 0) {
      return this.runGeminiAgentLoop(clientPhone);
    }
    return this.runClaudeAgentLoop(clientPhone);
  }

  private async runGeminiAgentLoop(
    clientPhone: string
  ): Promise<{ responseText: string; audioUrl?: string }> {
    const ai = new GoogleGenAI({ apiKey: this.env.GEMINI_API_KEY! });
    let pendingAudioUrl: string | undefined;

    const functionDeclarations = TOOL_DEFINITIONS.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    }));

    // Convert history to contents format for Gemini
    const contents: any[] = [];
    for (const msg of this.history) {
      if (typeof msg.content === 'string') {
        contents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }],
        });
      }
    }

    let iterationCount = 0;
    const MAX_ITERATIONS = 5;

    while (iterationCount < MAX_ITERATIONS) {
      iterationCount++;

      let response: any = null;
      let lastErr: unknown = null;
      const candidateModels = ['gemini-1.5-flash', 'gemini-1.5-pro'];

      for (const modelName of candidateModels) {
        try {
          response = await ai.models.generateContent({
            model: modelName,
            contents,
            config: {
              systemInstruction: SYSTEM_PROMPT,
              tools: [{ functionDeclarations: functionDeclarations as any }],
            },
          });
          if (response) break;
        } catch (err) {
          lastErr = err;
          console.warn(`Gemini model ${modelName} unavailable, trying fallback...`);
        }
      }

      if (!response) {
        throw lastErr || new Error('All Gemini candidate models failed.');
      }

      const functionCalls = response.functionCalls;

      if (!functionCalls || functionCalls.length === 0) {
        const text = response.text ?? '';
        this.history.push({ role: 'assistant', content: text });
        return { responseText: text, audioUrl: pendingAudioUrl };
      }

      // Add model's function call turn to contents
      const candidate = response.candidates?.[0];
      if (candidate?.content) {
        contents.push(candidate.content);
      }

      const functionResponseParts: any[] = [];

      for (const call of functionCalls) {
        if (!call.name) continue;
        const toolInput = (call.args as Record<string, unknown>) || {};
        let result: ToolResult;

        try {
          result = await executeTool(call.name, toolInput, {
            DB: this.env.DB,
            GOOGLE_SERVICE_ACCOUNT_JSON: this.env.GOOGLE_SERVICE_ACCOUNT_JSON,
            GOOGLE_CALENDAR_ID: this.env.GOOGLE_CALENDAR_ID,
            PUBLIC_AUDIO_BASE_URL: this.env.PUBLIC_AUDIO_BASE_URL,
            STUDIO_TIMEZONE: this.env.STUDIO_TIMEZONE,
          });

          if (call.name === 'book_appointment' && result.success) {
            const bookData = result.data as {
              appointment_id: string;
              scheduled_at: string;
              service_type: string;
            };
            await this.scheduleReminders({
              type: 'reminder_24h',
              appointmentId: bookData.appointment_id,
              clientPhone,
              scheduledAt: bookData.scheduled_at,
              serviceType: bookData.service_type,
            });
          }

          if (result.audioUrl) {
            pendingAudioUrl = result.audioUrl;
          }
        } catch (err) {
          result = {
            success: false,
            data: null,
            error: err instanceof Error ? err.message : 'Unknown error',
          };
        }

        functionResponseParts.push({
          functionResponse: {
            name: call.name,
            response: { output: result },
          },
        });
      }

      contents.push({
        role: 'user',
        parts: functionResponseParts,
      });
    }

    return {
      responseText:
        'Desculpe, não consegui processar sua mensagem no momento. Tente novamente em instantes! 🙏',
    };
  }

  private async runClaudeAgentLoop(
    clientPhone: string
  ): Promise<{ responseText: string; audioUrl?: string }> {
    const anthropic = new Anthropic({ apiKey: this.env.ANTHROPIC_API_KEY! });

    let pendingAudioUrl: string | undefined;
    let iterationCount = 0;
    const MAX_ITERATIONS = 5;

    // We run in a loop to allow multi-step tool use (e.g. check_availability → book_appointment)
    while (iterationCount < MAX_ITERATIONS) {
      iterationCount++;

      const response = await anthropic.messages.create({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        tools: TOOL_DEFINITIONS as unknown as Anthropic.Tool[],
        messages: this.history as Anthropic.MessageParam[],
      });

      // If the model stopped because it's done, extract final text
      if (response.stop_reason === 'end_turn') {
        const textBlock = response.content.find((b) => b.type === 'text');
        const finalText = textBlock?.type === 'text' ? textBlock.text : '';

        // Add assistant message to history
        this.history.push({ role: 'assistant', content: response.content });

        return { responseText: finalText, audioUrl: pendingAudioUrl };
      }

      // Handle tool use
      if (response.stop_reason === 'tool_use') {
        // Add assistant's tool-use message to history
        this.history.push({ role: 'assistant', content: response.content });

        const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const block of toolUseBlocks) {
          if (block.type !== 'tool_use') continue;

          const toolInput = block.input as Record<string, unknown>;
          let result: ToolResult;

          try {
            result = await executeTool(block.name, toolInput, {
              DB: this.env.DB,
              GOOGLE_SERVICE_ACCOUNT_JSON: this.env.GOOGLE_SERVICE_ACCOUNT_JSON,
              GOOGLE_CALENDAR_ID: this.env.GOOGLE_CALENDAR_ID,
              PUBLIC_AUDIO_BASE_URL: this.env.PUBLIC_AUDIO_BASE_URL,
              STUDIO_TIMEZONE: this.env.STUDIO_TIMEZONE,
            });

            // After booking, schedule reminders via the DO alarm
            if (block.name === 'book_appointment' && result.success) {
              const bookData = result.data as {
                appointment_id: string;
                scheduled_at: string;
                service_type: string;
              };
              await this.scheduleReminders({
                type: 'reminder_24h',
                appointmentId: bookData.appointment_id,
                clientPhone,
                scheduledAt: bookData.scheduled_at,
                serviceType: bookData.service_type,
              });
            }

            // Capture audio URL to send back to Evolution API
            if (result.audioUrl) {
              pendingAudioUrl = result.audioUrl;
            }
          } catch (err) {
            result = {
              success: false,
              data: null,
              error: err instanceof Error ? err.message : 'Unknown error',
            };
          }

          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result),
          });
        }

        // Add tool results to history
        this.history.push({
          role: 'user',
          content: toolResults,
        });
      }
    }

    return {
      responseText:
        'Desculpe, não consegui processar sua mensagem no momento. Tente novamente em instantes! 🙏',
    };
  }

  // ─── Reminders (Durable Object Alarms) ────────────────────────────────────

  private async handleScheduleReminders(request: Request): Promise<Response> {
    const payload = (await request.json()) as AlarmPayload;
    await this.scheduleReminders(payload);
    return Response.json({ ok: true });
  }

  private async scheduleReminders(payload: AlarmPayload): Promise<void> {
    const scheduledAt = new Date(payload.scheduledAt);

    // 24h before reminder
    const reminder24h = new Date(scheduledAt.getTime() - 24 * 60 * 60 * 1000);

    // 30 days maintenance reminder
    const reminderMaintenance = new Date(
      scheduledAt.getTime() + 30 * 24 * 60 * 60 * 1000
    );

    const now = Date.now();
    const alarms: AlarmPayload[] = [];

    if (reminder24h.getTime() > now) {
      alarms.push({ ...payload, type: 'reminder_24h' });
    }
    alarms.push({ ...payload, type: 'reminder_maintenance' });

    // Store pending alarms in Durable Object storage
    const existing = (await this.state.storage.get<AlarmPayload[]>('pending_alarms')) ?? [];
    await this.state.storage.put('pending_alarms', [...existing, ...alarms]);

    // Set the next alarm to the earliest future alarm
    const nextAlarmTime = reminder24h.getTime() > now
      ? reminder24h.getTime()
      : reminderMaintenance.getTime();

    await this.state.storage.setAlarm(nextAlarmTime);

    // Also persist reminder records in D1
    const db = new D1Client(this.env.DB);
    if (reminder24h.getTime() > now) {
      await db.createReminder({
        appointmentId: payload.appointmentId,
        clientPhone: payload.clientPhone,
        reminderType: '24h_before',
        sendAt: reminder24h.toISOString(),
        messagePreview: '🔔 Lembrete: você tem horário amanhã!',
      });
    }
    await db.createReminder({
      appointmentId: payload.appointmentId,
      clientPhone: payload.clientPhone,
      reminderType: '30d_maintenance',
      sendAt: reminderMaintenance.toISOString(),
      messagePreview: '💅 Já faz 30 dias! Hora da manutenção.',
    });
  }

  // ─── Alarm Handler ─────────────────────────────────────────────────────────

  async alarm(): Promise<void> {
    const pendingAlarms =
      (await this.state.storage.get<AlarmPayload[]>('pending_alarms')) ?? [];

    const now = Date.now();
    const stillPending: AlarmPayload[] = [];
    const toFire: AlarmPayload[] = [];

    const evolution = new EvolutionClient({
      apiUrl: this.env.EVOLUTION_API_URL,
      apiKey: this.env.EVOLUTION_API_KEY,
      instanceName: this.env.EVOLUTION_INSTANCE_NAME,
    });

    const db = new D1Client(this.env.DB);

    for (const alarm of pendingAlarms) {
      const scheduledAt = new Date(alarm.scheduledAt);

      let alarmTime: number;
      if (alarm.type === 'reminder_24h') {
        alarmTime = scheduledAt.getTime() - 24 * 60 * 60 * 1000;
      } else {
        alarmTime = scheduledAt.getTime() + 30 * 24 * 60 * 60 * 1000;
      }

      if (alarmTime <= now) {
        toFire.push(alarm);
      } else {
        stillPending.push(alarm);
      }
    }

    // Fire due alarms
    for (const alarm of toFire) {
      try {
        const message = buildReminderMessage(alarm);
        await evolution.sendText({ to: alarm.clientPhone, text: message });
        await db.logMessage({
          clientPhone: alarm.clientPhone,
          role: 'assistant',
          content: message,
          toolName: `alarm:${alarm.type}`,
        });
      } catch (err) {
        console.error(`Failed to send reminder to ${alarm.clientPhone}:`, err);
      }
    }

    // Reschedule alarm for remaining pending alarms
    await this.state.storage.put('pending_alarms', stillPending);

    if (stillPending.length > 0) {
      const scheduledAt = new Date(stillPending[0].scheduledAt);
      const nextTime =
        stillPending[0].type === 'reminder_24h'
          ? scheduledAt.getTime() - 24 * 60 * 60 * 1000
          : scheduledAt.getTime() + 30 * 24 * 60 * 60 * 1000;

      await this.state.storage.setAlarm(nextTime);
    }
  }
}

// ─── Reminder Message Builder ─────────────────────────────────────────────────

function buildReminderMessage(alarm: AlarmPayload): string {
  const date = new Date(alarm.scheduledAt);
  const dateFormatted = date.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const timeFormatted = date.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });

  const serviceName: Record<string, string> = {
    alongamento: 'Alongamento de Unhas',
    manutencao: 'Manutenção',
    banho_gel: 'Banho de Gel',
    remocao: 'Remoção',
  };
  const service = serviceName[alarm.serviceType] ?? alarm.serviceType;

  if (alarm.type === 'reminder_24h') {
    return (
      `🔔 *Olá! Lembrete de agendamento* 💅\n\n` +
      `Você tem horário *amanhã*:\n\n` +
      `✨ *Serviço:* ${service}\n` +
      `📅 *Data:* ${dateFormatted}\n` +
      `⏰ *Horário:* ${timeFormatted}\n\n` +
      `Se precisar cancelar ou reagendar, por favor avise com antecedência. ` +
      `Te esperamos! 🥰`
    );
  }

  return (
    `💅 *Olá! Já faz 30 dias desde seu último procedimento!*\n\n` +
    `Está na hora de fazer a *manutenção* das suas unhas para mantê-las perfeitas e saudáveis.\n\n` +
    `Me chama aqui para agendarmos o melhor horário para você! 🌸\n\n` +
    `Saudades de você! 💕`
  );
}

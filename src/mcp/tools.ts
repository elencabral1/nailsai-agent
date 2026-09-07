/**
 * MCP Tools - Tool definitions for the NailsAI agent.
 *
 * These tools are called by the LLM (Claude) when it decides to take an action.
 * Each tool has a name, description and input schema (Zod).
 */

import { z } from 'zod';
import { queryFAQ, searchKnowledge } from '../services/rag';
import { findAudioForMessage, getAudioByTopic } from '../services/audio-store';
import { GoogleCalendarService } from '../services/google-calendar';
import { D1Client } from '../db/d1-client';

// ─── Env interface (subset of Cloudflare Env) ─────────────────────────────────

export interface ToolEnv {
  DB: D1Database;
  GOOGLE_SERVICE_ACCOUNT_JSON: string;
  GOOGLE_CALENDAR_ID: string;
  PUBLIC_AUDIO_BASE_URL: string;
  STUDIO_TIMEZONE: string;
}

// ─── Tool Input Schemas ───────────────────────────────────────────────────────

export const QueryFAQInput = z.object({
  question: z.string().describe('The client question or message to look up in the knowledge base'),
});

export const GetPreRecordedAudioInput = z.object({
  message: z.string().optional().describe('Client message to find a matching audio for'),
  topic: z.string().optional().describe('Specific topic ID to get audio for'),
});

export const CheckAvailabilityInput = z.object({
  service_type: z
    .enum(['alongamento', 'manutencao', 'banho_gel', 'remocao'])
    .describe('Type of service the client wants to book'),
  days_ahead: z.number().min(1).max(14).default(7).describe('How many days ahead to search for slots'),
});

export const BookAppointmentInput = z.object({
  client_phone: z.string().describe('WhatsApp phone number of the client (e.g. "5511999999999")'),
  client_name: z.string().describe('Full name of the client'),
  service_type: z
    .enum(['alongamento', 'manutencao', 'banho_gel', 'remocao'])
    .describe('Type of service'),
  start_time: z.string().describe('ISO8601 datetime for the appointment start (e.g. "2025-09-10T14:00:00Z")'),
  notes: z.string().optional().describe('Any additional notes from the client'),
});

export const CancelAppointmentInput = z.object({
  client_phone: z.string().describe('WhatsApp phone number of the client'),
});

// ─── Tool Definitions (for Claude's tool_choice) ──────────────────────────────

export const TOOL_DEFINITIONS = [
  {
    name: 'query_faq',
    description:
      'Search the nail studio knowledge base for information about services, prices, care tips, durability and booking policies. Use this whenever the client asks a question about the studio or nail procedures.',
    input_schema: {
      type: 'object' as const,
      properties: {
        question: {
          type: 'string',
          description: 'The client question or message to look up',
        },
      },
      required: ['question'],
    },
  },
  {
    name: 'get_pre_recorded_audio',
    description:
      'Returns a pre-recorded voice message URL from the nail designer when the client asks how a procedure works or wants a detailed explanation. Use when the client explicitly asks for an explanation, says "me explica", "como funciona", or similar.',
    input_schema: {
      type: 'object' as const,
      properties: {
        message: {
          type: 'string',
          description: 'Client message to find a matching audio for',
        },
        topic: {
          type: 'string',
          description: 'Specific audio topic (e.g. "explicacao_alongamento", "cuidados_pos_procedimento")',
        },
      },
    },
  },
  {
    name: 'check_availability',
    description:
      'Check available appointment slots in the nail studio calendar. Use when the client wants to know available times or wants to book an appointment.',
    input_schema: {
      type: 'object' as const,
      properties: {
        service_type: {
          type: 'string',
          enum: ['alongamento', 'manutencao', 'banho_gel', 'remocao'],
          description: 'Type of service',
        },
        days_ahead: {
          type: 'number',
          description: 'How many days ahead to search (1-14)',
          default: 7,
        },
      },
      required: ['service_type'],
    },
  },
  {
    name: 'book_appointment',
    description:
      'Book an appointment for a client. Creates the event in Google Calendar and saves the link between the client phone and the event in the database. Always call check_availability first to confirm the slot is free.',
    input_schema: {
      type: 'object' as const,
      properties: {
        client_phone: { type: 'string', description: 'WhatsApp phone number' },
        client_name: { type: 'string', description: 'Client full name' },
        service_type: {
          type: 'string',
          enum: ['alongamento', 'manutencao', 'banho_gel', 'remocao'],
        },
        start_time: { type: 'string', description: 'ISO8601 start datetime' },
        notes: { type: 'string', description: 'Optional notes' },
      },
      required: ['client_phone', 'client_name', 'service_type', 'start_time'],
    },
  },
  {
    name: 'cancel_appointment',
    description:
      "Cancel a client's upcoming appointment. Use when the client explicitly asks to cancel or reschedule.",
    input_schema: {
      type: 'object' as const,
      properties: {
        client_phone: { type: 'string', description: 'WhatsApp phone number' },
      },
      required: ['client_phone'],
    },
  },
] as const;

// ─── Tool Executor ─────────────────────────────────────────────────────────────

export interface ToolResult {
  success: boolean;
  data: unknown;
  audioUrl?: string; // set when tool returns an audio to be sent
  error?: string;
}

const SERVICE_DURATION: Record<string, number> = {
  alongamento: 150,
  manutencao: 100,
  banho_gel: 75,
  remocao: 40,
};

export async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  env: ToolEnv
): Promise<ToolResult> {
  const db = new D1Client(env.DB);

  switch (toolName) {
    // ── FAQ / Knowledge Base ────────────────────────────────────────────────
    case 'query_faq': {
      const { question } = QueryFAQInput.parse(input);
      const results = searchKnowledge(question, 2);

      if (results.length === 0) {
        return {
          success: true,
          data: {
            found: false,
            message: 'No information found in the knowledge base for this question.',
          },
        };
      }

      return {
        success: true,
        data: {
          found: true,
          answers: results.map((r) => ({
            category: r.entry.category,
            question: r.entry.question,
            answer: r.entry.answer,
            score: r.score,
          })),
        },
      };
    }

    // ── Pre-recorded Audio ──────────────────────────────────────────────────
    case 'get_pre_recorded_audio': {
      const { message, topic } = GetPreRecordedAudioInput.parse(input);
      const baseUrl = env.PUBLIC_AUDIO_BASE_URL;

      const result = topic
        ? getAudioByTopic(topic, baseUrl)
        : message
          ? findAudioForMessage(message, baseUrl)
          : null;

      if (!result) {
        return {
          success: false,
          data: null,
          error: 'No matching audio found for this topic or message.',
        };
      }

      return {
        success: true,
        data: {
          topic: result.entry.topic,
          description: result.entry.description,
          audioUrl: result.publicUrl,
        },
        audioUrl: result.publicUrl,
      };
    }

    // ── Check Calendar Availability ─────────────────────────────────────────
    case 'check_availability': {
      const { service_type, days_ahead } = CheckAvailabilityInput.parse(input);
      const calendar = new GoogleCalendarService(
        env.GOOGLE_SERVICE_ACCOUNT_JSON,
        env.STUDIO_TIMEZONE
      );

      const duration = SERVICE_DURATION[service_type] ?? 120;
      const slots = await calendar.getAvailableSlots(
        env.GOOGLE_CALENDAR_ID,
        duration,
        days_ahead ?? 7
      );

      return {
        success: true,
        data: {
          service_type,
          duration_minutes: duration,
          available_slots: slots,
          total_found: slots.length,
        },
      };
    }

    // ── Book Appointment ────────────────────────────────────────────────────
    case 'book_appointment': {
      const parsed = BookAppointmentInput.parse(input);
      const calendar = new GoogleCalendarService(
        env.GOOGLE_SERVICE_ACCOUNT_JSON,
        env.STUDIO_TIMEZONE
      );

      const duration = SERVICE_DURATION[parsed.service_type] ?? 120;

      // 1. Create Google Calendar event
      const googleEventId = await calendar.createEvent({
        calendarId: env.GOOGLE_CALENDAR_ID,
        clientPhone: parsed.client_phone,
        clientName: parsed.client_name,
        serviceType: parsed.service_type,
        startTime: parsed.start_time,
        durationMinutes: duration,
        notes: parsed.notes,
      });

      // 2. Ensure client exists in D1
      await db.upsertClient(parsed.client_phone, parsed.client_name);

      // 3. Save appointment record linking phone ↔ google event
      const appointment = await db.createAppointment({
        googleEventId,
        clientPhone: parsed.client_phone,
        serviceType: parsed.service_type,
        scheduledAt: parsed.start_time,
        durationMinutes: duration,
        notes: parsed.notes,
      });

      return {
        success: true,
        data: {
          appointment_id: appointment.id,
          google_event_id: googleEventId,
          client_phone: parsed.client_phone,
          client_name: parsed.client_name,
          service_type: parsed.service_type,
          scheduled_at: parsed.start_time,
          duration_minutes: duration,
          message: 'Appointment successfully booked! Reminders will be scheduled automatically.',
        },
      };
    }

    // ── Cancel Appointment ──────────────────────────────────────────────────
    case 'cancel_appointment': {
      const { client_phone } = CancelAppointmentInput.parse(input);

      const appointment = await db.getUpcomingAppointmentByPhone(client_phone);
      if (!appointment) {
        return {
          success: false,
          data: null,
          error: 'No upcoming appointment found for this client.',
        };
      }

      const calendar = new GoogleCalendarService(
        env.GOOGLE_SERVICE_ACCOUNT_JSON,
        env.STUDIO_TIMEZONE
      );

      await calendar.deleteEvent(env.GOOGLE_CALENDAR_ID, appointment.google_event_id);
      await db.cancelAppointment(appointment.google_event_id);

      return {
        success: true,
        data: {
          cancelled_appointment_id: appointment.id,
          was_scheduled_at: appointment.scheduled_at,
          message: 'Appointment successfully cancelled.',
        },
      };
    }

    default:
      return {
        success: false,
        data: null,
        error: `Unknown tool: ${toolName}`,
      };
  }
}

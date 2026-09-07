/**
 * D1 Client - Repository layer for NailsAI database operations
 */

export interface Client {
  phone: string;
  name: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface Appointment {
  id: string;
  google_event_id: string;
  client_phone: string;
  service_type: string;
  scheduled_at: string;
  duration_minutes: number;
  status: string;
  notes?: string;
  created_at: string;
}

export interface Reminder {
  id: string;
  appointment_id: string;
  client_phone: string;
  reminder_type: string;
  send_at: string;
  sent_at?: string;
  status: string;
  message_preview?: string;
  created_at: string;
}

export interface ConversationLog {
  id: string;
  client_phone: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_name?: string;
  created_at: string;
}

export class D1Client {
  constructor(private db: D1Database) {}

  // ─── Clients ────────────────────────────────────────────────────────────────

  async upsertClient(phone: string, name?: string): Promise<Client> {
    await this.db
      .prepare(
        `INSERT INTO clients (phone, name, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(phone) DO UPDATE SET
           name = COALESCE(excluded.name, clients.name),
           updated_at = datetime('now')`
      )
      .bind(phone, name ?? 'Cliente')
      .run();

    return this.db
      .prepare('SELECT * FROM clients WHERE phone = ?')
      .bind(phone)
      .first<Client>() as Promise<Client>;
  }

  async getClient(phone: string): Promise<Client | null> {
    return this.db
      .prepare('SELECT * FROM clients WHERE phone = ?')
      .bind(phone)
      .first<Client>();
  }

  async updateClientNotes(phone: string, notes: string): Promise<void> {
    await this.db
      .prepare(
        `UPDATE clients SET notes = ?, updated_at = datetime('now') WHERE phone = ?`
      )
      .bind(notes, phone)
      .run();
  }

  // ─── Appointments ────────────────────────────────────────────────────────────

  async createAppointment(params: {
    googleEventId: string;
    clientPhone: string;
    serviceType: string;
    scheduledAt: string;
    durationMinutes?: number;
    notes?: string;
  }): Promise<Appointment> {
    const id = crypto.randomUUID().slice(0, 16);
    await this.db
      .prepare(
        `INSERT INTO appointments
           (id, google_event_id, client_phone, service_type, scheduled_at, duration_minutes, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        params.googleEventId,
        params.clientPhone,
        params.serviceType,
        params.scheduledAt,
        params.durationMinutes ?? 120,
        params.notes ?? null
      )
      .run();

    return this.db
      .prepare('SELECT * FROM appointments WHERE id = ?')
      .bind(id)
      .first<Appointment>() as Promise<Appointment>;
  }

  async getUpcomingAppointmentByPhone(phone: string): Promise<Appointment | null> {
    return this.db
      .prepare(
        `SELECT * FROM appointments
         WHERE client_phone = ? AND status = 'confirmed' AND scheduled_at > datetime('now')
         ORDER BY scheduled_at ASC
         LIMIT 1`
      )
      .bind(phone)
      .first<Appointment>();
  }

  async cancelAppointment(googleEventId: string): Promise<void> {
    await this.db
      .prepare(`UPDATE appointments SET status = 'cancelled' WHERE google_event_id = ?`)
      .bind(googleEventId)
      .run();
  }

  async completeAppointment(googleEventId: string): Promise<void> {
    await this.db
      .prepare(`UPDATE appointments SET status = 'completed' WHERE google_event_id = ?`)
      .bind(googleEventId)
      .run();
  }

  // ─── Reminders ───────────────────────────────────────────────────────────────

  async createReminder(params: {
    appointmentId: string;
    clientPhone: string;
    reminderType: string;
    sendAt: string;
    messagePreview?: string;
  }): Promise<Reminder> {
    const id = crypto.randomUUID().slice(0, 16);
    await this.db
      .prepare(
        `INSERT INTO reminders
           (id, appointment_id, client_phone, reminder_type, send_at, message_preview)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        params.appointmentId,
        params.clientPhone,
        params.reminderType,
        params.sendAt,
        params.messagePreview ?? null
      )
      .run();

    return this.db
      .prepare('SELECT * FROM reminders WHERE id = ?')
      .bind(id)
      .first<Reminder>() as Promise<Reminder>;
  }

  async markReminderSent(id: string): Promise<void> {
    await this.db
      .prepare(
        `UPDATE reminders SET status = 'sent', sent_at = datetime('now') WHERE id = ?`
      )
      .bind(id)
      .run();
  }

  async markReminderFailed(id: string): Promise<void> {
    await this.db
      .prepare(`UPDATE reminders SET status = 'failed' WHERE id = ?`)
      .bind(id)
      .run();
  }

  // ─── Conversation Logs ───────────────────────────────────────────────────────

  async logMessage(params: {
    clientPhone: string;
    role: 'user' | 'assistant' | 'tool';
    content: string;
    toolName?: string;
  }): Promise<void> {
    const id = crypto.randomUUID().slice(0, 16);
    await this.db
      .prepare(
        `INSERT INTO conversation_logs (id, client_phone, role, content, tool_name)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        params.clientPhone,
        params.role,
        params.content,
        params.toolName ?? null
      )
      .run();
  }

  async getRecentLogs(phone: string, limit = 20): Promise<ConversationLog[]> {
    const result = await this.db
      .prepare(
        `SELECT * FROM conversation_logs
         WHERE client_phone = ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .bind(phone, limit)
      .all<ConversationLog>();
    return result.results.reverse();
  }
}

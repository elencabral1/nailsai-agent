/**
 * Google Calendar Service
 * Handles reading available slots and creating/cancelling appointments.
 *
 * Uses a Google Service Account for authentication (no user OAuth flow needed).
 * Set GOOGLE_SERVICE_ACCOUNT_JSON as a Worker Secret (JSON stringified).
 */

export interface TimeSlot {
  start: string; // ISO8601 UTC
  end: string;   // ISO8601 UTC
  startFormatted: string; // "Segunda, 10 de Setembro às 14h00"
}

export interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  description?: string;
}

export interface CreateEventParams {
  calendarId: string;
  clientPhone: string;
  clientName: string;
  serviceType: string;
  startTime: string;      // ISO8601
  durationMinutes: number;
  notes?: string;
}

export class GoogleCalendarService {
  constructor(
    private serviceAccountJson: string,
    private timezone: string = 'America/Sao_Paulo'
  ) {}

  /**
   * Returns the Google OAuth2 access token using the Service Account.
   * Uses JWT to obtain a short-lived token.
   */
  private async getAccessToken(): Promise<string> {
    const sa = JSON.parse(this.serviceAccountJson);

    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = {
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/calendar',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    };

    const encode = (obj: object) =>
      btoa(JSON.stringify(obj))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

    const headerB64 = encode(header);
    const payloadB64 = encode(payload);
    const signingInput = `${headerB64}.${payloadB64}`;

    // Import private key for signing
    const privateKeyPem = sa.private_key
      .replace(/-----BEGIN PRIVATE KEY-----/, '')
      .replace(/-----END PRIVATE KEY-----/, '')
      .replace(/\n/g, '');

    const keyBuffer = Uint8Array.from(atob(privateKeyPem), (c) => c.charCodeAt(0));

    const cryptoKey = await crypto.subtle.importKey(
      'pkcs8',
      keyBuffer,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const sigBuffer = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      new TextEncoder().encode(signingInput)
    );

    const signature = btoa(String.fromCharCode(...new Uint8Array(sigBuffer)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const jwt = `${signingInput}.${signature}`;

    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }),
    });

    const tokenData = (await tokenResp.json()) as { access_token: string };
    return tokenData.access_token;
  }

  /**
   * Lists available appointment slots in the next N days.
   * Returns gaps in the calendar between 9h-19h on weekdays.
   */
  async getAvailableSlots(
    calendarId: string,
    durationMinutes: number,
    daysAhead: number = 7
  ): Promise<TimeSlot[]> {
    const token = await this.getAccessToken();

    const now = new Date();
    const until = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

    // Get busy times using freebusy API
    const freeBusyResp = await fetch(
      'https://www.googleapis.com/calendar/v3/freeBusy',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          timeMin: now.toISOString(),
          timeMax: until.toISOString(),
          timeZone: this.timezone,
          items: [{ id: calendarId }],
        }),
      }
    );

    const freeBusy = (await freeBusyResp.json()) as {
      calendars: { [id: string]: { busy: Array<{ start: string; end: string }> } };
    };

    const busySlots = freeBusy.calendars[calendarId]?.busy ?? [];
    const slots: TimeSlot[] = [];

    // Generate candidate slots: 9h-19h, Mon-Sat, every hour
    const cursor = new Date(now);
    cursor.setMinutes(0, 0, 0);
    cursor.setHours(cursor.getHours() + 1); // start from next full hour

    while (cursor < until && slots.length < 10) {
      const day = cursor.getDay(); // 0=Sun, 6=Sat
      const hour = cursor.getHours();

      // Mon-Sat, 9h-18h (leave room for duration)
      if (day >= 1 && day <= 6 && hour >= 9 && hour <= 18) {
        const slotEnd = new Date(cursor.getTime() + durationMinutes * 60 * 1000);
        const isBusy = busySlots.some((busy) => {
          const busyStart = new Date(busy.start);
          const busyEnd = new Date(busy.end);
          return cursor < busyEnd && slotEnd > busyStart;
        });

        if (!isBusy) {
          slots.push({
            start: cursor.toISOString(),
            end: slotEnd.toISOString(),
            startFormatted: formatDateBR(cursor, this.timezone),
          });
        }
      }

      cursor.setHours(cursor.getHours() + 1);
    }

    return slots;
  }

  /**
   * Creates a calendar event and returns its Google Event ID.
   */
  async createEvent(params: CreateEventParams): Promise<string> {
    const token = await this.getAccessToken();

    const endTime = new Date(
      new Date(params.startTime).getTime() + params.durationMinutes * 60 * 1000
    ).toISOString();

    const serviceLabel = params.serviceType
      .replace('_', ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());

    const event = {
      summary: `💅 ${serviceLabel} - ${params.clientName}`,
      description:
        `Cliente: ${params.clientName}\nWhatsApp: ${params.clientPhone}\n` +
        (params.notes ? `\nObservações: ${params.notes}` : ''),
      start: {
        dateTime: params.startTime,
        timeZone: this.timezone,
      },
      end: {
        dateTime: endTime,
        timeZone: this.timezone,
      },
      extendedProperties: {
        private: {
          clientPhone: params.clientPhone,
          serviceType: params.serviceType,
          source: 'nailsai-agent',
        },
      },
    };

    const resp = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(params.calendarId)}/events`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
      }
    );

    const created = (await resp.json()) as { id: string };
    if (!created.id) throw new Error('Failed to create Google Calendar event');

    return created.id;
  }

  /**
   * Cancels a Google Calendar event by ID.
   */
  async deleteEvent(calendarId: string, eventId: string): Promise<void> {
    const token = await this.getAccessToken();

    await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }
    );
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DAYS_PT = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const MONTHS_PT = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

function formatDateBR(date: Date, _timezone: string): string {
  const day = DAYS_PT[date.getDay()];
  const month = MONTHS_PT[date.getMonth()];
  const hour = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${day}, ${date.getDate()} de ${month} às ${hour}h${min}`;
}

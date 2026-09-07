/**
 * Evolution API Client
 * Handles sending text messages and audio files via WhatsApp.
 *
 * Docs: https://doc.evolution-api.com/
 */

export interface EvolutionConfig {
  apiUrl: string;
  apiKey: string;
  instanceName: string;
}

export interface SendTextParams {
  to: string;
  text: string;
  delay?: number; // ms delay before sending (simulates typing)
}

export interface SendAudioParams {
  to: string;
  audioUrl: string;
}

export interface SendMediaParams {
  to: string;
  mediaUrl: string;
  caption?: string;
  mediaType: 'image' | 'document' | 'video';
}

export class EvolutionClient {
  private headers: Record<string, string>;
  private baseUrl: string;

  constructor(private config: EvolutionConfig) {
    this.baseUrl = `${config.apiUrl}/message`;
    this.headers = {
      'Content-Type': 'application/json',
      apikey: config.apiKey,
    };
  }

  /**
   * Sends a text message to a WhatsApp number.
   * The 'to' field must be in international format: "5511999999999"
   */
  async sendText(params: SendTextParams): Promise<void> {
    const url = `${this.baseUrl}/sendText/${this.config.instanceName}`;

    const body = {
      number: params.to,
      text: params.text,
      delay: params.delay ?? 500,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Evolution API sendText failed: ${response.status} - ${error}`);
    }
  }

  /**
   * Sends a pre-recorded audio file (PTT - Push To Talk) via WhatsApp.
   * The audio must be publicly accessible via URL.
   */
  async sendAudio(params: SendAudioParams): Promise<void> {
    const url = `${this.baseUrl}/sendWhatsAppAudio/${this.config.instanceName}`;

    const body = {
      number: params.to,
      audio: params.audioUrl,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Evolution API sendAudio failed: ${response.status} - ${error}`);
    }
  }

  /**
   * Sends media (image, document, video) with optional caption.
   */
  async sendMedia(params: SendMediaParams): Promise<void> {
    const url = `${this.baseUrl}/sendMedia/${this.config.instanceName}`;

    const body = {
      number: params.to,
      mediatype: params.mediaType,
      media: params.mediaUrl,
      caption: params.caption,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Evolution API sendMedia failed: ${response.status} - ${error}`);
    }
  }
}

// ─── Webhook Payload Types ─────────────────────────────────────────────────────

export interface EvolutionWebhookPayload {
  event: string;
  instance: string;
  data: {
    key: {
      remoteJid: string;
      fromMe: boolean;
      id: string;
    };
    pushName?: string;
    message?: {
      conversation?: string;
      extendedTextMessage?: { text: string };
      audioMessage?: { url: string; mimetype: string };
      imageMessage?: { caption?: string; url: string };
    };
    messageType: string;
    messageTimestamp: number;
  };
}

/**
 * Extracts the plain text content from an Evolution webhook payload.
 * Returns null for non-text messages (audio, image, etc).
 */
export function extractMessageText(payload: EvolutionWebhookPayload): string | null {
  const msg = payload.data?.message;
  if (!msg) return null;
  return (
    msg.conversation ??
    msg.extendedTextMessage?.text ??
    null
  );
}

/**
 * Normalizes a WhatsApp JID to a plain phone number.
 * "5511999999999@s.whatsapp.net" → "5511999999999"
 */
export function normalizePhone(remoteJid: string): string {
  return remoteJid.replace(/@.+$/, '').replace(/[^0-9]/g, '');
}

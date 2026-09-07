/**
 * Audio Store - Catalog of pre-recorded voice messages from the nail designer.
 * Audio files are stored in Cloudflare R2 and served via public URL.
 *
 * In development, placeholder URLs are used.
 * In production, upload MP3 files to R2 bucket "nails-audios" and update PUBLIC_AUDIO_BASE_URL.
 */

export interface AudioEntry {
  id: string;
  topic: string;
  description: string;
  keywords: string[];
  filename: string;
}

// ─── Audio Catalog ─────────────────────────────────────────────────────────────

export const AUDIO_CATALOG: AudioEntry[] = [
  {
    id: 'audio-explicacao-alongamento',
    topic: 'explicacao_alongamento',
    description: 'Explicação completa sobre como funciona o procedimento de alongamento de unhas',
    keywords: [
      'como funciona', 'como é feito', 'procedimento', 'alongamento funciona',
      'como funciona o alongamento', 'me explica', 'explica', 'quero entender',
    ],
    filename: 'explicacao-alongamento.mp3',
  },
  {
    id: 'audio-cuidados-pos',
    topic: 'cuidados_pos_procedimento',
    description: 'Áudio com todos os cuidados necessários após o procedimento de alongamento',
    keywords: [
      'cuidados', 'pós procedimento', 'como cuidar', 'o que fazer depois',
      'dicas', 'manter', 'conservar', 'durar mais',
    ],
    filename: 'cuidados-pos-procedimento.mp3',
  },
  {
    id: 'audio-manutencao',
    topic: 'sobre_manutencao',
    description: 'Áudio explicando o que é a manutenção e por que ela é importante',
    keywords: [
      'manutenção', 'manutencao', 'o que é manutenção', 'quando fazer manutenção',
      'preciso de manutenção', 'retoque',
    ],
    filename: 'sobre-manutencao.mp3',
  },
  {
    id: 'audio-antes-procedimento',
    topic: 'preparacao_antes',
    description: 'Como se preparar antes de vir ao estúdio para o procedimento',
    keywords: [
      'antes', 'preparar', 'o que fazer antes', 'preparo', 'chegar',
      'vou agora', 'estou indo',
    ],
    filename: 'preparo-antes-procedimento.mp3',
  },
  {
    id: 'audio-boas-vindas',
    topic: 'boas_vindas',
    description: 'Mensagem de boas-vindas do estúdio',
    keywords: [
      'oi', 'olá', 'ola', 'bom dia', 'boa tarde', 'boa noite',
      'quero saber mais', 'primeira vez',
    ],
    filename: 'boas-vindas.mp3',
  },
];

// ─── Search ──────────────────────────────────────────────────────────────────

export interface AudioResult {
  entry: AudioEntry;
  publicUrl: string;
}

/**
 * Finds the best matching audio for a given message.
 * Returns null if no audio matches well enough.
 */
export function findAudioForMessage(
  message: string,
  baseUrl: string
): AudioResult | null {
  const normalized = message
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  let bestMatch: { entry: AudioEntry; score: number } | null = null;

  for (const entry of AUDIO_CATALOG) {
    let score = 0;
    for (const keyword of entry.keywords) {
      const normalizedKeyword = keyword
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      if (normalized.includes(normalizedKeyword)) {
        score += normalizedKeyword.split(' ').length * 2;
      }
    }
    if (score > 0 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { entry, score };
    }
  }

  if (!bestMatch) return null;

  return {
    entry: bestMatch.entry,
    publicUrl: `${baseUrl}/${bestMatch.entry.filename}`,
  };
}

/**
 * Gets an audio entry by its topic ID.
 */
export function getAudioByTopic(topic: string, baseUrl: string): AudioResult | null {
  const entry = AUDIO_CATALOG.find((a) => a.topic === topic);
  if (!entry) return null;
  return {
    entry,
    publicUrl: `${baseUrl}/${entry.filename}`,
  };
}

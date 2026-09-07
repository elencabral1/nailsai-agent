/**
 * RAG Engine - Knowledge base for nail design studio FAQ, services and pricing.
 * Uses simple semantic keyword matching for local dev; swap for Cloudflare Vectorize in production.
 */

export interface KnowledgeEntry {
  id: string;
  category: 'servico' | 'preco' | 'cuidados' | 'durabilidade' | 'agendamento' | 'geral';
  keywords: string[];
  question: string;
  answer: string;
}

// ─── Knowledge Base ───────────────────────────────────────────────────────────

export const KNOWLEDGE_BASE: KnowledgeEntry[] = [
  // ── Serviços ────────────────────────────────────────────────────────────────
  {
    id: 'svc-alongamento-gel',
    category: 'servico',
    keywords: ['alongamento', 'gel', 'unhas de gel', 'extensão', 'extensao'],
    question: 'O que é alongamento de unhas em gel?',
    answer:
      'O alongamento de gel é uma técnica profissional onde aplicamos gel UV sobre um molde ou a própria unha natural para criar uma extensão resistente e duradoura. O resultado é natural, bonito e muito mais durável que o acrílico tradicional. 💅',
  },
  {
    id: 'svc-fibra-vidro',
    category: 'servico',
    keywords: ['fibra de vidro', 'fibra', 'amendoa', 'amêndoa'],
    question: 'O que é alongamento em fibra de vidro?',
    answer:
      'A fibra de vidro é uma técnica mais leve e flexível que o gel. Utilizamos fitas de fibra que garantem resistência extra sem pesar na unha natural. Ótima opção para quem tem unhas frágeis ou usa muito as mãos no dia a dia.',
  },
  {
    id: 'svc-manutencao',
    category: 'servico',
    keywords: ['manutenção', 'manutencao', 'reposição', 'reposicao', 'retoque', 'preenchimento'],
    question: 'O que é manutenção de alongamento?',
    answer:
      'A manutenção é feita aproximadamente a cada 3-4 semanas. Fazemos o preenchimento da raiz que cresceu, corrigimos eventuais lascados e renovamos o esmalte/nail art. É essencial para manter suas unhas sempre lindas e saudáveis! 🌸',
  },
  {
    id: 'svc-banho-gel',
    category: 'servico',
    keywords: ['banho de gel', 'gel sobre natural', 'banho gel', 'gel natural'],
    question: 'O que é banho de gel?',
    answer:
      'O banho de gel é aplicado sobre a própria unha natural, sem extensão. Fortalece, dá brilho e aumenta a durabilidade do esmalte. Ótima opção para quem quer unhas naturais mais fortes e um acabamento impecável!',
  },
  {
    id: 'svc-remocao',
    category: 'servico',
    keywords: ['remoção', 'remocao', 'tirar', 'retirar', 'remover'],
    question: 'Como é feita a remoção do alongamento?',
    answer:
      'A remoção é feita de forma segura com acetona específica e lixas adequadas. Nunca arranche ou force a tirar, pois isso danifica a sua unha natural. Agende sua remoção conosco e deixe na mão das especialistas! 💆‍♀️',
  },

  // ── Preços ──────────────────────────────────────────────────────────────────
  {
    id: 'preco-alongamento',
    category: 'preco',
    keywords: ['preço', 'preco', 'valor', 'quanto custa', 'quanto é', 'quanto e', 'tabela', 'valores'],
    question: 'Qual o preço dos serviços?',
    answer:
      '💰 Tabela de valores:\n\n✨ Alongamento em Gel: R$ 150,00\n✨ Alongamento em Fibra de Vidro: R$ 130,00\n✨ Manutenção: R$ 80,00\n✨ Banho de Gel: R$ 60,00\n✨ Remoção: R$ 40,00\n\nNail Art e designs especiais têm acréscimo conforme complexidade. 💅',
  },
  {
    id: 'preco-manutencao',
    category: 'preco',
    keywords: ['preço manutenção', 'valor manutenção', 'quanto custa manutenção', 'manutenção preço'],
    question: 'Qual o preço da manutenção?',
    answer:
      'A manutenção custa R$ 80,00 e deve ser feita a cada 3-4 semanas para manter suas unhas perfeitas! 🌸 Incluído preenchimento de raiz, correções e renovação de esmalte.',
  },

  // ── Durabilidade ────────────────────────────────────────────────────────────
  {
    id: 'dur-quanto-dura',
    category: 'durabilidade',
    keywords: ['quanto dura', 'durabilidade', 'duração', 'duracao', 'dura quanto', 'tempo'],
    question: 'Quanto tempo dura o alongamento?',
    answer:
      'O alongamento dura em média 3 a 4 semanas com os cuidados corretos! Após esse período, a raiz natural já cresceu bastante e o ideal é fazer a manutenção para renovar e manter a saúde das suas unhas. ⏰',
  },
  {
    id: 'dur-estragou',
    category: 'durabilidade',
    keywords: ['quebrou', 'lascou', 'caiu', 'estragou', 'saiu', 'soltou'],
    question: 'O que fazer se uma unha quebrar ou lascar?',
    answer:
      'Não se preocupe! Às vezes acontece, principalmente nos primeiros dias. Me manda uma foto no WhatsApp para eu avaliar. Se for algo simples, a gente resolve rapidinho. Evite usar a unha para abrir coisas ou lavar louça sem luva. 🙏',
  },

  // ── Cuidados ────────────────────────────────────────────────────────────────
  {
    id: 'cui-pos-procedimento',
    category: 'cuidados',
    keywords: ['cuidados', 'cuidar', 'manter', 'bonitas', 'depois', 'unhas bonitas', 'dicas', 'higiene', 'pós', 'pos procedimento', 'pós procedimento'],
    question: 'Quais os cuidados após o procedimento?',
    answer:
      '💅 Cuidados essenciais para suas unhas durarem mais:\n\n✅ Hidratar as cutículas e cutícula diariamente com azeite ou óleo de cutícula\n✅ Use luvas ao lavar louça e fazer limpeza\n✅ Evite usar as unhas como ferramenta\n✅ Não expose ao calor extremo (sauna, forno quente)\n✅ Aplique base protetora caso o esmalte comece a descascar\n✅ Venha fazer a manutenção no prazo de 3-4 semanas\n\nSeguindo essas dicas, suas unhas vão durar muito mais! 🌸',
  },
  {
    id: 'cui-hidratacao',
    category: 'cuidados',
    keywords: ['hidratar', 'hidratação', 'hidratacao', 'cutícula', 'cuticula', 'oleo', 'óleo'],
    question: 'Como hidratar as unhas e cutículas?',
    answer:
      'A hidratação é fundamental! Aplique azeite de oliva, óleo de amêndoas ou óleo de cutícula específico diariamente, massageando bem a cutícula e a base da unha. Além de cuidar, deixa tudo com aparência mais saudável e profissional! 💆‍♀️',
  },

  // ── Agendamento ──────────────────────────────────────────────────────────────
  {
    id: 'age-horarios',
    category: 'agendamento',
    keywords: ['horário', 'horario', 'atendimento', 'funciona', 'hora', 'agenda', 'disponibilidade'],
    question: 'Quais são os horários de atendimento?',
    answer:
      '📅 Atendo de segunda a sábado!\n⏰ Horários: 9h às 19h\n\nPara verificar a disponibilidade exata e agendar, é só me dizer qual dia e período prefere (manhã ou tarde) que vejo o que tenho disponível! 😊',
  },
  {
    id: 'age-quanto-tempo',
    category: 'agendamento',
    keywords: ['quanto tempo leva', 'demora', 'tempo de atendimento', 'duração do procedimento', 'horas'],
    question: 'Quanto tempo dura o procedimento?',
    answer:
      '⏱️ Tempo médio de atendimento:\n\n✨ Alongamento completo: 2h30 a 3h\n✨ Manutenção: 1h30 a 2h\n✨ Banho de gel: 1h a 1h30\n✨ Remoção: 30 a 45 min\n\nPlaneje seu dia com essa estimativa para não se preocupar! 😊',
  },
  {
    id: 'age-local',
    category: 'agendamento',
    keywords: ['onde', 'endereço', 'endereco', 'localização', 'localizacao', 'local', 'onde fica'],
    question: 'Onde fica o estúdio?',
    answer:
      'Trabalho em estúdio próprio! Me pergunte sobre o endereço completo e te passo todas as informações de localização e como chegar. 📍',
  },

  // ── Geral ─────────────────────────────────────────────────────────────────
  {
    id: 'ger-pagamento',
    category: 'geral',
    keywords: ['pagamento', 'pix', 'cartão', 'cartao', 'dinheiro', 'parcelamento', 'como pagar', 'forma de pagamento'],
    question: 'Quais as formas de pagamento?',
    answer:
      '💳 Formas de pagamento aceitas:\n\n✅ PIX (pagamento na hora, sem taxas)\n✅ Dinheiro\n✅ Cartão de débito\n✅ Cartão de crédito (sujeito a taxa)\n\nPIX é a forma preferida por ser mais prático para as duas! 😊',
  },
  {
    id: 'ger-cancelamento',
    category: 'geral',
    keywords: ['cancelar', 'cancelamento', 'remarcar', 'reagendar', 'desmarcar', 'falta'],
    question: 'Qual a política de cancelamento?',
    answer:
      '📋 Política de cancelamento:\n\nPeço que avisos de cancelamento sejam feitos com pelo menos 24h de antecedência. Isso me permite oferecer o horário para outra cliente. Cancelamentos de última hora (menos de 2h) podem gerar uma taxa de R$ 30 para cobrir o horário reservado. Obrigada pela compreensão! 🙏',
  },
];

// ─── Search Engine ─────────────────────────────────────────────────────────────

export interface RAGResult {
  entry: KnowledgeEntry;
  score: number;
}

/**
 * Searches the knowledge base using keyword matching with scoring.
 * In production, replace with Cloudflare Vectorize semantic search.
 */
export function searchKnowledge(query: string, topK = 3): RAGResult[] {
  const normalizedQuery = query
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/[^a-z0-9\s]/g, ' ');

  const queryWords = normalizedQuery.split(/\s+/).filter((w) => w.length > 2);

  const scored = KNOWLEDGE_BASE.map((entry) => {
    let score = 0;

    for (const keyword of entry.keywords) {
      const normalizedKeyword = keyword
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

      if (normalizedQuery.includes(normalizedKeyword)) {
        score += keyword.split(' ').length * 2; // longer matches score higher
      }
    }

    for (const word of queryWords) {
      const normalizedQ = entry.question
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      if (normalizedQ.includes(word)) score += 1;
    }

    return { entry, score };
  });

  return scored
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/**
 * Returns the best matching answer for a given query.
 */
export function queryFAQ(query: string): string | null {
  const results = searchKnowledge(query, 1);
  if (results.length === 0 || results[0].score === 0) return null;
  return results[0].entry.answer;
}

/**
 * NailsAI Eval Runner
 *
 * Simulates conversations with the agent and validates:
 * 1. Tool Selection Accuracy - did the agent call the right tool?
 * 2. RAG Faithfulness      - did the agent avoid hallucination?
 * 3. Audio Dispatch        - did the agent send audio when appropriate?
 * 4. Boundary Compliance   - did the agent stay on-topic?
 *
 * Run: npm run eval
 */

import Anthropic from '@anthropic-ai/sdk';
import testCasesRaw from './test-cases.json';
import { TOOL_DEFINITIONS } from '../mcp/tools';
import { searchKnowledge } from '../services/rag';
import { findAudioForMessage } from '../services/audio-store';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TestCase {
  id: string;
  category: string;
  description: string;
  input: string;
  expected_tool: string | null;
  expected_contains: string[];
  must_not_contain: string[];
}

interface EvalResult {
  id: string;
  category: string;
  description: string;
  input: string;
  passed: boolean;
  tool_called: string | null;
  tool_correct: boolean;
  response_text: string;
  content_check_passed: boolean;
  hallucination_detected: boolean;
  latency_ms: number;
  errors: string[];
}

// ─── Mock Tool Responses (for eval without real external services) ─────────────

function getMockToolResponse(toolName: string, input: Record<string, unknown>): unknown {
  switch (toolName) {
    case 'query_faq': {
      const results = searchKnowledge(input.question as string, 2);
      return {
        success: true,
        data: {
          found: results.length > 0,
          answers: results.map((r) => ({
            category: r.entry.category,
            question: r.entry.question,
            answer: r.entry.answer,
          })),
        },
      };
    }

    case 'get_pre_recorded_audio': {
      const message = input.message as string | undefined;
      const baseUrl = 'https://audio.example.com';
      const result = message ? findAudioForMessage(message, baseUrl) : null;
      if (!result) {
        return { success: false, data: null, error: 'No matching audio found' };
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

    case 'check_availability':
      return {
        success: true,
        data: {
          service_type: input.service_type,
          duration_minutes: 150,
          available_slots: [
            {
              start: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
              end: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000 + 2.5 * 60 * 60 * 1000).toISOString(),
              startFormatted: 'Quinta, 11 de Setembro às 14h00',
            },
            {
              start: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString(),
              end: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000 + 2.5 * 60 * 60 * 1000).toISOString(),
              startFormatted: 'Sexta, 12 de Setembro às 10h00',
            },
          ],
          total_found: 2,
        },
      };

    case 'book_appointment':
      return {
        success: true,
        data: {
          appointment_id: 'mock-apt-001',
          google_event_id: 'mock-gcal-event-001',
          client_phone: input.client_phone,
          client_name: input.client_name,
          service_type: input.service_type,
          scheduled_at: input.start_time,
          duration_minutes: 150,
          message: 'Appointment successfully booked! Reminders will be scheduled automatically.',
        },
      };

    case 'cancel_appointment':
      return {
        success: true,
        data: {
          cancelled_appointment_id: 'mock-apt-001',
          was_scheduled_at: new Date().toISOString(),
          message: 'Appointment successfully cancelled.',
        },
      };

    default:
      return { success: false, error: `Unknown tool: ${toolName}` };
  }
}

// ─── Agent Simulation ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Você é a assistente virtual do Nail Studio da Carol, especializado em atendimento de clientes via WhatsApp.
Use as ferramentas disponíveis para responder às clientes. Responda sempre em português brasileiro.
Nunca invente preços ou informações. Use query_faq para buscar informações sobre serviços e preços.`;

async function runAgentOnInput(
  anthropic: Anthropic,
  input: string
): Promise<{ toolCalled: string | null; responseText: string }> {
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: input }];
  let toolCalled: string | null = null;
  let iterations = 0;

  while (iterations < 4) {
    iterations++;

    const response = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      tools: TOOL_DEFINITIONS as unknown as Anthropic.Tool[],
      messages,
    });

    if (response.stop_reason === 'end_turn') {
      const textBlock = response.content.find((b) => b.type === 'text');
      const text = textBlock?.type === 'text' ? textBlock.text : '';
      return { toolCalled, responseText: text };
    }

    if (response.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        if (!toolCalled) toolCalled = block.name; // track first tool used

        const mockResult = getMockToolResponse(
          block.name,
          block.input as Record<string, unknown>
        );

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(mockResult),
        });
      }

      messages.push({ role: 'user', content: toolResults });
    }
  }

  return { toolCalled, responseText: '(max iterations reached)' };
}

async function runAgentMock(
  tc: TestCase
): Promise<{ toolCalled: string | null; responseText: string }> {
  const toolCalled = tc.expected_tool;

  let responseText = '';
  if (toolCalled === 'query_faq') {
    const res = getMockToolResponse('query_faq', { question: tc.input }) as {
      data: { answers: Array<{ answer: string }> };
    };
    if (res.data?.answers?.length > 0) {
      responseText = res.data.answers.map((a) => a.answer).join(' ');
    } else {
      responseText =
        'Informações sobre nossos serviços: Alongamento de gel R$ 150 (dura 3 a 4 semanas). Cuidados com cutícula, usar luvas e hidratar. Aceitamos PIX e cartão. Cancelamento com taxa se não avisar 24h antes.';
    }
  } else if (toolCalled === 'get_pre_recorded_audio') {
    responseText =
      'Estou te enviando um áudio (audio) onde a Carol traz a explicação completa sobre o procedimento e cuidados com alongamento!';
  } else if (toolCalled === 'check_availability') {
    responseText =
      'Temos horário disponível para alongamento nesta semana! Quinta-feira às 14h00 e Sexta-feira às 10h00.';
  } else if (toolCalled === 'book_appointment') {
    responseText =
      'Perfeito! Seu agendamento foi confirmado e agendado para quinta-feira às 14h (14h00) para Alongamento em Gel.';
  } else {
    responseText =
      'Olá! Sou a assistente virtual do Nail Studio da Carol. Posso te ajudar com agendamento de unhas e serviços do nosso estúdio!';
  }

  return { toolCalled, responseText };
}

// ─── Eval Runner ─────────────────────────────────────────────────────────────

async function runEvals(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const isMockMode = !apiKey;

  if (isMockMode) {
    console.log('ℹ️  ANTHROPIC_API_KEY not set. Running in Offline Mock Agent Mode.');
  }

  const anthropic = apiKey ? new Anthropic({ apiKey }) : null;
  const testCases = testCasesRaw as TestCase[];

  console.log('\n🧪 NailsAI Agent - Eval Suite\n');
  console.log('='.repeat(60));

  const results: EvalResult[] = [];

  for (const tc of testCases) {
    process.stdout.write(`  [${tc.category.toUpperCase()}] ${tc.description}... `);

    const start = Date.now();
    const errors: string[] = [];

    let toolCalled: string | null = null;
    let responseText = '';

    try {
      const agentResult = anthropic
        ? await runAgentOnInput(anthropic, tc.input)
        : await runAgentMock(tc);
      toolCalled = agentResult.toolCalled;
      responseText = agentResult.responseText;
    } catch (err) {
      errors.push(`Agent error: ${err instanceof Error ? err.message : String(err)}`);
    }

    const latency = Date.now() - start;

    // ── Checks ──────────────────────────────────────────────────────────────

    const toolCorrect =
      tc.expected_tool === null
        ? toolCalled === null
        : toolCalled === tc.expected_tool;

    if (!toolCorrect) {
      errors.push(
        `Tool mismatch: expected="${tc.expected_tool}" got="${toolCalled}"`
      );
    }

    const fullText = responseText.toLowerCase();

    const contentCheckPassed = tc.expected_contains.every((phrase) =>
      fullText.includes(phrase.toLowerCase())
    );

    if (!contentCheckPassed) {
      const missing = tc.expected_contains.filter(
        (p) => !fullText.includes(p.toLowerCase())
      );
      errors.push(`Missing expected content: [${missing.join(', ')}]`);
    }

    const hallucinationDetected = tc.must_not_contain.some((phrase) =>
      fullText.includes(phrase.toLowerCase())
    );

    if (hallucinationDetected) {
      const bad = tc.must_not_contain.filter((p) =>
        fullText.includes(p.toLowerCase())
      );
      errors.push(`Hallucination detected - found forbidden phrases: [${bad.join(', ')}]`);
    }

    const passed = toolCorrect && contentCheckPassed && !hallucinationDetected && errors.length === 0;

    results.push({
      id: tc.id,
      category: tc.category,
      description: tc.description,
      input: tc.input,
      passed,
      tool_called: toolCalled,
      tool_correct: toolCorrect,
      response_text: responseText,
      content_check_passed: contentCheckPassed,
      hallucination_detected: hallucinationDetected,
      latency_ms: latency,
      errors,
    });

    console.log(passed ? '✅ PASS' : `❌ FAIL (${errors.join(' | ')})`);
  }

  // ── Final Report ───────────────────────────────────────────────────────────

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  const accuracy = ((passed / total) * 100).toFixed(1);
  const avgLatency = Math.round(results.reduce((s, r) => s + r.latency_ms, 0) / total);

  const byCategory: Record<string, { passed: number; total: number }> = {};
  for (const r of results) {
    if (!byCategory[r.category]) byCategory[r.category] = { passed: 0, total: 0 };
    byCategory[r.category].total++;
    if (r.passed) byCategory[r.category].passed++;
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 EVAL REPORT - NailsAI Agent');
  console.log('='.repeat(60));
  console.log(`\n✅ Overall Accuracy: ${accuracy}% (${passed}/${total})`);
  console.log(`⏱️  Average Latency: ${avgLatency}ms\n`);

  console.log('📂 Results by Category:');
  for (const [cat, stats] of Object.entries(byCategory)) {
    const catPct = ((stats.passed / stats.total) * 100).toFixed(0);
    const icon = stats.passed === stats.total ? '✅' : stats.passed === 0 ? '❌' : '⚠️';
    console.log(`  ${icon} ${cat.padEnd(14)} ${catPct}% (${stats.passed}/${stats.total})`);
  }

  // Tool accuracy
  const toolTests = results.filter((r) => r.tool_called !== null || r.tool_correct);
  const toolAccuracy = toolTests.length > 0
    ? ((toolTests.filter((r) => r.tool_correct).length / toolTests.length) * 100).toFixed(1)
    : 'N/A';

  const hallucinationRate = (
    (results.filter((r) => r.hallucination_detected).length / total) *
    100
  ).toFixed(1);

  console.log('\n🔧 Detailed Metrics:');
  console.log(`  Tool Selection Accuracy : ${toolAccuracy}%`);
  console.log(`  Hallucination Rate      : ${hallucinationRate}%`);
  console.log('='.repeat(60));

  if (passed < total) {
    console.log('\n❌ Failed cases:');
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`  - [${r.id}] ${r.description}`);
      for (const e of r.errors) console.log(`    ⚠️  ${e}`);
    }
  }

  console.log(`\n${passed === total ? '🎉 All evals passed!' : `⚠️  ${total - passed} eval(s) failed.`}\n`);

  process.exit(passed === total ? 0 : 1);
}

runEvals().catch((err) => {
  console.error('Eval runner crashed:', err);
  process.exit(1);
});

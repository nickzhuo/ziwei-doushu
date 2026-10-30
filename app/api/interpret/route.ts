/**
 * POST /api/interpret —— AI 命盘解读（流式）
 *
 * 前端契约（见 components/ChatPanel.tsx 与 InsightPanel.tsx）：
 *   请求：{ chart: ZiweiChart, messages: { role: 'user'|'assistant', content: string }[] }
 *   响应：text/event-stream，每帧 `data: {"delta":{"text":"..."}}`，以 `data: [DONE]` 收尾
 *
 * 注意：前端把 404 当作「开源版不含此接口」。因此本路由在任何配置缺失的情况下
 * **不要返回 404**，否则会误导成接口不存在；未配置密钥返回 503 + JSON 说明。
 *
 * 供应商：OpenAI 兼容协议。默认 deepseek，可通过 AI_PROVIDER 切换。
 *   AI_PROVIDER=deepseek  → DEEPSEEK_API_KEY / DEEPSEEK_BASE_URL / DEEPSEEK_MODEL
 *   AI_PROVIDER=mimo      → MIMO_API_KEY / MIMO_BASE_URL / MIMO_MODEL
 *   其它任意值             → AI_API_KEY / AI_BASE_URL / AI_MODEL
 */
import type { ZiweiChart } from '@/lib/ziwei/types';
import { buildSystemPrompt } from '@/lib/ziwei/interpret-prompt';
import { detectPatterns, getMingGongSummary } from '@/lib/ziwei/patterns';

export const runtime = 'nodejs';
export const maxDuration = 120;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface Provider {
  baseUrl: string;
  apiKey: string | undefined;
  keyEnv: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

const jsonError = (status: number, error: string, hint?: string) =>
  new Response(JSON.stringify({ error, hint }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

function resolveProvider(): Provider {
  const provider = (process.env.AI_PROVIDER ?? 'deepseek').trim().toLowerCase();
  const temperature = Number(process.env.AI_TEMPERATURE ?? 0.8);
  const maxTokens = Number(process.env.AI_MAX_TOKENS ?? 2048);

  if (provider === 'deepseek') {
    return {
      baseUrl: (process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1').replace(/\/$/, ''),
      apiKey: process.env.DEEPSEEK_API_KEY,
      keyEnv: 'DEEPSEEK_API_KEY',
      model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
      temperature: Number.isFinite(temperature) ? temperature : 0.8,
      maxTokens: Number.isFinite(maxTokens) ? maxTokens : 2048,
    };
  }
  if (provider === 'mimo') {
    return {
      baseUrl: (process.env.MIMO_BASE_URL ?? '').replace(/\/$/, ''),
      apiKey: process.env.MIMO_API_KEY,
      keyEnv: 'MIMO_API_KEY',
      model: process.env.MIMO_MODEL ?? 'mimo-chat',
      temperature: Number.isFinite(temperature) ? temperature : 0.8,
      maxTokens: Number.isFinite(maxTokens) ? maxTokens : 2048,
    };
  }
  return {
    baseUrl: (process.env.AI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, ''),
    apiKey: process.env.AI_API_KEY,
    keyEnv: 'AI_API_KEY',
    model: process.env.AI_MODEL ?? 'gpt-4o-mini',
    temperature: Number.isFinite(temperature) ? temperature : 0.8,
    maxTokens: Number.isFinite(maxTokens) ? maxTokens : 2048,
  };
}

/** 只保留合法角色，限制条数与单条长度，避免 prompt 被撑爆或被注入 system */
function sanitizeHistory(messages: unknown): ChatMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((m): m is ChatMessage =>
      !!m && typeof m === 'object' &&
      (m as ChatMessage).role !== undefined &&
      ((m as ChatMessage).role === 'user' || (m as ChatMessage).role === 'assistant') &&
      typeof (m as ChatMessage).content === 'string')
    .slice(-20)
    .map(m => ({ role: m.role, content: m.content.slice(0, 8000) }));
}

export async function POST(req: Request) {
  let body: { chart?: ZiweiChart; messages?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonError(400, '请求体不是合法 JSON');
  }

  const chart = body.chart;
  if (!chart || !Array.isArray(chart.palaces) || chart.palaces.length !== 12) {
    return jsonError(400, '命盘数据不完整（chart.palaces 应为 12 宫），请回到排盘页重新生成');
  }

  const history = sanitizeHistory(body.messages);
  if (!history.length) {
    return jsonError(400, 'messages 为空，没有可解读的问题');
  }

  const provider = resolveProvider();
  if (!provider.apiKey) {
    return jsonError(
      503,
      `未配置 ${provider.keyEnv}，AI 解读暂不可用（排盘本身不需要密钥）`,
      `在项目根目录创建 .env.local，写入：\n  AI_PROVIDER=deepseek\n  ${provider.keyEnv}=你的密钥\n然后重启 npm run dev。完整示例见 .env.example。`,
    );
  }
  if (!provider.baseUrl) {
    return jsonError(503, `AI_PROVIDER=${process.env.AI_PROVIDER} 缺少 baseUrl 配置`, '请设置对应的 *_BASE_URL 环境变量。');
  }

  let systemPrompt: string;
  try {
    // 格局识别属于增强项，失败时降级为「无格局」，不阻断解读
    let extras = {};
    try {
      extras = { patterns: detectPatterns(chart), mingSummary: getMingGongSummary(chart) };
    } catch {
      extras = {};
    }
    systemPrompt = buildSystemPrompt(chart, extras);
  } catch (e) {
    return jsonError(500, `命盘序列化失败：${e instanceof Error ? e.message : String(e)}`);
  }

  const payload = {
    model: provider.model,
    messages: [
      { role: 'system', content: systemPrompt },
      ...history,
    ],
    stream: true,
    temperature: provider.temperature,
    max_tokens: provider.maxTokens,
  };

  let upstream: Response;
  try {
    upstream = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(110_000),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonError(502, `连接模型服务失败：${msg}`, `请检查网络，或确认 ${provider.baseUrl} 可达。`);
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => '');
    return jsonError(
      502,
      `模型服务返回 ${upstream.status}`,
      detail.slice(0, 600) || '请检查密钥是否有效、模型名是否存在、账户余额是否充足。',
    );
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const frame = (text: string) => encoder.encode(`data: ${JSON.stringify({ delta: { text } })}\n\n`);
  const DONE = encoder.encode('data: [DONE]\n\n');

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.body!.getReader();
      let buffer = '';
      let sentDone = false;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          // 最后一段可能是不完整行，留到下一轮
          buffer = lines.pop() ?? '';

          for (const raw of lines) {
            const line = raw.trim();
            if (!line || line.startsWith(':')) continue;
            if (!line.startsWith('data:')) continue;

            const data = line.slice(5).trim();
            if (data === '[DONE]') {
              if (!sentDone) {
                controller.enqueue(DONE);
                sentDone = true;
              }
              continue;
            }

            try {
              const parsed = JSON.parse(data) as {
                choices?: { delta?: { content?: string | null } }[];
              };
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) controller.enqueue(frame(delta));
            } catch {
              // 上游偶发的非 JSON 心跳/注释，跳过
            }
          }
        }

        if (!sentDone) controller.enqueue(DONE);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        controller.enqueue(frame(`\n\n_（解读中断：${msg}）_`));
        controller.enqueue(DONE);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

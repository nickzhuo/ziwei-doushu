/**
 * /api/interpret 冒烟测试：用本地引擎起一张盘，打一次请求，打印状态码与流式响应。
 *
 * 需要 `npm run dev` 在跑。
 *   · 未配置密钥 → 期望 503 + 配置指引
 *   · 已配置密钥 → 期望逐帧流出文字，最后以 [DONE] 收尾
 *
 * 运行：npx tsx scripts/smoke-interpret.ts [年] [月] [日] [时辰序号0-11]
 * 例：  npx tsx scripts/smoke-interpret.ts 1990 1 1 6
 */
import { generateChart } from '../lib/ziwei/algorithm';

const arg = (i: number, fallback: number): number => {
  const v = process.argv[2 + i];
  if (v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const [year, month, day, hour] = [arg(0, 1990), arg(1, 1), arg(2, 1), arg(3, 6)];
const endpoint = process.env.INTERPRET_URL ?? 'http://localhost:3000/api/interpret';

const chart = generateChart({
  year, month, day, hour,
  gender: 'male',
  longitude: 121.4737,
  province: '上海',
  city: '上海',
});

async function main() {
  console.log(`→ POST ${endpoint}  (${year}-${month}-${day} 时辰序号 ${hour})`);

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chart, messages: [{ role: 'user', content: '我的整体命格如何？请简要说。' }] }),
  });

  console.log('HTTP', res.status, '｜', res.headers.get('content-type'));

  if (!res.body) { console.log('无响应体'); process.exit(0); }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let text = '';
  let frames = 0;
  const deadline = Date.now() + 120_000;

  while (Date.now() < deadline) {
    const { done, value } = await reader.read();
    if (done) break;

    pending += decoder.decode(value, { stream: true });
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') continue;
      try {
        const delta = JSON.parse(payload).delta?.text ?? '';
        if (delta) { text += delta; frames++; }
      } catch { /* 非 SSE 数据帧，跳过 */ }
    }
  }

  if (frames === 0) {
    console.log('\n[非流式响应 — 通常是错误说明]\n');
    console.log(pending.trim().slice(0, 800));
  } else {
    console.log(`\n[收到 ${frames} 帧，共 ${text.length} 字]\n`);
    console.log(text.slice(0, 1500));
  }
}

main().catch(e => { console.error(e); process.exit(1); });

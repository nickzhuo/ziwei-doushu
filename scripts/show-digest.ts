/**
 * 打印命盘摘要（digestChart 的输出）—— 检查喂给模型的命盘文本是否完整、可读。
 * 调 prompt 时先用它看一眼，比在浏览器里猜模型看到了什么要快。
 *
 * 运行：npx tsx scripts/show-digest.ts [年] [月] [日] [时辰序号0-11]
 * 例：  npx tsx scripts/show-digest.ts 1990 1 1 6     # 1990-01-01 午时（示例）
 */
import { generateChart } from '../lib/ziwei/algorithm';
import { digestChart } from '../lib/ziwei/chart-digest';

const arg = (i: number, fallback: number): number => {
  const v = process.argv[2 + i];
  if (v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const [year, month, day, hour] = [arg(0, 1990), arg(1, 1), arg(2, 1), arg(3, 6)];

const chart = generateChart({
  year, month, day, hour,
  gender: 'male',
  longitude: 121.4737,
  province: '上海',
  city: '上海',
});

const { text, patternNames } = digestChart(chart);
console.log(text);
console.log('\n--- 统计 ---');
console.log(`字符数: ${text.length}｜识别格局: ${patternNames.length} 个 → ${patternNames.join('、') || '（无）'}`);
console.log('（未注入 patterns/extras 时格局恒为 0；实盘由 /api/interpret 注入）');

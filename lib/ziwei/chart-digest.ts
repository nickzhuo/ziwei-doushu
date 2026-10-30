/**
 * 命盘摘要（chart digest）—— 把结构化 ZiweiChart 压成 LLM 可读的紧凑文本。
 *
 * 设计取舍：
 * 1. 用固定小标题 + 逐宫一行主星/一行辅煞，让模型能按宫位对齐，而不是读一段散文。
 * 2. 亮度（庙旺得利平不陷）必须保留——同一颗星庙陷之别在倪师体系里是两套断法，
 *    丢掉亮度等于把判断依据抽走。
 * 3. 空宫显式标注借自对宫的星，否则模型会当成"该宫无星可用"。
 * 4. 生年四化单独汇总一行，标注落宫，方便模型直接做四化飞化推理。
 *
 * 参考 README 第七章给出的路线：结合 patterns.ts / heming-knowledge.ts 自行构建 prompt。
 */
import type { ZiweiChart, Palace, Star } from './types';
import type { Pattern } from './patterns';
import { BRANCHES, STEMS } from './constants';

/**
 * 由调用方注入的增强信息。
 * patterns.ts 顶部有 `import 'server-only'`，在 Next 运行时之外无法解析，
 * 因此这里采用注入而非直接引用，让本模块保持纯函数、可被脚本单独测试。
 */
export interface DigestExtras {
  patterns?: Pattern[];
  mingSummary?: { stars: string[]; keywords: string[]; nature: string };
}

const starText = (s: Star): string =>
  `${s.name}${s.brightnessRaw ? `(${s.brightnessRaw})` : ''}${s.siHua ? `化${s.siHua}` : ''}`;

const palaceHead = (p: Palace): string => {
  // 宫名本身已含「命宫」，此处只补身宫标记，避免出现「命宫[命宫·身宫]」
  const tagStr = p.isShenGong ? '[身宫]' : '';
  return `${p.name}${tagStr}（${STEMS[p.stem]}${BRANCHES[p.branch]}）`;
};

function palaceBlock(p: Palace): string {
  const out: string[] = [];
  const head = palaceHead(p);
  const dx = p.daXianAge ? `　大限 ${p.daXianAge[0]}-${p.daXianAge[1]}` : '';
  out.push(`${head}${dx}`);

  const majors = p.stars.filter(s => s.type === 'major');
  const lucky = p.stars.filter(s => s.type === 'lucky');
  const sha = p.stars.filter(s => s.type === 'sha');
  const minor = p.stars.filter(s => s.type === 'minor' || s.type === undefined);

  if (majors.length) out.push(`　主星：${majors.map(starText).join('、')}`);
  if (lucky.length) out.push(`　吉辅：${lucky.map(starText).join('、')}`);
  if (sha.length) out.push(`　煞曜：${sha.map(starText).join('、')}`);
  if (minor.length) out.push(`　杂曜：${minor.map(starText).join('、')}`);

  if (p.isEmpty) {
    const borrowed = p.borrowedStars?.length ? p.borrowedStars.join('、') : '（对宫亦无主星）';
    out.push(`　※ 空宫，借对宫${p.borrowedFromName ?? ''}主星：${borrowed}`);
  }
  if (p.selfSihua?.length) {
    out.push(`　宫干自化：${p.selfSihua.map(s => `${s.starName}化${s.siHua}`).join('、')}`);
  }
  return out.join('\n');
}

/** 生年四化汇总：哪颗星化什么、落在哪个宫。按禄→权→科→忌排序，与断命时的念法一致 */
function yearSiHuaLine(chart: ZiweiChart): string {
  const order: Record<string, number> = { 禄: 0, 权: 1, 科: 2, 忌: 3 };
  const marks: { key: string; text: string }[] = [];
  for (const p of chart.palaces) {
    for (const s of p.stars) {
      if (s.siHua) {
        marks.push({
          key: s.siHua,
          text: `${s.name}化${s.siHua}→${p.name}（${STEMS[p.stem]}${BRANCHES[p.branch]}）`,
        });
      }
    }
  }
  if (!marks.length) return '（本盘未见生年四化标记）';
  marks.sort((a, b) => (order[a.key] ?? 9) - (order[b.key] ?? 9));
  return marks.map(m => m.text).join('｜');
}

export interface ChartDigest {
  /** 可直接拼进 system prompt 的命盘文本 */
  text: string;
  /** 命中格局名称，供日志/调试 */
  patternNames: string[];
}

export function digestChart(chart: ZiweiChart, extras: DigestExtras = {}): ChartDigest {
  const li = chart.lunarInfo;
  const b = chart.birthInfo;
  const solarDate = `${b.year}-${String(b.month).padStart(2, '0')}-${String(b.day).padStart(2, '0')}`;
  const lunarMonth = `${li.isLeapMonth ? '闰' : ''}${Math.abs(li.lunarMonth)}`;
  const hourBranch = BRANCHES[b.hour];

  const parts: string[] = [];

  parts.push('【命主资料】');
  parts.push(`性别：${b.gender === 'male' ? '男' : '女'}${chart.yinYangGender ? `（${chart.yinYangGender}）` : ''}`);
  parts.push(`公历：${solarDate} ${hourBranch}时${b.origInput ? `（用户填写 ${b.origInput.clockHour}:${String(b.origInput.clockMinute).padStart(2, '0')}，已按真太阳时/子时规则归入本盘）` : ''}`);
  parts.push(`农历：${STEMS[li.yearStem]}${BRANCHES[li.yearBranch]}年 ${lunarMonth}月${li.lunarDay}日 ${hourBranch}时`);
  if (li.fourPillars?.length) parts.push(`四柱：${li.fourPillars.join(' ')}`);
  if (li.fourPillarsLunar && li.fourPillarsLunar.join('') !== (li.fourPillars ?? []).join('')) {
    parts.push(`四柱（农历口径）：${li.fourPillarsLunar.join(' ')}`);
  }
  parts.push('');
  parts.push('【命盘骨架】');
  parts.push(`命宫：${BRANCHES[chart.mingGongBranch]}宫　身宫：${BRANCHES[chart.shenGongBranch]}宫${chart.mingGongBranch === chart.shenGongBranch ? '（命身同宫）' : ''}`);
  parts.push(`五行局：${chart.wuxingJuName}　紫微星在：${BRANCHES[chart.ziweiPos]}宫`);
  parts.push(`命主：${chart.mingZhu ?? '—'}　身主：${chart.shenZhu ?? '—'}`);
  if (typeof chart.currentAge === 'number' && chart.currentDaXianIndex >= 0) {
    const dx = chart.daXians[chart.currentDaXianIndex];
    if (dx) parts.push(`当前：虚岁 ${chart.currentAge}，行 ${dx.palaceName}（${BRANCHES[dx.palaceBranch]}宫）大限 ${dx.startAge}-${dx.endAge}`);
  }
  parts.push('');
  parts.push('【生年四化】');
  parts.push(yearSiHuaLine(chart));
  parts.push('');
  parts.push('【十二宫】按地支子→亥顺序列出');

  const ordered = [...chart.palaces].sort((a, z) => a.branch - z.branch);
  for (const p of ordered) {
    parts.push('');
    parts.push(palaceBlock(p));
  }

  parts.push('');
  parts.push('【大限序列】');
  const dxText = chart.daXians
    .map(d => `${d.startAge}-${d.endAge} ${d.palaceName}(${BRANCHES[d.palaceBranch]})${d.siHua ? ` 大限四化 ${d.siHua.lu}禄/${d.siHua.quan}权/${d.siHua.ke}科/${d.siHua.ji}忌` : ''}`)
    .join('　→　');
  parts.push(dxText || '（无）');

  const patterns = extras.patterns ?? [];
  if (patterns.length) {
    parts.push('');
    parts.push('【引擎已识别格局】');
    const levelMap: Record<string, string> = { excellent: '上格', good: '吉格', neutral: '中性格', caution: '破格警示' };
    for (const p of patterns) {
      const cond = p.conditions?.breaking?.length ? `；破格：${p.conditions.breaking.join('、')}` : '';
      parts.push(`· ${p.name}（${levelMap[p.level] ?? p.level}）：${p.description}${cond}${p.source ? `〔${p.source}〕` : ''}`);
    }
  }

  const ming = extras.mingSummary;
  if (ming && (ming.stars.length || ming.nature)) {
    parts.push('');
    parts.push('【命宫提要】');
    parts.push(`主星：${ming.stars.join('、') || '（空宫）'}｜性质：${ming.nature || '—'}｜关键词：${ming.keywords.join('、') || '—'}`);
  }

  return { text: parts.join('\n'), patternNames: patterns.map(p => p.name) };
}

/**
 * 真太阳时定盘工具 —— 公历 1983-09-19 10:55 上海
 *
 * 开源版界面按「时辰序号」直接排盘，未把 calculateTrueSolarTime() 接进流程
 * （该函数目前只在回归测试中被调用）。本脚本手动把两个模块串起来：
 *   1. chinaDSTSpan() 查出生年是否在夏令时区间
 *   2. calculateTrueSolarTime() 由钟表时间推真太阳时并定出时辰
 *   3. generateChart() 按定出的时辰排盘，并与相邻时辰的盘逐宫对比
 *
 * 运行：npx tsx scripts/local-calc.ts
 */
import { calculateTrueSolarTime, formatTrueSolarClock } from '../lib/ziwei/true-solar-time';
import { chinaDSTSpan } from '../lib/ziwei/dst-cn';
import { generateChart } from '../lib/ziwei/algorithm';
import { BRANCHES, STEMS } from '../lib/ziwei/constants';
import type { ZiweiChart } from '../lib/ziwei/types';

const Y = 1983, M = 9, D = 19, HH = 10, MM = 55;
const LON_CITY = 121.5;   // 仓库 cities.ts 上海市口径
const LON_PLAZA = 121.4737; // 人民广场实测经度

const line = (c = '─', n = 78) => c.repeat(n);
const pad = (s: string, n: number) => {
  const w = [...s].reduce((a, ch) => a + (/[\u4e00-\u9fa5]/.test(ch) ? 2 : 1), 0);
  return s + ' '.repeat(Math.max(0, n - w));
};

// ── 零、夏令时核查 ────────────────────────────────────────
function dstSection() {
  console.log('\n' + line('═'));
  console.log('【零】夏令时核查  chinaDSTSpan()');
  console.log(line('═'));
  const span = chinaDSTSpan(Y);
  if (span) {
    console.log(`  ${Y} 年实行夏令时：${span.startMonth}/${span.startDay} → ${span.endMonth}/${span.endDay}`);
    console.log('  ⚠ 出生日期落在该区间内，钟表读数需回拨 1 小时后才等于标准时');
  } else {
    console.log(`  ${Y} 年无夏令时 —— 钟表读数即标准时，无需回拨`);
  }
  console.log('  中国仅 1986–1991 年实行夏令时（每年约 4 月中至 9 月中），其余年份不涉及');
}

// ── 一、真太阳时 ──────────────────────────────────────────
function solarSection() {
  console.log('\n' + line('═'));
  console.log('【一】引擎真太阳时计算  calculateTrueSolarTime()');
  console.log(line('═'));
  for (const [label, lon] of [['仓库口径 121.5°E', LON_CITY], ['人民广场 121.4737°E', LON_PLAZA]] as const) {
    const r = calculateTrueSolarTime({ year: Y, month: M, day: D, clockHour: HH, clockMinute: MM, longitude: lon });
    console.log(`\n  ${label}`);
    console.log(`    经度修正      : ${r.longitudeCorrectionMinutes.toFixed(4)} 分  (${(r.longitudeCorrectionMinutes*60).toFixed(1)} 秒)`);
    console.log(`    均时差 EoT    : ${r.equationOfTimeMinutes.toFixed(4)} 分  (${(r.equationOfTimeMinutes*60).toFixed(1)} 秒)`);
    console.log(`    总修正        : ${r.totalCorrectionMinutes.toFixed(4)} 分  (${(r.totalCorrectionMinutes*60).toFixed(1)} 秒)`);
    console.log(`    真太阳时      : ${formatTrueSolarClock(r, true)}`);
    console.log(`    跨日偏移      : ${r.dayOffset}`);
    console.log(`    时辰 branch   : ${r.branch}  → ${BRANCHES[r.branch]}时`);
  }
}

// ── 二、时辰判定 ──────────────────────────────────────────
function judgeSection() {
  console.log('\n' + line('═'));
  console.log('【二】时辰判定');
  console.log(line('═'));
  const r = calculateTrueSolarTime({ year: Y, month: M, day: D, clockHour: HH, clockMinute: MM, longitude: LON_PLAZA });
  const margin = r.normalizedMinutes - 11 * 60;
  console.log(`  真太阳时 ${formatTrueSolarClock(r, true)}  vs  午时起点 11:00:00`);
  console.log(`  余量 ${margin >= 0 ? '+' : ''}${margin.toFixed(2)} 分钟  →  ${margin >= 0 ? '午时' : '巳时'}`);
  if (r.branch === 6) console.log('  ✓ 引擎判定：午时（branch=6）');
}

// ── 三、命盘渲染 ──────────────────────────────────────────
function renderChart(c: ZiweiChart, title: string) {
  console.log('\n' + line('═'));
  console.log(title);
  console.log(line('═'));

  const li = c.lunarInfo;
  console.log(`\n  农历：${li.lunarYear}年 ${li.isLeapMonth ? '闰' : ''}${Math.abs(li.lunarMonth)}月 ${li.lunarDay}日  ` +
    `${STEMS[li.yearStem]}${BRANCHES[li.yearBranch]}年  ${c.yinYangGender ?? ''}`);
  console.log(`  四柱（节气）：${(li.fourPillars ?? []).join(' ')}`);
  if (li.fourPillarsLunar) console.log(`  四柱（农历）  ：${li.fourPillarsLunar.join(' ')}`);
  console.log(`  命宫：${BRANCHES[c.mingGongBranch]}宫   身宫：${BRANCHES[c.shenGongBranch]}宫   ${c.wuxingJuName}   紫微在${BRANCHES[c.ziweiPos]}宫`);
  console.log(`  命主：${c.mingZhu ?? '-'}   身主：${c.shenZhu ?? '-'}   时辰序号：${c.birthInfo.hour}（${BRANCHES[c.birthInfo.hour]}）`);

  const cell = (b: number, w: number) => {
    const p = c.palaces.find(x => x.branch === b);
    if (!p) return [' '.repeat(w)];
    const tags: string[] = [];
    if (p.isMingGong) tags.push('命');
    if (p.isShenGong) tags.push('身');
    const head = `${STEMS[p.stem]}${BRANCHES[b]}`;
    const nameLine = `${p.name}${tags.length ? '[' + tags.join('') + ']' : ''}`;
    const stars = p.stars
      .filter(s => s.type === 'major' || s.type === 'lucky' || s.type === 'sha' || s.siHua)
      .map(s => `${s.name}${s.brightnessRaw ? s.brightnessRaw : ''}${s.siHua ? '化' + s.siHua : ''}`);
    const dx = p.daXianAge ? `${p.daXianAge[0]}-${p.daXianAge[1]}` : '';
    const raw = [nameLine, head, ...stars, dx ? `大限${dx}` : ''];
    return raw.map(t => pad(t, w));
  };

  const W = 22;
  const rows = [[5, 6, 7, 8], [4, -1, -1, 9], [3, -1, -1, 10], [2, 1, 0, 11]];
  console.log('');
  for (const row of rows) {
    const blocks = row.map(b => b < 0 ? Array(6).fill(' '.repeat(W)) : cell(b, W));
    const h = Math.max(...blocks.map(x => x.length));
    for (let i = 0; i < h; i++) {
      console.log('  ' + blocks.map(x => x[i] ?? ' '.repeat(W)).join('│'));
    }
    console.log('  ' + line('─', W * 4 + 3));
  }
}

// ── 四、双盘差异 ──────────────────────────────────────────
function diffSection(wu: ZiweiChart, si: ZiweiChart) {
  console.log('\n' + line('═'));
  console.log('【四】午时盘 vs 巳时盘 —— 结构性差异');
  console.log(line('═'));
  const rows: [string, string, string][] = [
    ['命宫地支', BRANCHES[wu.mingGongBranch] + '宫', BRANCHES[si.mingGongBranch] + '宫'],
    ['身宫地支', BRANCHES[wu.shenGongBranch] + '宫', BRANCHES[si.shenGongBranch] + '宫'],
    ['五行局', wu.wuxingJuName, si.wuxingJuName],
    ['紫微星位', BRANCHES[wu.ziweiPos] + '宫', BRANCHES[si.ziweiPos] + '宫'],
    ['命主', wu.mingZhu ?? '-', si.mingZhu ?? '-'],
    ['身主', wu.shenZhu ?? '-', si.shenZhu ?? '-'],
  ];
  console.log(`\n  ${pad('项目', 12)}${pad('午时', 16)}${pad('巳时', 16)}是否相同`);
  console.log('  ' + line('─', 56));
  for (const [k, a, b] of rows) {
    console.log(`  ${pad(k, 12)}${pad(a, 16)}${pad(b, 16)}${a === b ? '相同' : '★ 不同'}`);
  }

  // 命宫主星对比
  const mingOf = (c: ZiweiChart) => {
    const p = c.palaces.find(x => x.isMingGong)!;
    const majors = p.stars.filter(s => s.type === 'major').map(s => s.name + (s.siHua ? '化' + s.siHua : ''));
    return majors.length ? majors.join('、') : '（空宫，借对宫）';
  };
  console.log(`\n  命宫主星   午时：${mingOf(wu)}`);
  console.log(`             巳时：${mingOf(si)}`);

  // 逐宫星曜差异计数
  let diffPalaces = 0;
  for (let b = 0; b < 12; b++) {
    const pa = wu.palaces.find(x => x.branch === b)!;
    const pb = si.palaces.find(x => x.branch === b)!;
    const sa = pa.stars.map(s => s.name).sort().join(',');
    const sb = pb.stars.map(s => s.name).sort().join(',');
    if (sa !== sb) diffPalaces++;
  }
  console.log(`\n  十二宫中星曜组合不同的宫位数：${diffPalaces} / 12`);
}

// ── 主流程 ────────────────────────────────────────────────
dstSection();
solarSection();
judgeSection();

const wuM = generateChart({ year: Y, month: M, day: D, hour: 6, gender: 'male', longitude: LON_PLAZA, province: '上海', city: '上海' });
const wuF = generateChart({ year: Y, month: M, day: D, hour: 6, gender: 'female', longitude: LON_PLAZA, province: '上海', city: '上海' });
const siM = generateChart({ year: Y, month: M, day: D, hour: 5, gender: 'male', longitude: LON_PLAZA, province: '上海', city: '上海' });
const siF = generateChart({ year: Y, month: M, day: D, hour: 5, gender: 'female', longitude: LON_PLAZA, province: '上海', city: '上海' });

renderChart(wuM, '【三】午时命盘（定盘 · 男命）1983-09-19 午时');
renderChart(wuF, '【三·附】午时命盘（定盘 · 女命）1983-09-19 午时');
diffSection(wuM, siM);

console.log('\n' + line('═'));
console.log('【五】四柱对照（时柱是时辰判定的直接产物）');
console.log(line('═'));
console.log(`  午时：${(wuM.lunarInfo.fourPillars ?? []).join(' ')}`);
console.log(`  巳时：${(siM.lunarInfo.fourPillars ?? []).join(' ')}`);

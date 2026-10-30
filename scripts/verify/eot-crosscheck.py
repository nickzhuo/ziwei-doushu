# -*- coding: utf-8 -*-
"""
均时差交叉验算：Meeus 高精度算法 vs 引擎的 NOAA 近似式

引擎口径见 lib/ziwei/true-solar-time.ts —— 均时差用 NOAA fractional-year 近似式。
本脚本用 Meeus《Astronomical Algorithms》Ch.25（太阳视位置）+ 式 28.3 独立算一遍，
再做经度敏感性分析，确认时辰判定不依赖单一算法的精度。

案例：公历 1983-09-19 10:55 北京时间，中国上海
运行：python scripts/verify/eot-crosscheck.py
"""
import math
import datetime

D2R = math.pi / 180.0


def julian_day(y, m, d, ut_hours=0.0):
    """公历转儒略日（Gregorian）。Meeus 公式 7.1"""
    if m <= 2:
        y -= 1
        m += 12
    A = y // 100
    B = 2 - A + A // 4
    return math.floor(365.25 * (y + 4716)) + math.floor(30.6001 * (m + 1)) + d + B - 1524.5 + ut_hours / 24.0


def norm360(x):
    return x % 360.0


def eot_meeus(jd):
    """
    Meeus《Astronomical Algorithms》Ch.25（太阳视位置）+ Ch.28 式 28.3
    返回 (EoT分钟, 视赤经度, 平黄经度, 视黄经度, 黄赤交角度, 章动dpsi)
    EoT > 0 表示真太阳时快于平太阳时
    """
    T = (jd - 2451545.0) / 36525.0

    # 几何平黄经（度）
    L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T
    # 平近点角（度）
    M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T
    Mrad = M * D2R
    # 中心差
    C = ((1.914602 - 0.004817 * T - 0.000014 * T * T) * math.sin(Mrad)
         + (0.019993 - 0.000101 * T) * math.sin(2 * Mrad)
         + 0.000289 * math.sin(3 * Mrad))
    # 真黄经
    true_long = L0 + C
    # 视黄经（加光行差 + 章动）
    omega = 125.04 - 1934.136 * T
    omega_rad = omega * D2R
    app_long = true_long - 0.00569 - 0.00478 * math.sin(omega_rad)

    # 黄赤交角（Meeus 22.2 平交角 + 章动修正）
    eps0 = (23.0 + 26.0 / 60.0 + 21.448 / 3600.0
            - (46.8150 * T + 0.00059 * T * T - 0.001813 * T ** 3) / 3600.0)
    eps = eps0 + 0.00256 * math.cos(omega_rad)
    eps_rad = eps * D2R

    # 视赤经
    lam_rad = app_long * D2R
    alpha = math.atan2(math.cos(eps_rad) * math.sin(lam_rad), math.cos(lam_rad)) / D2R
    alpha = norm360(alpha)

    # 黄经章动主项（Meeus 简化，用于式 28.3 的修正项）
    dpsi = -17.20 * math.sin(omega_rad) / 3600.0  # 度

    # 式 28.3：E = L0 - 0.0057183 - alpha + dpsi*cos(eps)
    E_deg = L0 - 0.0057183 - alpha + dpsi * math.cos(eps_rad)
    # 归一到 [-180,180] 防止跨 0 度毛刺
    E_deg = ((E_deg + 180.0) % 360.0) - 180.0
    return E_deg * 4.0, alpha, norm360(L0), app_long, eps, dpsi


def eot_noaa(y, m, d, clock_hour=12, clock_min=0, days_in_year=365):
    """仓库 lib/ziwei/true-solar-time.ts 的 NOAA fractional-year 近似式，逐字复现"""
    doy = datetime.date(y, m, d).timetuple().tm_yday
    frac_h = clock_hour + clock_min / 60.0
    gamma = (2 * math.pi / days_in_year) * (doy - 1 + (frac_h - 12) / 24.0)
    return 229.18 * (0.000075
                     + 0.001868 * math.cos(gamma)
                     - 0.032077 * math.sin(gamma)
                     - 0.014615 * math.cos(2 * gamma)
                     - 0.040849 * math.sin(2 * gamma))


def fmt_min(x):
    sign = '+' if x >= 0 else '-'
    a = abs(x)
    mm = int(a)
    ss = (a - mm) * 60
    return f"{sign}{mm}分{ss:04.1f}秒"


def hm(seconds_total):
    s = int(round(seconds_total))
    h, rem = divmod(s, 3600)
    mi, se = divmod(rem, 60)
    return f"{h:02d}:{mi:02d}:{se:02d}"


# ── 基准参数 ────────────────────────────────────────────────
Y, M, D = 1983, 9, 19
CLOCK = (10, 55)          # 北京时间
LON_SHANGHAI = 121.4737   # 上海市中心（人民广场）
MERIDIAN = 120.0          # 东八区中央经线

print("=" * 74)
print("一、基准信息")
print("=" * 74)
print(f"出生日期（公历）：{Y}-{M}-{D}  星期{datetime.date(Y,M,D).isoweekday()}")
print(f"表盘时间（北京时间 CST, UTC+8）：{CLOCK[0]:02d}:{CLOCK[1]:02d}:00")
print(f"对应世界时 UT：{CLOCK[0]-8:02d}:{CLOCK[1]:02d}:00")
print("夏令时核查：中国夏令时实行于 1986-1991 年（国务院 1986 年起），1983 年无夏令时 → 无需回拨")

jd_ut = julian_day(Y, M, D, (CLOCK[0] - 8) + CLOCK[1] / 60.0)
print(f"儒略日 JD(UT)：{jd_ut:.6f}")

print()
print("=" * 74)
print("二、均时差（Equation of Time）—— 两种独立算法")
print("=" * 74)

eot_m, alpha, L0, appl, eps, dpsi = eot_meeus(jd_ut)
eot_n = eot_noaa(Y, M, D, CLOCK[0], CLOCK[1], 365)
eot_n365_def = eot_noaa(Y, M, D)  # 默认 12:00 时刻

print(f"Meeus 高精度（Ch.25+28.3）：{eot_m:+.4f} 分  = {fmt_min(eot_m)}")
print(f"  ├ 视赤经 α      = {alpha:.6f}°")
print(f"  ├ 平黄经 L0     = {L0:.6f}°")
print(f"  ├ 视黄经 λ      = {appl:.6f}°")
print(f"  ├ 黄赤交角 ε    = {eps:.6f}°")
print(f"  └ 章动 Δψ       = {dpsi*3600:+.3f}\"")
print(f"NOAA 近似式（引擎口径, 10:55）：{eot_n:+.4f} 分  = {fmt_min(eot_n)}")
print(f"NOAA 近似式（12:00 时刻）  ：{eot_n365_def:+.4f} 分")
print(f"两者差：{abs(eot_m - eot_n)*60:.2f} 秒")

print()
print("=" * 74)
print("三、经度修正")
print("=" * 74)
lon_corr_min = (LON_SHANGHAI - MERIDIAN) * 4.0
print(f"上海经度 {LON_SHANGHAI}°E − 中央经线 {MERIDIAN}°E = {LON_SHANGHAI-MERIDIAN:+.4f}°")
print(f"经度时差 = {LON_SHANGHAI-MERIDIAN:+.4f} × 4 分/度 = {lon_corr_min:+.4f} 分 = {fmt_min(lon_corr_min)}")

print()
print("=" * 74)
print("四、真太阳时合成")
print("=" * 74)
clock_sec = CLOCK[0] * 3600 + CLOCK[1] * 60
total_corr_sec = (lon_corr_min + eot_m) * 60.0
tst_sec = clock_sec + total_corr_sec
print(f"真太阳时 = 10:55:00 + 经度修正 {fmt_min(lon_corr_min)} + 均时差 {fmt_min(eot_m)}")
print(f"         = {hm(tst_sec)}")
print(f"（用 NOAA 近似式则为 {hm(clock_sec + (lon_corr_min + eot_n)*60)}）")
print(f"距午时起点 11:00:00 的余量：{(tst_sec - 11*3600)/60:+.2f} 分钟")

print()
print("=" * 74)
print("五、敏感性分析：上海经度范围 × 均时差算法差异")
print("=" * 74)
pts = [
    ("上海最西（青浦区西界）", 120.85),
    ("上海西部（青浦/松江）", 121.10),
    ("上海中心（人民广场）", 121.4737),
    ("上海东部（浦东新区）", 121.60),
    ("上海最东（南汇嘴/崇明东滩）", 122.00),
]
print(f"{'假设出生地':<26}{'经度':>9}{'经度修正':>11}{'真太阳时':>12}{'距11:00':>10}  判定")
print("-" * 82)
all_wu = True
for name, lon in pts:
    sec = clock_sec + ((lon - MERIDIAN) * 4.0 + eot_m) * 60.0
    margin = (sec - 11 * 3600) / 60.0
    judge = "午时" if margin >= 0 else "巳时"
    if margin < 0:
        all_wu = False
    print(f"{name:<26}{lon:>8.4f}°{(lon-120)*4:>+10.2f}分{hm(sec):>12}{margin:>+9.2f}分  {judge}")
print("-" * 82)
print(f"结论：全上海范围内判定是否一致 → {'一致（均为午时）' if all_wu else '不一致，需精确出生点'}")

# 临界经度：求使真太阳时恰好 = 11:00:00 的经度
critical_lon = MERIDIAN + (11*3600 - clock_sec)/60.0/4.0 - eot_m/4.0
print(f"\n临界经度反解：真太阳时恰为 11:00:00 时，经度 = {critical_lon:.4f}°E")
print(f"该经度位于：{'上海以西（需更西的地方才会是巳时）' if critical_lon < 120.85 else '上海范围内'}")

print()
print("=" * 74)
print("六、均时差全年曲线关键节点（核对 9 月是否为正、量级是否合理）")
print("=" * 74)
for label, (mm, dd) in [("1/1", (1, 1)), ("2/11", (2, 11)), ("4/15", (4, 15)),
                         ("5/14", (5, 14)), ("6/13", (6, 13)), ("7/26", (7, 26)),
                         ("9/1", (9, 1)), ("9/19", (9, 19)), ("10/1", (10, 1)),
                         ("11/3", (11, 3)), ("12/25", (12, 25))]:
    jd = julian_day(Y, mm, dd, 4.0)
    e, *_ = eot_meeus(jd)
    print(f"  {label:<6} EoT = {e:+7.3f} 分")

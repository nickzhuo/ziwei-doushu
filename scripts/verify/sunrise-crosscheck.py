# -*- coding: utf-8 -*-
"""
日出日落交叉验证

太阳上中天（真太阳时正午 12:00）对应的北京时间，可以绕开均时差公式独立反推：
    TST 12:00 ≈ (日出 + 日落) / 2
它与 eot-crosscheck.py 的 EoT 结果应吻合到秒级，作为第三方旁证。

案例：公历 1983-09-19，中国上海
运行：python scripts/verify/sunrise-crosscheck.py
"""
import math, datetime

D2R = math.pi / 180.0

def julian_day(y, m, d, ut=0.0):
    if m <= 2: y -= 1; m += 12
    A = y // 100; B = 2 - A + A // 4
    return math.floor(365.25*(y+4716)) + math.floor(30.6001*(m+1)) + d + B - 1524.5 + ut/24.0

def sun_declination_and_eot(jd):
    T = (jd - 2451545.0)/36525.0
    L0 = 280.46646 + 36000.76983*T + 0.0003032*T*T
    M = 357.52911 + 35999.05029*T - 0.0001537*T*T
    Mr = M*D2R
    C = ((1.914602 - 0.004817*T - 0.000014*T*T)*math.sin(Mr)
         + (0.019993 - 0.000101*T)*math.sin(2*Mr) + 0.000289*math.sin(3*Mr))
    true_long = L0 + C
    omega = 125.04 - 1934.136*T
    omr = omega*D2R
    app_long = true_long - 0.00569 - 0.00478*math.sin(omr)
    eps0 = 23 + 26/60 + 21.448/3600 - (46.8150*T + 0.00059*T*T - 0.001813*T**3)/3600
    eps = eps0 + 0.00256*math.cos(omr)
    er = eps*D2R; lr = app_long*D2R
    alpha = math.degrees(math.atan2(math.cos(er)*math.sin(lr), math.cos(lr)))
    alpha %= 360
    dec = math.degrees(math.asin(math.sin(er)*math.sin(lr)))
    dpsi = -17.20*math.sin(omr)/3600
    E = L0 - 0.0057183 - alpha + dpsi*math.cos(er)
    E = ((E + 180) % 360) - 180
    return dec, E*4.0

def sunrise_sunset_bj(y, m, d, lon, lat, tz=8.0):
    """NOAA 日出日落，返回北京时间（小时，小数）"""
    jd = julian_day(y, m, d, 12.0 - tz)   # 当地正午的 UT
    dec, eot = sun_declination_and_eot(jd)
    # 时角
    zen = 90.833  # 含大气折射与日面半径
    latr = lat*D2R; decr = dec*D2R; zr = zen*D2R
    cosH = (math.cos(zr) - math.sin(latr)*math.sin(decr)) / (math.cos(latr)*math.cos(decr))
    if abs(cosH) > 1: return None, None, dec, eot
    H = math.degrees(math.acos(cosH))  # 度
    # 太阳正午（地方真太阳时 12:00）对应的当地平太阳时
    solar_noon_local_mean = 12.0 - eot/60.0   # 地方平太阳时(小时)
    # 地方平太阳时 → 北京时间：北京时间 = 地方平太阳时 - (lon-120)*4/60
    noon_bj = solar_noon_local_mean - (lon - 120.0)*4.0/60.0
    half = H*4.0/60.0  # 半日弧换算成小时
    return noon_bj - half, noon_bj + half, dec, eot

def hm(x):
    h = int(x); mi = (x-h)*60
    return f"{h:02d}:{mi:05.2f}"

Y, M, D = 1983, 9, 19
print("="*72)
print("日出日落交叉验证 —— 1983-09-19 上海")
print("="*72)
for name, lon, lat in [("人民广场", 121.4737, 31.2304), ("南汇嘴(最东)", 121.97, 30.88), ("青浦(最西)", 121.10, 31.15)]:
    sr, ss, dec, eot = sunrise_sunset_bj(Y, M, D, lon, lat)
    if sr is None:
        print(f"{name}: 极昼/极夜"); continue
    mid = (sr + ss)/2
    print(f"\n{name}（{lon}°E, {lat}°N）")
    print(f"  太阳赤纬 δ = {dec:+.5f}°   EoT = {eot:+.4f} 分")
    print(f"  日出(北京时间) = {hm(sr)}   日落(北京时间) = {hm(ss)}")
    print(f"  中点(太阳上中天) = {hm(mid)}  ← 应为真太阳时 12:00")
    # 理论值
    theo = 12.0 - (lon-120.0)*4.0/60.0 - eot/60.0
    print(f"  理论上中天       = {hm(theo)}   偏差 {(mid-theo)*3600:+.2f} 秒")
    print(f"  白昼长度 = {(ss-sr):.4f} 小时 = {int((ss-sr))}时{((ss-sr)%1)*60:.1f}分")

print("\n" + "="*72)
print("反推：太阳上中天 = 北京时间 11:47:5x，则北京时间 10:55 时")
print("      真太阳时 = 10:55 + (12:00 - 11:47:5x) = ?")
print("="*72)
sr, ss, dec, eot = sunrise_sunset_bj(Y, M, D, 121.4737, 31.2304)
mid = (sr+ss)/2
print(f"  上海当日上中天（北京时间）= {hm(mid)}")
print(f"  北京时间 10:55:00 距上中天 = {(mid - 10 - 55/60)*60:+.2f} 分钟")
print(f"  ⇒ 真太阳时 = 12:00:00 - {(mid-10-55/60)*60:.2f}分 = {hm(12 - (mid-10-55/60))}")
print(f"  ⇒ 距真太阳时 11:00:00 的余量 = {(12 - (mid-10-55/60) - 11)*60:+.2f} 分钟")

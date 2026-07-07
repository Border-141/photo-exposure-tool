/* ============================================================
 * 摄影曝光参数助手 · 核心逻辑
 * 器材:Sony A7 IV + SEL24-105G / 适马 100-400 DG DN OS
 * 纯本地计算,基于 EV 曝光联动:2^EV = N² / (t · S/100)
 * ============================================================ */

"use strict";

/* ---------------- 器材数据 ---------------- */

const LENSES = {
  sony: {
    name: "索尼 24-105mm F4 G",
    short: "24-105G",
    focalMin: 24, focalMax: 105,
    ibisOnly: true,
    // IBIS 约 5.5 档,保守按比传统安全快门慢 3 档计入
    stabStops: 3,
    maxAperture: () => 4,
  },
  sigma: {
    name: "适马 100-400mm F5-6.3 DG DN OS",
    short: "适马 100-400",
    focalMin: 100, focalMax: 400,
    ibisOnly: false,
    // OS 约 4 档 + IBIS 协同,保守按慢 4 档计入
    stabStops: 4,
    maxAperture: (f) => (f <= 120 ? 5 : f < 235 ? 5.6 : 6.3),
  },
};

/* ---------------- 曝光基准 ---------------- */

// 各天气对应的场景亮度 EV(以 ISO 100 为基准)
const WEATHER_EV = { sunny: 15, cloudy: 13, overcast: 12, golden: 10, night: 5 };
const WEATHER_NAME = { sunny: "晴天", cloudy: "多云", overcast: "阴天", golden: "日出日落", night: "夜晚" };
const LIGHT_ADJ = { front: 0, side: -0.3, back: -0.7 };
const LIGHT_NAME = { front: "顺光", side: "侧光", back: "逆光" };
const VIS_ADJ = { good: 0, fair: -0.3, poor: -0.7 };
const VIS_NAME = { good: "能见度良好", fair: "能见度一般", poor: "能见度较差" };

// 标准档位序列
const APERTURES = [4, 4.5, 5, 5.6, 6.3, 7.1, 8, 9, 10, 11, 13, 14, 16];
const SHUTTERS = [30, 15, 8, 4, 2, 1, 1/2, 1/4, 1/8, 1/15, 1/30, 1/60, 1/125, 1/250, 1/500, 1/1000, 1/2000, 1/4000, 1/8000];
const ISOS = [100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000, 5000, 6400, 8000, 10000, 12800, 16000, 20000, 25600, 32000, 40000, 51200];
const ISO_MAX = 51200;

/* ---------------- 曝光数学工具 ---------------- */

const isoFor = (N, t, ev) => (100 * N * N) / (t * Math.pow(2, ev));
const shutterFor = (N, iso, ev) => (100 * N * N) / (iso * Math.pow(2, ev));

function snapISO(x) {
  if (x <= 100) return 100;
  if (x >= ISO_MAX) return ISO_MAX;
  let best = ISOS[0], bd = Infinity;
  for (const s of ISOS) {
    const d = Math.abs(Math.log2(s / x));
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

function snapShutter(t) {
  let best = SHUTTERS[0], bd = Infinity;
  for (const s of SHUTTERS) {
    const d = Math.abs(Math.log2(s / t));
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

function fmtShutter(t) {
  if (t >= 1) return (Math.round(t * 10) / 10) + "s";
  return "1/" + Math.round(1 / t) + "s";
}

function fmtAperture(n) {
  return "f/" + (Number.isInteger(n) ? n : n.toFixed(1).replace(/\.0$/, ""));
}

// 手持安全快门(可用的最长曝光时间,单位秒)
// 基础 1/焦距,叠加防抖补偿档数,并设 1/8s 的现实上限
function handheldLimit(lensKey, focal, extraStrictStops = 0) {
  const lens = LENSES[lensKey];
  const stops = Math.max(lens.stabStops - extraStrictStops, 0);
  const t = (1 / focal) * Math.pow(2, stops);
  return Math.min(t, 1 / 8);
}

// 在光线过亮(ISO 需求明显低于 100)时:先收缩光圈到 nCap,再加快快门到 tFastest
// 留 1/3 档容差,避免为一点点过曝就跳一整档
function absorbBrightness(N, t, ev, nCap, tFastest) {
  while (isoFor(N, t, ev) < 80) {
    const idx = APERTURES.indexOf(N);
    if (idx >= 0 && idx < APERTURES.length - 1 && APERTURES[idx + 1] <= nCap) {
      N = APERTURES[idx + 1];
      continue;
    }
    const si = SHUTTERS.indexOf(t);
    if (si >= 0 && si < SHUTTERS.length - 1 && SHUTTERS[si + 1] >= tFastest) {
      t = SHUTTERS[si + 1];
      continue;
    }
    break;
  }
  return { N, t };
}

/* ============================================================
 * 推荐计算主函数
 * ============================================================ */

function calculate(a) {
  const lens = LENSES[a.lens];
  const ev = WEATHER_EV[a.weather] + LIGHT_ADJ[a.light] + VIS_ADJ[a.vis];
  const dim = ev <= 12.5; // 光线不足判定(用于适马镜头提示)

  const r = {
    aperture: "", apertureSub: "",
    shutter: "", shutterSub: "",
    iso: "", isoSub: "",
    reason: "",
    tips: [],
    isoValue: 100,
  };

  const envDesc = `${WEATHER_NAME[a.weather]} · ${LIGHT_NAME[a.light]} · ${VIS_NAME[a.vis]}`;
  r.envDesc = envDesc;

  // 场景分支
  if (a.scene === "aircraft") calcAircraft(a, lens, ev, r);
  else if (a.scene === "portrait") calcPortrait(a, lens, ev, r);
  else if (a.scene === "landscape") calcLandscape(a, lens, ev, r);
  else if (a.scene === "night") calcNight(a, lens, ev, r);
  else calcStill(a, lens, ev, r);

  /* ---- 通用附加提示(按需求文档触发条件) ---- */
  if (r.isoValue > 3200) {
    r.tips.push({ warn: true, text: "推荐 ISO 已超过 3200,高感噪点明显。拍摄时留意直方图向右曝光,后期可用降噪软件(如 DxO / Lightroom AI 降噪)处理。" });
  }
  if (a.lens === "sigma" && dim) {
    r.tips.push({ warn: false, text: "适马 100-400 最大光圈只有 f/5-6.3,光线不足时 ISO 偏高是正常现象,不是参数没调好——这是这支镜头的物理限制。" });
  }
  if (a.light === "back") {
    r.tips.push({ warn: false, text: "逆光拍摄建议增加约 +0.7EV 曝光补偿,否则主体容易拍成剪影;若想要剪影效果则反向减曝光。" });
  }
  if (a.vis === "poor") {
    r.tips.push({ warn: false, text: "雾霾/能见度差时画面对比度会下降,可适当增加曝光并在后期拉对比度、去雾。" });
  }

  return r;
}

/* ---------------- 场景:飞机拍摄 ---------------- */

function calcAircraft(a, lens, ev, r) {
  const focal = a.focal;
  const maxAp = lens.maxAperture(focal);

  if (a.airState === "static") {
    // 静态:地面/停机坪,快门服从防抖即可,光圈优先画质
    let N = 8, t = 1 / 500;
    let iso = isoFor(N, t, ev);
    if (iso < 100) {
      ({ N, t } = absorbBrightness(N, t, ev, 11, 1 / 2000));
      iso = Math.max(isoFor(N, t, ev), 100);
    } else if (iso > 800) {
      // 光线不足:开大光圈
      N = maxAp;
      iso = isoFor(N, t, ev);
      // 仍然太高:放慢快门,但不慢于防抖安全快门
      const limit = handheldLimit(a.lens, focal);
      while (iso > 1600) {
        const si = SHUTTERS.indexOf(t);
        if (si > 0 && SHUTTERS[si - 1] <= limit) { t = SHUTTERS[si - 1]; iso = isoFor(N, t, ev); }
        else break;
      }
    }
    const isoV = snapISO(iso);
    r.aperture = fmtAperture(N);
    r.apertureSub = N === maxAp ? "当前焦段最大光圈" : "兼顾锐度与景深";
    r.shutter = fmtShutter(t);
    r.shutterSub = "静态目标 · 防抖辅助";
    r.iso = "ISO " + isoV;
    r.isoValue = isoV;
    r.reason = `静态飞机对快门要求不高,${N >= 8 ? "光线允许时收缩到 f/8 提升镜头锐度" : "光线有限,优先开大光圈压低 ISO"};快门在防抖(${a.lens === "sigma" ? "OS+IBIS 协同约 4-5 档" : "IBIS 约 5.5 档"})保障下留有余量。`;
    return;
  }

  // 动态追焦
  const propBlur = a.airType === "prop" && a.propBlur === "yes";
  let N = maxAp, t, iso;

  if (propBlur) {
    // 螺旋桨带转动虚影:1/60-1/250 区间,取 1/125 为推荐中值
    t = 1 / 125;
    iso = isoFor(N, t, ev);
    if (iso < 100) {
      // 慢快门进光多,先收光圈提锐度,再允许快门升到 1/250
      ({ N, t } = absorbBrightness(N, t, ev, 11, 1 / 250));
      iso = Math.max(isoFor(N, t, ev), 100);
    }
    const isoV = snapISO(iso);
    r.aperture = fmtAperture(N);
    r.apertureSub = N === maxAp ? "当前焦段最大光圈" : "光线充足,收缩提升锐度";
    r.shutter = fmtShutter(t);
    r.shutterSub = "1/60–1/250 区间可调";
    r.iso = "ISO " + isoV;
    r.isoValue = isoV;
    r.reason = `螺旋桨机希望桨叶带转动虚影,快门刻意压低到 ${fmtShutter(t)}(1/60–1/250 区间);机身清晰依赖稳定的摇摄跟随,光圈和 ISO 按曝光联动补足。`;
    r.tips.push({ warn: false, text: "慢门追螺旋桨机成功率不高,建议连拍多张;摇摄时保持与飞机同速转动,快门释放后继续跟随(follow through)。" });
  } else {
    // 喷气式 / 桨叶也要清晰:快门下限 1/1000s,凝固主体优先于防抖
    t = 1 / 1000;
    iso = isoFor(N, t, ev);
    if (iso < 100) {
      // 光线充裕:先收缩到 f/8 提升锐度,再加快快门
      ({ N, t } = absorbBrightness(N, t, ev, 8, 1 / 4000));
      iso = Math.max(isoFor(N, t, ev), 100);
    }
    const isoV = snapISO(Math.max(iso, 100));
    r.aperture = fmtAperture(N);
    r.apertureSub = N === maxAp ? "当前焦段最大光圈" : "光线有余量,收缩到 f/8 提升锐度";
    r.shutter = fmtShutter(t);
    r.shutterSub = "凝固机身 ≥1/1000s";
    r.iso = "ISO " + isoV;
    r.isoValue = isoV;
    r.reason = `动态追焦时快门下限首先由"凝固飞机"决定(${a.airType === "prop" ? "桨叶也要清晰,按喷气式逻辑" : "喷气式参考 1/1000s"}),其次才考虑防抖;光圈${N === maxAp ? `锁定当前焦段最大 ${fmtAperture(N)}` : `收缩到 ${fmtAperture(N)}`},ISO 最后补足曝光。`;
    if (isoV > 6400) {
      r.tips.push({ warn: true, text: `当前光线下凝固快门需要 ISO ${isoV},已超出稳妥区间。可考虑等光线更好时再拍,或接受一定画质损失。` });
    }
  }

  // 追焦通用技巧提示
  r.tips.push({ warn: false, text: "追焦建议:AF-C 连续对焦 + 广域/跟踪对焦区域,连拍 Hi+;用整个上半身转动跟随飞机,而不是只转手腕。" });

  if (a.lens === "sigma") {
    r.apertureSub += ` · ${focal}mm 端最大 ${fmtAperture(lens.maxAperture(focal))}`;
  }
}

/* ---------------- 场景:人像 ---------------- */

function calcPortrait(a, lens, ev, r) {
  const focal = a.lens === "sony" ? 85 : 135; // 典型人像焦段假设
  const maxAp = lens.maxAperture(focal);
  const bokeh = a.porGoal === "bokeh";

  // 光圈:虚化 → 最大光圈;环境人像 → f/5.6-f/8(光线差时退到 f/5.6)
  let N = bokeh ? maxAp : 8;
  // 快门下限:人物微动作需要 ≥1/125(特写景深极浅,快门更稳用 1/250)
  // 注意必须取标准档位值,否则过亮回收无法继续加快快门
  let tMin = a.porDist === "closeup" ? 1 / 250 : 1 / 125;
  let t = tMin;
  let iso = isoFor(N, t, ev);

  if (!bokeh && iso > 1600) {
    N = 5.6; // 环境人像光线不足时退到 f/5.6
    iso = isoFor(N, t, ev);
  }
  if (iso < 100) {
    ({ N, t } = absorbBrightness(N, t, ev, bokeh ? N : 8, 1 / 4000));
    iso = Math.max(isoFor(N, t, ev), 100);
  }
  const isoV = snapISO(iso);

  r.aperture = fmtAperture(N);
  r.apertureSub = bokeh ? "最大光圈 · 优先虚化" : "f/5.6–f/8 · 人和环境都清晰";
  r.shutter = fmtShutter(t);
  r.shutterSub = "凝固人物微动作";
  r.iso = "ISO " + isoV;
  r.isoValue = isoV;

  const distName = { closeup: "近景特写", half: "中距离半身", full: "全身" }[a.porDist];
  r.reason = bokeh
    ? `突出人物虚化背景:光圈开到当前镜头最大 ${fmtAperture(N)},${distName}构图下快门保持 ${fmtShutter(t)} 以上凝固表情动作,ISO 按曝光联动补足。`
    : `环境人像需要人和背景都清晰:光圈收缩到 ${fmtAperture(N)} 保证景深,快门 ${fmtShutter(t)} 防止人物动作模糊,ISO 补足曝光。`;

  if (bokeh) {
    if (a.lens === "sony") {
      r.tips.push({ warn: false, text: "24-105G 最大光圈 f/4,虚化效果有限。想加强虚化:用 105mm 长焦端、让人物远离背景、尽量靠近拍摄。" });
    } else {
      r.tips.push({ warn: false, text: "适马 100-400 光圈虽小,但长焦端的空间压缩能带来不错的背景虚化——退远用 200mm+ 拍,注意快门要跟上焦距。" });
    }
  }
  if (a.porDist === "closeup") {
    r.tips.push({ warn: false, text: "近景特写时景深很浅,建议对焦锁定眼部(开启眼部对焦 Eye-AF)。" });
  }
}

/* ---------------- 场景:风光 ---------------- */

function calcLandscape(a, lens, ev, r) {
  const focal = a.lens === "sony" ? 35 : 100;
  const maxAp = lens.maxAperture(focal);
  const bigDof = a.landDof === "yes";
  const tripod = a.landSupport === "tripod";

  let N = bigDof ? 8 : (a.lens === "sony" ? maxAp : 5.6);
  let t, iso;

  if (tripod) {
    // 三脚架:ISO 压到最低,快门自由
    iso = 100;
    t = snapShutter(shutterFor(N, iso, ev));
    if (bigDof && ev >= 14) N = 11; // 光线极好时用 f/11 加深景深
    t = snapShutter(shutterFor(N, iso, ev));
    r.shutterSub = "三脚架 · 快门不受限";
  } else {
    const limit = handheldLimit(a.lens, focal);
    t = Math.min(1 / 60, limit); // 手持基准
    iso = isoFor(N, t, ev);
    if (iso < 100) {
      // 大景深允许收到 f/11;突出焦点时保持光圈不动,只加快快门
      ({ N, t } = absorbBrightness(N, t, ev, bigDof ? 11 : N, 1 / 2000));
      iso = Math.max(isoFor(N, t, ev), 100);
    } else if (iso > 3200 && bigDof) {
      // 光线不足:先放慢到防抖极限,再考虑开大光圈
      t = snapShutter(limit);
      iso = isoFor(N, t, ev);
      if (iso > 3200) { N = maxAp; iso = isoFor(N, t, ev); }
    }
    r.shutterSub = "手持 · 防抖辅助下限";
  }
  const isoV = snapISO(iso);

  r.aperture = fmtAperture(N);
  r.apertureSub = bigDof ? "f/8–f/11 最佳锐度区间" : "突出焦点 · 适度浅景深";
  r.shutter = fmtShutter(t);
  r.iso = "ISO " + isoV;
  r.isoValue = isoV;

  r.reason = bigDof
    ? `风光大景深:光圈收到 ${fmtAperture(N)}(f/8–f/11 是镜头最佳锐度区间),${tripod ? "有三脚架,ISO 压到 100 换取最干净画质,快门放开" : "手持拍摄,快门守住防抖安全线"},ISO 联动补足。`
    : `只想突出某个焦点:光圈相对开大到 ${fmtAperture(N)} 做前后景分离,${tripod ? "三脚架下 ISO 保持最低" : "快门保证手持稳定"}。`;

  if (bigDof) {
    r.tips.push({ warn: false, text: "不建议收缩到 f/16 以上——衍射会让整体锐度下降,f/8–f/11 已能覆盖绝大多数风光景深需求。" });
  }
  if (tripod && t >= 1 / 30) {
    r.tips.push({ warn: false, text: "上三脚架后建议关闭镜头/机身防抖,用 2 秒延时或快门线避免按快门时的震动。" });
  }
}

/* ---------------- 场景:夜景/城市夜拍 ---------------- */

function calcNight(a, lens, ev, r) {
  const focal = a.lens === "sony" ? 35 : 100;
  const maxAp = lens.maxAperture(focal);
  const tripod = a.nightTripod === "yes";
  const wantTrail = a.nightSubject === "traffic" && a.nightTrail === "yes";

  let N, t, iso;

  if (tripod) {
    iso = 100;
    if (wantTrail) {
      // 车流轨迹:目标 8-30s 长曝光
      N = 11;
      t = shutterFor(N, iso, ev);
      if (t < 8) {
        N = 16;
        t = shutterFor(N, iso, ev);
        if (t < 8) {
          r.tips.push({ warn: false, text: "当前环境偏亮,f/16 也达不到 8 秒以上——可加 ND 减光镜,或等天色更暗、用多张短曝光后期堆栈车流。" });
        } else {
          r.tips.push({ warn: false, text: "为凑足长曝光收到了 f/16,会有轻微衍射锐度损失,属于可接受的取舍。" });
        }
      }
      t = snapShutter(Math.min(t, 30));
      r.shutterSub = "长曝光 · 拉出车流轨迹";
      r.reason = `车流轨迹需要 8–30 秒长曝光:三脚架 + ISO 100 + 小光圈 ${fmtAperture(N)},让车灯在画面中拖出光轨,静止的建筑保持清晰。`;
    } else {
      N = 8;
      t = snapShutter(Math.min(shutterFor(N, iso, ev), 30));
      r.shutterSub = "三脚架 · 慢门无压力";
      r.reason = `夜景有三脚架是最优解:ISO 压到 100 获得最干净画质,光圈 f/8 保证建筑群景深和星芒效果,快门放慢到 ${fmtShutter(t)} 补足曝光。`;
    }
    r.tips.push({ warn: false, text: "三脚架上关闭防抖,用 2 秒延时/快门线;建议拍 RAW,夜景动态范围大,后期空间重要。" });
  } else {
    // 手持夜景
    N = maxAp;
    if (a.nightSubject === "traffic") {
      // 有人流车流且要"凝住"人:快门不能太慢
      t = 1 / 125;
      r.shutterSub = "凝固行人动作";
    } else {
      // 天际线/建筑静态:可用防抖极限慢门
      t = snapShutter(handheldLimit(a.lens, focal));
      r.shutterSub = "IBIS 极限手持慢门";
    }
    iso = isoFor(N, t, ev);
    if (iso < 100) iso = 100;
    r.reason = a.nightSubject === "traffic"
      ? `手持夜拍人流车流:快门必须守住 ${fmtShutter(t)} 才能凝住行人,光圈开到最大 ${fmtAperture(N)},剩下全靠 ISO 扛——这是无脚架夜拍的物理现实。`
      : `手持拍夜景天际线:建筑是静态的,借助 IBIS 把快门压到 ${fmtShutter(t)},光圈开到最大 ${fmtAperture(N)},尽量少抬 ISO。`;
    r.tips.push({ warn: false, text: "手持慢快门拍摄建议开启防抖并屏住呼吸,双肘夹紧身体,或者找栏杆、墙面等稳定支撑点;连拍 3 张挑最清晰的一张。" });
    if (wantTrail || (a.nightSubject === "traffic" && a.nightTrail === "yes")) {
      r.tips.push({ warn: true, text: "想拍车流轨迹但没有三脚架:手持无法完成秒级长曝光,强烈建议携带三脚架,或将相机放在稳固平面上用延时快门。" });
    }
  }

  const isoV = snapISO(iso);
  r.aperture = fmtAperture(N);
  r.apertureSub = tripod ? "小光圈 · 景深与星芒" : "最大光圈 · 优先进光";
  r.shutter = fmtShutter(t);
  r.iso = "ISO " + isoV;
  r.isoValue = isoV;

  if (a.lens === "sigma") {
    r.tips.push({ warn: false, text: "夜景更推荐用 24-105G(f/4 + 广角端更适合城市题材);适马 100-400 夜拍进光吃亏,除非特意拍远处特写。" });
  }
}

/* ---------------- 场景:静物/模型摄影 ---------------- */

function calcStill(a, lens, ev, r) {
  const focal = a.lens === "sony" ? 90 : 150;
  const macro = a.stillMacro === "yes";
  const bigDof = a.stillDof === "yes";
  const tripod = a.stillSupport === "yes";

  let N = bigDof ? 10 : 8; // 大景深 f/8-f/11,取 f/10;一般也建议 f/8 保证锐度
  if (!bigDof && a.lens === "sony") N = 5.6; // 想要浅景深突出局部
  let t, iso;

  if (tripod) {
    iso = 100;
    t = snapShutter(Math.min(shutterFor(N, iso, ev), 30));
    r.shutterSub = "三脚架 · 快门不受限";
  } else {
    // 手持近摄:防抖收益打折,安全快门更严格
    const limit = macro ? Math.min(handheldLimit(a.lens, focal, 2), 1 / 60) : handheldLimit(a.lens, focal);
    t = snapShutter(limit);
    iso = isoFor(N, t, ev);
    if (iso < 100) {
      ({ N, t } = absorbBrightness(N, t, ev, 11, 1 / 500));
      iso = Math.max(isoFor(N, t, ev), 100);
    }
    r.shutterSub = macro ? "近摄手持 · 安全快门更严格" : "手持 · 防抖辅助";
  }
  const isoV = snapISO(iso);

  r.aperture = fmtAperture(N);
  r.apertureSub = bigDof ? "f/8–f/11 · 模型整体清晰" : "适度光圈 · 突出主体局部";
  r.shutter = fmtShutter(t);
  r.iso = "ISO " + isoV;
  r.isoValue = isoV;

  r.reason = bigDof
    ? `模型/静物整体清晰需要大景深:光圈收到 ${fmtAperture(N)},${tripod ? "三脚架下 ISO 锁定 100,快门随曝光需要放慢" : "手持时快门守住安全线,ISO 联动补足"}。`
    : `突出模型局部细节:光圈 ${fmtAperture(N)} 做适度景深分离,${tripod ? "三脚架保证 ISO 最低画质最干净" : "快门优先保证手持清晰"}。`;

  if (macro) {
    r.tips.push({ warn: false, text: "近摄距离越近,景深越浅——即使收到 f/11,可能也只有几毫米清晰范围;必要时可拍多张不同对焦点做景深堆栈合成。" });
    if (!tripod) {
      r.tips.push({ warn: true, text: "近摄场景防抖要求更高,强烈建议使用三脚架或稳定支撑;手持近摄时轻微前后晃动就会脱焦,安全快门按更严格标准执行。" });
    }
  }
  if (tripod) {
    r.tips.push({ warn: false, text: "静物是三脚架的主场:关防抖、延时快门、手动对焦放大确认,慢慢打磨布光比参数更重要。" });
  }
}

/* ============================================================
 * 交互流程(向导式,每步一屏)
 * ============================================================ */

const answers = {};

const STEPS = [
  {
    id: "lens", label: "STEP · 器材", title: "选择镜头",
    hint: "机身固定为 Sony A7 IV",
    options: [
      { value: "sony", text: "索尼 24-105mm F4 G", desc: "恒定 f/4 · 人像/风光/静物/夜景通用" },
      { value: "sigma", text: "适马 100-400mm F5-6.3", desc: "浮动光圈 · 自带 OS 防抖 · 飞机主力" },
    ],
  },
  {
    id: "scene", label: "STEP · 场景", title: "拍什么?",
    options: [
      { value: "aircraft", text: "✈️ 飞机拍摄", desc: "停机坪静态或空中追焦" },
      { value: "portrait", text: "👤 人像", desc: "虚化人像或环境人像" },
      { value: "landscape", text: "🏔️ 风光", desc: "大景深或突出焦点" },
      { value: "night", text: "🌃 夜景 / 城市夜拍", desc: "天际线、车流、夜间街头" },
      { value: "still", text: "🧸 静物 / 模型摄影", desc: "含近摄微距细节" },
    ],
  },
  /* --- 飞机 --- */
  {
    id: "airState", label: "飞机 · 状态", title: "拍摄状态",
    cond: (a) => a.scene === "aircraft",
    options: [
      { value: "static", text: "静态", desc: "停机坪 / 地面展示" },
      { value: "dynamic", text: "动态追焦", desc: "空中飞行 / 起降" },
    ],
  },
  {
    id: "airType", label: "飞机 · 机型", title: "机型类型",
    cond: (a) => a.scene === "aircraft" && a.airState === "dynamic",
    options: [
      { value: "jet", text: "喷气式", desc: "客机 / 军机,目标机身完全清晰" },
      { value: "prop", text: "螺旋桨飞机", desc: "桨叶效果另有选择" },
    ],
  },
  {
    id: "propBlur", label: "飞机 · 桨叶", title: "是否希望螺旋桨带一点转动模糊效果?",
    hint: "带虚影更有动感,但摇摄难度更高",
    cond: (a) => a.scene === "aircraft" && a.airState === "dynamic" && a.airType === "prop",
    options: [
      { value: "yes", text: "要转动虚影", desc: "快门压到 1/60–1/250,更有动感" },
      { value: "no", text: "桨叶也要清晰", desc: "按喷气式逻辑,快门 ≥1/1000s" },
    ],
  },
  {
    id: "focal", label: "飞机 · 焦距", title: "大概用多少焦距?",
    hint: "用于计算安全快门和当前焦段最大光圈",
    cond: (a) => a.scene === "aircraft",
    type: "slider",
  },
  /* --- 人像 --- */
  {
    id: "porGoal", label: "人像 · 目的", title: "拍摄目的",
    cond: (a) => a.scene === "portrait",
    options: [
      { value: "bokeh", text: "突出人物,虚化背景", desc: "光圈开到最大" },
      { value: "env", text: "环境人像", desc: "人和背景都要清晰,f/5.6–f/8" },
    ],
  },
  {
    id: "porDist", label: "人像 · 距离", title: "拍摄距离",
    cond: (a) => a.scene === "portrait",
    options: [
      { value: "closeup", text: "近景特写", desc: "面部/半胸,景深最浅" },
      { value: "half", text: "中距离半身" },
      { value: "full", text: "全身" },
    ],
  },
  /* --- 风光 --- */
  {
    id: "landDof", label: "风光 · 景深", title: "需要前后景都清晰吗?",
    cond: (a) => a.scene === "landscape",
    options: [
      { value: "yes", text: "是,大景深", desc: "经典风光,f/8–f/11" },
      { value: "no", text: "否,突出某个焦点", desc: "适度浅景深分离主体" },
    ],
  },
  {
    id: "landSupport", label: "风光 · 支撑", title: "手持还是三脚架?",
    cond: (a) => a.scene === "landscape",
    options: [
      { value: "tripod", text: "三脚架", desc: "快门不受限,ISO 可压到最低" },
      { value: "hand", text: "手持", desc: "快门受安全快门限制" },
    ],
  },
  /* --- 夜景 --- */
  {
    id: "nightTripod", label: "夜景 · 支撑", title: "有三脚架吗?",
    hint: "这直接决定 ISO 策略",
    cond: (a) => a.scene === "night",
    options: [
      { value: "yes", text: "有三脚架", desc: "低 ISO + 慢快门,画质最优" },
      { value: "no", text: "没有,手持", desc: "靠提高 ISO 保证不糊" },
    ],
  },
  {
    id: "nightSubject", label: "夜景 · 对象", title: "拍摄对象",
    cond: (a) => a.scene === "night",
    options: [
      { value: "skyline", text: "城市天际线 / 建筑", desc: "偏静态,可以慢快门" },
      { value: "traffic", text: "夜间人流车流", desc: "动态元素" },
    ],
  },
  {
    id: "nightTrail", label: "夜景 · 车流", title: "需要车流轨迹效果吗?",
    cond: (a) => a.scene === "night" && a.nightSubject === "traffic",
    options: [
      { value: "yes", text: "要光轨", desc: "长曝光拉出车灯轨迹" },
      { value: "no", text: "不要,凝固画面", desc: "快门保持较快" },
    ],
  },
  /* --- 静物 --- */
  {
    id: "stillMacro", label: "静物 · 距离", title: "是近摄 / 微距吗?",
    hint: "比如拍模型细节",
    cond: (a) => a.scene === "still",
    options: [
      { value: "yes", text: "是,近摄/微距", desc: "景深极浅,防抖要求高" },
      { value: "no", text: "否,常规距离" },
    ],
  },
  {
    id: "stillDof", label: "静物 · 景深", title: "需要大景深吗?",
    hint: "模型整体都清晰是常见需求",
    cond: (a) => a.scene === "still",
    options: [
      { value: "yes", text: "是,整体清晰", desc: "f/8–f/11" },
      { value: "no", text: "否,突出局部" },
    ],
  },
  {
    id: "stillSupport", label: "静物 · 支撑", title: "有三脚架或稳定支撑吗?",
    cond: (a) => a.scene === "still",
    options: [
      { value: "yes", text: "有", desc: "低 ISO 慢工出细活" },
      { value: "no", text: "没有,手持" },
    ],
  },
  /* --- 环境条件(所有场景) --- */
  {
    id: "weather", label: "环境 · 天气", title: "现在的天气?",
    options: [
      { value: "sunny", text: "☀️ 晴天" },
      { value: "cloudy", text: "⛅ 多云" },
      { value: "overcast", text: "☁️ 阴天" },
      { value: "golden", text: "🌅 日出日落" },
      { value: "night", text: "🌙 夜晚" },
    ],
  },
  {
    id: "light", label: "环境 · 光向", title: "光线方向?",
    options: [
      { value: "front", text: "顺光", desc: "光从身后照向主体" },
      { value: "side", text: "侧光", desc: "立体感强" },
      { value: "back", text: "逆光", desc: "注意主体易成剪影" },
    ],
  },
  {
    id: "vis", label: "环境 · 能见度", title: "能见度?",
    options: [
      { value: "good", text: "良好" },
      { value: "fair", text: "一般" },
      { value: "poor", text: "较差", desc: "雾霾 / 沙尘等" },
    ],
  },
];

/* ---------------- 渲染 ---------------- */

const appEl = document.getElementById("app");
const progressEl = document.getElementById("progress");
const btnBack = document.getElementById("btn-back");
const btnRestart = document.getElementById("btn-restart");

let stepIndex = 0; // 当前在可见步骤序列中的位置

function visibleSteps() {
  return STEPS.filter((s) => !s.cond || s.cond(answers));
}

function renderProgress(current, total, done) {
  progressEl.innerHTML = "";
  for (let i = 0; i < total; i++) {
    const seg = document.createElement("div");
    seg.className = "seg" + (done || i <= current ? " done" : "");
    progressEl.appendChild(seg);
  }
}

function render() {
  const steps = visibleSteps();
  if (stepIndex >= steps.length) { renderResult(); return; }

  const step = steps[stepIndex];
  renderProgress(stepIndex, steps.length + 1, false);
  btnBack.hidden = stepIndex === 0;
  btnRestart.hidden = stepIndex === 0;

  const wrap = document.createElement("div");
  wrap.className = "step";
  wrap.innerHTML = `
    <div class="step-label">${step.label}</div>
    <div class="step-title">${step.title}</div>
    ${step.hint ? `<div class="step-hint">${step.hint}</div>` : `<div class="step-hint"></div>`}
  `;

  if (step.type === "slider") {
    const lens = LENSES[answers.lens];
    const min = lens.focalMin, max = lens.focalMax;
    const init = answers.focal && answers.focal >= min && answers.focal <= max
      ? answers.focal
      : (answers.lens === "sigma" ? 400 : max);
    const box = document.createElement("div");
    box.className = "slider-box";
    box.innerHTML = `
      <div class="slider-value"><span id="focal-val">${init}</span><small> mm</small></div>
      <div class="slider-aperture" id="focal-ap"></div>
      <input type="range" id="focal-range" min="${min}" max="${max}" step="1" value="${init}">
      <div class="slider-marks"><span>${min}mm</span><span>${max}mm</span></div>
    `;
    wrap.appendChild(box);

    const btn = document.createElement("button");
    btn.className = "btn-primary";
    btn.textContent = "确认焦距 →";
    wrap.appendChild(btn);

    appEl.innerHTML = "";
    appEl.appendChild(wrap);

    const range = box.querySelector("#focal-range");
    const valEl = box.querySelector("#focal-val");
    const apEl = box.querySelector("#focal-ap");
    const updateAp = () => {
      const f = Number(range.value);
      valEl.textContent = f;
      apEl.textContent = `该焦段最大光圈 ${fmtAperture(lens.maxAperture(f))} · 传统安全快门约 1/${f}s`;
    };
    updateAp();
    range.addEventListener("input", updateAp);
    btn.addEventListener("click", () => {
      answers.focal = Number(range.value);
      stepIndex++;
      render();
    });
    return;
  }

  const opts = document.createElement("div");
  opts.className = "options";
  for (const o of step.options) {
    const b = document.createElement("button");
    b.className = "opt" + (answers[step.id] === o.value ? " selected" : "");
    b.innerHTML = o.text + (o.desc ? `<span class="opt-desc">${o.desc}</span>` : "");
    b.addEventListener("click", () => {
      answers[step.id] = o.value;
      stepIndex++;
      render();
    });
    opts.appendChild(b);
  }
  wrap.appendChild(opts);
  appEl.innerHTML = "";
  appEl.appendChild(wrap);
}

function renderResult() {
  const steps = visibleSteps();
  renderProgress(steps.length, steps.length + 1, true);
  btnBack.hidden = false;
  btnRestart.hidden = false;

  const r = calculate(answers);
  const lens = LENSES[answers.lens];
  const sceneName = { aircraft: "飞机拍摄", portrait: "人像", landscape: "风光", night: "夜景/城市夜拍", still: "静物/模型" }[answers.scene];

  const wrap = document.createElement("div");
  wrap.className = "step";
  wrap.innerHTML = `
    <div class="result-head">
      <div class="rec-tag">推荐参数</div>
      <div class="rec-scene">${lens.short} · ${sceneName}${answers.focal && answers.scene === "aircraft" ? " · " + answers.focal + "mm" : ""}<br>${r.envDesc}</div>
    </div>
    <div class="dials">
      <div class="dial">
        <div class="dial-label">光圈 AV</div>
        <div class="dial-value">${r.aperture}</div>
        <div class="dial-sub">${r.apertureSub}</div>
      </div>
      <div class="dial">
        <div class="dial-label">快门 TV</div>
        <div class="dial-value">${r.shutter}</div>
        <div class="dial-sub">${r.shutterSub}</div>
      </div>
      <div class="dial">
        <div class="dial-label">感光度</div>
        <div class="dial-value">${r.iso}</div>
        <div class="dial-sub">${r.isoSub || "曝光联动计算"}</div>
      </div>
    </div>
    <div class="reason-card">
      <div class="reason-title">为什么这么选</div>
      ${r.reason}
    </div>
    <div class="tips">
      ${r.tips.map((t) => `
        <div class="tip${t.warn ? " warn" : ""}">
          <span class="tip-icon">${t.warn ? "⚠️" : "💡"}</span>
          <span>${t.text}</span>
        </div>`).join("")}
    </div>
  `;
  appEl.innerHTML = "";
  appEl.appendChild(wrap);
}

btnBack.addEventListener("click", () => {
  if (stepIndex > 0) { stepIndex--; render(); }
});
btnRestart.addEventListener("click", () => {
  for (const k of Object.keys(answers)) delete answers[k];
  stepIndex = 0;
  render();
});

render();

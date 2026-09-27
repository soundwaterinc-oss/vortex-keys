// EL-SYSTEMA ─ 刺激（ASSR）レイヤー／全楽器共通の「独立した並列の声」
//
// ★設計原理（control.js に同じ）: 既存器の音源・UI を一切変えない＝「足すだけ」。
//   刺激層は自前のオシレータを持ち、自前で変調し、outputNode(=器の master bus)へ
//   connect するだけ。fx.output と並列に足すので **リバーブ/ディレイを通らない**。
//   灯 を消せば disconnect され、器は完全に元通り鳴る。
//
// 使い方（器の登録直後に併用）:
//   const leaf = window.registerElSystemaInstrument({...});  // 既存
//   const stim = window.registerElSystemaStimulus({
//     id: "hado-field",
//     audioContext: audio.ctx,
//     outputNode:   audio.masterOut,   // ここへ「足すだけ」
//     transport:    leaf.transport,    // 任意（maneki 受信に使う。無くても動く）
//     role:         "anchor" | "field" // 任意（無ければ URL ?anchor / ?role= から判定）
//   });
//   // 器の setParam 側で: 祭祀語彙(灯/脈.*/息.*/眠.量/体.量/刻.差) を stim.setParam へ委譲
//
// 役割: anchor(1台) = 脈(40Hz)+眠(0.8Hz)+息  /  field = 息(0.1Hz) のみ。
// 息の位相同期: maneki{guise,startAt(epoch)} で基準時刻を配り、各ノードが
//   自分の AudioContext 時刻へ変換して AudioParam オートメーションで先行スケジュール
//   （rAF/relay-ramp は使わない＝画面ロックで止まらない）。

(function (root) {
  "use strict";
  var Shapes = root.ElSystemaShapes || null;
  function nowMs() { return Shapes ? Shapes.nowMs() : Date.now(); }
  function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }

  function parseRole() {
    try {
      var q = new URLSearchParams(location.search);
      if (/(^|[?&#])anchor/.test(location.href)) return "anchor";
      var r = q.get("role"); if (r === "anchor" || r === "field") return r;
    } catch (e) {}
    return "field";
  }

  // 4:6 非対称の呼吸カーブ（吸気=前40%で上昇、呼気=後60%で下降）。cutoff(Hz)の配列。
  function breathCurve(N, loHz, hiHz) {
    var c = new Float32Array(N);
    for (var i = 0; i < N; i++) {
      var ph = i / (N - 1), env;
      if (ph < 0.4) env = 0.5 - 0.5 * Math.cos(Math.PI * (ph / 0.4));        // 吸気↑
      else env = 0.5 + 0.5 * Math.cos(Math.PI * ((ph - 0.4) / 0.6));         // 呼気↓
      c[i] = loHz * Math.pow(hiHz / loHz, env);                              // 対数補間
    }
    return c;
  }

  // ピンクノイズ（Paul Kellet 近似）1バッファ
  function pinkBuffer(ctx, sec) {
    var n = Math.ceil((ctx.sampleRate || 48000) * (sec || 1)), buf = ctx.createBuffer(1, n, ctx.sampleRate || 48000), d = buf.getChannelData(0);
    var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (var i = 0; i < n; i++) {
      var w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856; b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
    }
    return buf;
  }

  // 楽器別プロファイル＝仕様マトリクスの実行形。灯を押すと各器が自分に適した刺激で点く。
  // 値: 脈=40γ深度 / 息=呼吸深度 / 眠=徐波量 / 相[Hz,深度] / 揺=SR量 / 律[BPM,量] / 体=身体量
  var PROFILES = {
    "hado-field":     { 脈: 0.8, 息: 0.6 },
    "planarian-drone":{ 脈: 0.8, 息: 0.6 },
    "hado-beat":      { 律: [110, 0.5], 脈: 0.6, 息: 0.4 },
    "stone-beats":    { 律: [100, 0.5], 脈: 0.5 },
    "mycorrhiza-beat":{ 律: [110, 0.5], 脈: 0.5 },
    "hado-hen":       { 律: [120, 0.5], 揺: 0.12 },
    "hado-dust":      { 揺: 0.25, 眠: 0.4 },
    "particle-noise": { 揺: 0.25, 眠: 0.4, 息: 0.4 },
    "cellnoise":      { 揺: 0.25, 眠: 0.4, 息: 0.4 },
    "hado-ori":       { 相: [10, 0.6], 息: 0.6 },
    "tsuki-sound":    { 相: [6, 0.6], 息: 0.6 },
    "saya-sound":     { 相: [10, 0.5], 息: 0.5 },
    "ocean":          { 息: 0.7, 眠: 0.4 },
    "moss-reservoir": { 息: 0.6, 眠: 0.3 },
    "kagome":         { 相: [10, 0.5], 息: 0.5 },
    "phyllo":         { 相: [10, 0.5], 息: 0.5 },
    "geo-osc":        { 脈: 0.7, 息: 0.4 },
    "geo-generator":  { 脈: 0.7, 息: 0.4 },
    "_default":       { 息: 0.6 }
  };

  function registerElSystemaStimulus(config) {
    if (!config || !config.audioContext || !config.outputNode) throw new Error("[assr] audioContext & outputNode required");
    if (root.__elsysStim) return root.__elsysStim;   // 冪等：1オリジンに刺激層は1つ
    var ctx = config.audioContext, out = config.outputNode;
    var id = config.id || "stimulus";
    var role = config.role || parseRole();
    var isAnchor = role === "anchor";
    var transport = config.transport || null;

    // ── 独立した並列の声：stimBus → limiter → out（fxを通らない＝リバーブ非経由）──
    var stimBus = ctx.createGain(); stimBus.gain.value = 1;   // 合流母線（各サブ層のレベルで灯を制御）
    var limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.003; limiter.release.value = 0.25;
    var connected = false;
    function connect() { if (!connected) { stimBus.connect(limiter); limiter.connect(out); connected = true; } }
    function disconnect() { if (connected) { try { stimBus.disconnect(); limiter.disconnect(); } catch (e) {} connected = false; } }

    // 状態（祭祀語彙）
    var P = {
      lit: 0,                                   // 灯（刺激 on/off）
      mRitsu: 40.0, mFuka: 0.80, mSou: "sine",  // 脈（40Hz ASSR）
      iRitsu: 0.10, iFuka: 0.0,                 // 息（0.1Hz 呼吸ペーサー）
      nRyou: 0.0,                               // 眠（0.8Hz 徐波）
      kRyou: 0.0,                               // 体（40Hz 身体振動）
      aRitsu: 10, aFuka: 0.0,                   // 相（α/θ 振幅同調：律=Hz, 深=depth）
      srLv: 0.0,                                // 揺（確率共鳴ノイズ床）
      rasBpm: 100, rasLv: 0.0,                  // 律（RAS拍：BPM, レベル）
      offsetMs: 0,                              // 刻.差（端末クロック補正）
      level: 0.40                               // 刺激全体レベル（灯時の目標。体感重視で引き上げ／位 で可変）
    };
    var session = { startAt: 0, active: false, durMs: 60 * 60 * 1000, fadeMs: 30 * 1000 };

    // ── 脈：単一の清浄なキャリア(≥150Hz)を 40Hz AM（anchor のみ）──
    // 清浄な正弦にすることで包絡線が 40Hz 単一成分になり、実測 m が正しく出る。
    var pulseCar = ctx.createOscillator(); pulseCar.type = "sine"; pulseCar.frequency.value = 200;
    var pulseCarG = ctx.createGain(); pulseCarG.gain.value = 0;   // 灯&anchor 時のみ上げる
    // gain = ConstantSource(1-depth/2) + osc(depth/2) → [1-depth,1]。osc直結禁止（80Hz化回避）。
    var pulseGain = ctx.createGain(); pulseGain.gain.value = 0;   // intrinsic 0：gain は下の2ソースの総和のみ（[1-depth,1]）
    var amConst = ctx.createConstantSource(); amConst.offset.value = 1; amConst.start();
    var amOsc = ctx.createOscillator(); amOsc.type = "sine"; amOsc.frequency.value = 40;
    var amDepthGain = ctx.createGain(); amDepthGain.gain.value = 0;   // depth/2
    amConst.connect(pulseGain.gain); amOsc.connect(amDepthGain); amDepthGain.connect(pulseGain.gain); amOsc.start();
    pulseCar.connect(pulseCarG); pulseCarG.connect(pulseGain); pulseGain.connect(stimBus); pulseCar.start();

    // ── 息：ピンクノイズ pad を呼吸ローパス(0.1Hz)で明暗させる（全ノード）──
    // カットオフ帯域(300–3000Hz)がノイズを実際に濾すので、呼吸が可聴になる。
    var padSrc = ctx.createBufferSource(); padSrc.buffer = pinkBuffer(ctx, 2.0); padSrc.loop = true;
    var breathLP = ctx.createBiquadFilter(); breathLP.type = "lowpass"; breathLP.frequency.value = 1500; breathLP.Q.value = 0.6;
    // 相：α/θ の振幅同調を pad に掛ける（全ノード可）。intrinsic 0＋ConstantSource+osc で [1-depth,1]。
    var padAM = ctx.createGain(); padAM.gain.value = 0;
    var aConst = ctx.createConstantSource(); aConst.offset.value = 1; aConst.start();
    var aOsc = ctx.createOscillator(); aOsc.type = "sine"; aOsc.frequency.value = 10;
    var aDepth = ctx.createGain(); aDepth.gain.value = 0;
    aConst.connect(padAM.gain); aOsc.connect(aDepth); aDepth.connect(padAM.gain); aOsc.start();
    var ikiGain = ctx.createGain(); ikiGain.gain.value = 0;
    padSrc.connect(breathLP); breathLP.connect(padAM); padAM.connect(ikiGain); ikiGain.connect(stimBus); padSrc.start();

    // 揺：確率共鳴用の定常ピンクノイズ床（全ノード）
    var srSrc = ctx.createBufferSource(); srSrc.buffer = pinkBuffer(ctx, 2.0); srSrc.loop = true;
    var srGain = ctx.createGain(); srGain.gain.value = 0;
    srSrc.connect(srGain); srGain.connect(stimBus); srSrc.start();

    // 律：律動聴覚刺激(RAS)の拍。1kHz の短いピン(5ms)を BPM で lookahead 予約。
    var rasFilt = ctx.createBiquadFilter(); rasFilt.type = "bandpass"; rasFilt.frequency.value = 1000; rasFilt.Q.value = 1.2;
    rasFilt.connect(stimBus);
    var rasNext = 0;

    // ── 眠：0.8Hz 徐波ピンクバースト（anchor のみ・lookahead 予約）──
    var burstFilt = ctx.createBiquadFilter(); burstFilt.type = "bandpass"; burstFilt.frequency.value = 600; burstFilt.Q.value = 0.5;
    burstFilt.connect(stimBus);
    var pink = pinkBuffer(ctx, 1.0), burstNext = 0;

    // ── 体：40Hz 正弦の独立バス（transducer 想定。out へ別ゲインで）──
    var bodyOsc = ctx.createOscillator(); bodyOsc.type = "sine"; bodyOsc.frequency.value = 40;
    var bodyGain = ctx.createGain(); bodyGain.gain.value = 0; bodyOsc.connect(bodyGain); bodyGain.connect(out); bodyOsc.start();

    // ── 包絡線モニタ（専用 Analyser。sharedAnalyser は流用しない）──
    var envRect = ctx.createWaveShaper();
    (function () { var m = 1024, cv = new Float32Array(m); for (var i = 0; i < m; i++) { var x = (i / (m - 1)) * 2 - 1; cv[i] = Math.abs(x); } envRect.curve = cv; envRect.oversample = "2x"; })();
    var envLP = ctx.createBiquadFilter(); envLP.type = "lowpass"; envLP.frequency.value = 200; envLP.Q.value = 0.7;
    var envAn = ctx.createAnalyser(); envAn.fftSize = 32768; envAn.smoothingTimeConstant = 0;
    pulseGain.connect(envRect); envRect.connect(envLP); envLP.connect(envAn);   // 脈経路のみ計測（他層で希釈しない）
    var envFb = new Float32Array(envAn.frequencyBinCount);
    var mon = { hz: 0, depth: 0 };
    function readMonitor() {
      // 出力(脈経路)を整流+LP した包絡線の FFT。周波数=ピーク(放物線補間)、深度=変調指数 m=2·|X(fmod)|/|X(DC)|
      envAn.getFloatFrequencyData(envFb);
      var binHz = (ctx.sampleRate || 48000) / envAn.fftSize;
      var lo = Math.max(1, (3 / binHz) | 0), hi = Math.ceil(60 / binHz), pk = lo, pv = -Infinity;
      for (var i = lo; i <= hi; i++) if (envFb[i] > pv) { pv = envFb[i]; pk = i; }
      var dd = 0; if (pk > 0 && pk < envFb.length - 1) { var y0 = envFb[pk - 1], y1 = envFb[pk], y2 = envFb[pk + 1], den = y0 - 2 * y1 + y2; if (Math.abs(den) > 1e-9) dd = clamp(0.5 * (y0 - y2) / den, -0.5, 0.5); }
      var dcDb = -Infinity; for (var j = 0; j <= 2 && j < envFb.length; j++) dcDb = Math.max(dcDb, envFb[j]);
      var m = clamp(2 * Math.pow(10, (pv - dcDb) / 20), 0, 1);
      var active = (pv - dcDb) > -40;
      mon = { hz: active ? (pk + dd) * binHz : 0, depth: active ? m : 0 };
      return mon;
    }

    // ── 壁時計(ms) → 自 AudioContext 時刻 の較正換算 ──
    // getOutputTimestamp() の (contextTime, performanceTime) ペアで出力レイテンシ込みに正確対応させる。
    // これでコンテキスト生成/サスペンドのタイミング差に依らず、全楽器が同じ壁時計グリッドへ揃う。
    var t0Ctx = ctx.currentTime, t0Epoch = nowMs();
    // 壁時計(ms)→自 context 時刻。ctx.currentTime と Date.now を同瞬間に読み対応づける
    // （同一マシンの全 context は同じ音声デバイスクロックで進むため、この対応で位相が揃う）。
    function wallToCtx(wallMs) { return ctx.currentTime + (wallMs - nowMs()) / 1000; }
    // 壁時計グリッド上で base からの「次の周期境界」(ms)
    function nextBoundaryWall(periodSec, base) {
      var per = periodSec * 1000, e = nowMs() + P.offsetMs;
      return e + ((per - (((e - base) % per) + per) % per) % per);
    }

    // ── 息：呼吸カーブを epoch グリッドに合わせて先行スケジュール（AudioParam）──
    var breathAt = 0;  // 次に予約する周期境界（ctx時刻）
    function scheduleBreath(nowC) {
      if (P.iFuka <= 0.001) { breathLP.frequency.setTargetAtTime(3000, nowC, 0.2); return; }
      var period = 1 / clamp(P.iRitsu, 0.05, 0.2);
      var hi = 3000, lo = hi * Math.pow(0.1, P.iFuka);                  // 深いほど呼気で暗くなる(300–3000Hz)
      var curve = breathCurve(128, lo, hi);
      if (!breathAt || breathAt < nowC - period) {
        // 共有の絶対時計グリッドの次境界を getOutputTimestamp 較正で自 context 時刻へ換算。
        // → 生成/サスペンドのタイミング差に依らず全楽器が同じ呼吸位相で揃う（＝場が同じ呼吸をする）。
        breathAt = wallToCtx(nextBoundaryWall(period, session.startAt || 0));
        while (breathAt < nowC) breathAt += period;
      }
      while (breathAt < nowC + 4) {
        try { breathLP.frequency.setValueCurveAtTime(curve, breathAt, period); } catch (e2) { breathLP.frequency.setTargetAtTime(curve[0], breathAt, 0.1); }
        breathAt += period;
      }
    }

    // ── 眠：0.8Hz バースト先行予約 ──
    function scheduleBurst(nowC) {
      if (!P.lit || P.nRyou <= 0.001) { burstNext = 0; return; }   // 役割で消さず、眠がある楽器で鳴らす
      if (!burstNext || burstNext < nowC) {   // 共有の絶対時計(1.25s グリッド)へ較正整列＝全楽器で徐波が揃う
        burstNext = wallToCtx(nextBoundaryWall(1.25, 0)); while (burstNext < nowC) burstNext += 1.25;
      }
      while (burstNext < nowC + 0.4) {
        var lv = P.nRyou * 0.12;
        var src = ctx.createBufferSource(); src.buffer = pink; src.loop = true;
        var g = ctx.createGain();
        g.gain.setValueAtTime(0.0002, burstNext);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0003, lv), burstNext + 0.005);
        g.gain.setValueAtTime(Math.max(0.0003, lv), burstNext + 0.045);
        g.gain.exponentialRampToValueAtTime(0.0002, burstNext + 0.05);
        src.connect(g); g.connect(burstFilt); src.start(burstNext); src.stop(burstNext + 0.06);
        burstNext += 1.25;
      }
    }

    // 律：RAS 拍の lookahead 予約（1kHz ピン 5ms）
    function scheduleRas(nowC) {
      if (!P.lit || P.rasLv <= 0.001) { rasNext = 0; return; }
      var iv = 60 / clamp(P.rasBpm, 40, 200);
      if (!rasNext || rasNext < nowC) {   // 共有の絶対時計(拍グリッド)へ較正整列＝同一BPMの拍が位相ロック
        rasNext = wallToCtx(nextBoundaryWall(iv, 0)); while (rasNext < nowC) rasNext += iv;
      }
      while (rasNext < nowC + 0.4) {
        var o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = 1000;
        var g = ctx.createGain(); var lv = P.rasLv * 0.5;
        g.gain.setValueAtTime(0.0002, rasNext);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0003, lv), rasNext + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0002, rasNext + 0.05);
        o.connect(g); g.connect(rasFilt); o.start(rasNext); o.stop(rasNext + 0.06);
        rasNext += iv;
      }
    }

    // ── 制御レートのスケジューラ（音の生成ではなく先行予約のみ。tab throttle 耐性）──
    var tick = null;
    function apply() {
      var nowC = ctx.currentTime, tc = 0.05;
      // 脈：40Hz AM 深度（役割で消さない＝どの楽器でも 40Hz が体感できる）
      var d = clamp(P.mFuka, 0, 1);
      amConst.offset.setTargetAtTime(1 - d * 0.5, nowC, tc);
      amDepthGain.gain.setTargetAtTime(d * 0.5, nowC, tc);
      amOsc.frequency.setTargetAtTime(clamp(P.mRitsu, 30, 50), nowC, tc);
      if (["sine", "triangle", "square"].indexOf(P.mSou) >= 0 && amOsc.type !== P.mSou) amOsc.type = P.mSou;
      // 相：α/θ 振幅同調（pad へ・全ノード）
      var ad = clamp(P.aFuka, 0, 1);
      aConst.offset.setTargetAtTime(1 - ad * 0.5, nowC, tc);
      aDepth.gain.setTargetAtTime(ad * 0.5, nowC, tc);
      aOsc.frequency.setTargetAtTime(clamp(P.aRitsu, 4, 14), nowC, tc);
      // 揺：確率共鳴ノイズ床
      srGain.gain.setTargetAtTime(P.lit ? clamp(P.srLv, 0, 0.5) : 0, nowC, 0.1);
      // 息（全ノード）／眠（anchor）／律（RAS）
      scheduleBreath(nowC); scheduleBurst(nowC); scheduleRas(nowC);
      // 各サブ層のレベルで灯＋セッションフェードを与える（stimBus は常時1）。
      // ※単一体験では役割で消さない：プロファイルが指定したモジュールを実際に鳴らす（体感重視）。
      //   anchor/field は 40Hz の“端末間位相同期”の区別のみに使う（下の scheduleBurst 等でも同様）。
      var se = sessionEnv();
      pulseCarG.gain.setTargetAtTime((P.lit && P.mFuka > 0.001) ? P.level * se : 0, nowC, 0.08);  // 脈キャリア(40Hz γ)
      ikiGain.gain.setTargetAtTime(P.lit ? P.level * 0.7 * se : 0, nowC, 0.08);                    // 息 pad
      bodyOsc.frequency.setTargetAtTime(clamp(P.mRitsu, 30, 50), nowC, tc);
      bodyGain.gain.setTargetAtTime((P.lit && P.kRyou > 0.001) ? clamp(P.kRyou, 0, 0.5) * se : 0, nowC, tc); // 体
    }
    function sessionEnv() {
      if (!session.active || !session.startAt) return P.lit ? 1 : 0;
      var e = nowMs() + P.offsetMs - session.startAt;
      if (e < 0) return 0;
      if (e < session.fadeMs) return e / session.fadeMs;                          // fade in 30s
      if (e > session.durMs) { return 0; }                                        // 終了
      if (e > session.durMs - session.fadeMs) return (session.durMs - e) / session.fadeMs; // fade out
      return 1;
    }
    function start() { if (tick) return; connect(); t0Ctx = ctx.currentTime; t0Epoch = nowMs(); breathAt = 0; burstNext = 0; tick = setInterval(apply, 250); apply(); }
    function stop() { if (tick) { clearInterval(tick); tick = null; } stimBus.gain.setTargetAtTime(0, ctx.currentTime, 0.1); }

    // ── setParam（祭祀語彙）──
    function setParam(name, value) {
      switch (name) {
        case "灯": P.lit = +value ? 1 : 0; if (P.lit) start(); apply(); break;
        case "脈.律": P.mRitsu = clamp(+value, 30, 50); break;
        case "脈.深": P.mFuka = clamp(+value, 0, 1); break;
        case "脈.相": P.mSou = String(value); break;
        case "息.律": P.iRitsu = clamp(+value, 0.05, 0.2); breathAt = 0; break;
        case "息.深": P.iFuka = clamp(+value, 0, 1); breathAt = 0; break;
        case "眠.量": P.nRyou = clamp(+value, 0, 1); break;
        case "体.量": P.kRyou = clamp(+value, 0, 0.5); break;
        case "相.律": P.aRitsu = clamp(+value, 4, 14); break;
        case "相.深": P.aFuka = clamp(+value, 0, 1); break;
        case "揺.量": P.srLv = clamp(+value, 0, 0.5); break;
        case "律.律": P.rasBpm = clamp(+value, 40, 200); rasNext = 0; break;
        case "律.量": P.rasLv = clamp(+value, 0, 1); break;
        case "刻.差": P.offsetMs = +value || 0; breathAt = 0; break;
        case "位": P.level = clamp(+value, 0, 1); break;   // 刺激全体レベル
        default: return false;
      }
      if (tick) apply();
      return true;
    }

    // ── maneki（セッション開始宣言）受信 → 全ノードが startAt から経過を数える ──
    function beginSession(startAtEpoch, durMs) {
      session.startAt = startAtEpoch || nowMs();
      if (durMs) session.durMs = durMs;
      session.active = true; breathAt = 0; if (!tick) start(); apply();
    }
    if (transport && transport.onMessage) {
      transport.onMessage(function (m) {
        if (!m || m.t !== "maneki") return;
        // guise が刺激セッション（"脈"/"assr" 等）のときのみ開始（他 guise は無視）
        if (/脈|assr|stim/i.test(m.guise || "")) beginSession(m.startAt, m.durMs);
      });
    }

    // 楽器別プロファイルを適用（灯 on 時に各器の適性モジュールを立ち上げる）
    function applyProfile() {
      var pr = PROFILES[id] || PROFILES["_default"]; if (!pr) return;
      if (pr["脈"] != null) { setParam("脈.律", 40); setParam("脈.深", pr["脈"]); }
      if (pr["息"] != null) { setParam("息.律", 0.1); setParam("息.深", pr["息"]); }
      if (pr["眠"] != null) setParam("眠.量", pr["眠"]);
      if (pr["相"]) { setParam("相.律", pr["相"][0]); setParam("相.深", pr["相"][1]); }
      if (pr["揺"] != null) setParam("揺.量", pr["揺"]);
      if (pr["律"]) { setParam("律.律", pr["律"][0]); setParam("律.量", pr["律"][1]); }
      if (pr["体"] != null) setParam("体.量", pr["体"]);
    }

    // 自己観測 silence（器の鳴り止み）で刺激も止める用フック
    function onSilence() { setParam("灯", 0); }

    var api = {
      id: id, role: role, setParam: setParam, start: start, stop: stop,
      beginSession: beginSession, onSilence: onSilence, applyProfile: applyProfile,
      readMonitor: readMonitor,
      state: function () { return { role: role, lit: P.lit, mon: mon, breathHz: P.iRitsu, breathCutoff: breathLP.frequency.value, session: session.active }; },
      params: P,
      disconnect: disconnect
    };
    root.__elsysStim = api;
    // 常時 on：UI パネルは出さず、アタッチ時に楽器別プロファイルで自動点灯する。
    // （config.autoLit === false のときだけ点灯を保留）
    if (config.autoLit !== false) { try { applyProfile(); setParam("灯", 1); } catch (e) {} }
    return api;
  }

  root.registerElSystemaStimulus = registerElSystemaStimulus;

  // 場接続していない器向けフォールバック：AudioContext を捕捉し destination へ「足すだけ」で自動アタッチ。
  // bootstrap（window.__elsysId 設定→この関数呼び出し）をアプリのバンドルより前に読むこと。
  function registerElSystemaStimulusAuto() {
    if (root.__elsysStim || root.__elsysAutoArmed) return;
    var NativeAC = root.AudioContext || root.webkitAudioContext; if (!NativeAC) return;
    root.__elsysAutoArmed = true;
    function cap(c) { if (root.__elsysStim || !c) return; try { registerElSystemaStimulus({ id: root.__elsysId || "stimulus", audioContext: c, outputNode: c.destination }); } catch (e) {} }
    function Wrap(opts) { var c = new NativeAC(opts); cap(c); return c; }
    Wrap.prototype = NativeAC.prototype;
    try { root.AudioContext = Wrap; root.webkitAudioContext = Wrap; } catch (e) {}
  }
  root.registerElSystemaStimulusAuto = registerElSystemaStimulusAuto;
})(typeof window !== "undefined" ? window : globalThis);

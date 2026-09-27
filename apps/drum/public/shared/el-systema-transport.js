// EL-SYSTEMA ─ 通り道（transport）
//
// 案B 既定: ws://localhost:8787 の中継へ繋ぐ。
// 案差し替え可: BroadcastChannel 実装も小さく同居（同一オリジン内輪用）。
//
// 利用側からは createTransport({ kind, ... }) で同じ形のインタフェース:
//   transport.send(message)
//   transport.onMessage(cb)        // 受信ごとに cb(message)
//   transport.onOpen(cb)
//   transport.onClose(cb)
//   transport.close()
//
// 通り道は形式のみを担う。メッセージの意味は shared/el-systema-shapes.js。

(function (root) {
  "use strict";

  const DEFAULT_BC_NAME = "el-systema-field";

  // 既定の中継先。「どこから開かれたか」で 1 本に決め打ちせず、**候補を順に試す**。
  //   1. ?ws=host:port … 明示指定（最優先）
  //   2. 自分を配信しているポート … relay 直下（localhost:8787/instruments/… 等）ならここで繋がる。
  //      8787 が塞がっていても別ポートで一式が動く。
  //   3. ws://localhost:8787 … 既定の relay。
  // 2 が relay でない場合（vite の dev/preview サーバから開いた時など）は繋がらないので、
  // 失敗したら次の候補へ自動で移る。これで「どのサーバから開いても最終的に場に入る」。
  function defaultWsCandidates() {
    var out = [];
    try {
      var q = new URLSearchParams(location.search).get("ws");
      if (q) out.push(/^wss?:\/\//.test(q) ? q : "ws://" + q);
    } catch (e) {}
    try {
      var h = location.hostname;
      var local = (h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1");
      // relay が配信するパス（/instruments/<id>/ ・ /hub.html の隣）なら、自分のポートが relay。
      // そうでないローカルサーバ（vite の dev/preview 等）から開かれた時は 8787 を先に試す
      // ＝無駄な失敗ログを出さずに場へ入る。どちらの順でも最終的には繋がる。
      var servedByRelay = /^\/instruments\/[^/]+\//.test(location.pathname);
      if (local && location.port) {
        if (servedByRelay) out.push("ws://" + location.host);
        else { out.push("ws://localhost:8787"); out.push("ws://" + location.host); }
      }
    } catch (e) {}
    out.push("ws://localhost:8787");
    var seen = {}, uniq = [];
    for (var i = 0; i < out.length; i++) { if (!seen[out[i]]) { seen[out[i]] = 1; uniq.push(out[i]); } }
    return uniq;
  }
  const DEFAULT_WS_CANDIDATES = defaultWsCandidates();
  const DEFAULT_WS_URL = DEFAULT_WS_CANDIDATES[0];

  // ─ WebSocket transport (案B) ───────────────────────────────────────────────
  function createWsTransport(opts) {
    // 明示 url が来たらそれ 1 本。無ければ候補を順に試す。
    const candidates = (opts && opts.url) ? [opts.url] : DEFAULT_WS_CANDIDATES.slice();
    let ci = 0;
    let url = candidates[0];
    let everOpened = false;
    // INV-4: 指数バックオフ 1s/2s/4s/8s（上限8s）。成功接続で 1s にリセット。
    const backoffMax = (opts && opts.backoffMax) || 8000;
    let backoff = (opts && opts.reconnectMs) || 1000;
    let ws = null;
    let closed = false;
    const onMsg = [];
    const onOpen = [];
    const onClose = [];
    const outbox = [];

    // 一度も開けていない間は、閉じるたびに次の候補へ移る（relay でないサーバから開かれた場合の救済）。
    // 一度でも開けたらその候補に留まり、以後は INV-4 のバックオフ再接続だけを行う。
    function nextCandidate() {
      if (everOpened || candidates.length < 2) return;
      ci = (ci + 1) % candidates.length;
      url = candidates[ci];
    }
    function connect() {
      try {
        ws = new WebSocket(url);
      } catch (e) {
        if (!closed) { nextCandidate(); setTimeout(connect, backoff); }
        return;
      }
      ws.addEventListener("open", function () {
        everOpened = true;
        backoff = (opts && opts.reconnectMs) || 1000;   // INV-4: 接続成功でバックオフをリセット
        // 滞留分を吐く
        while (outbox.length) {
          try { ws.send(outbox.shift()); } catch (_) { break; }
        }
        for (let i = 0; i < onOpen.length; i++) onOpen[i]();
      });
      ws.addEventListener("message", function (ev) {
        let m = null;
        try { m = JSON.parse(ev.data); } catch (_) { return; }
        for (let i = 0; i < onMsg.length; i++) onMsg[i](m);
      });
      ws.addEventListener("close", function () {
        for (let i = 0; i < onClose.length; i++) onClose[i]();
        if (!closed) {
          nextCandidate();
          // まだ一度も繋がっていない＝候補探索中は、早めに次を試す（待たせない）
          const wait = everOpened ? backoff : Math.min(backoff, 400);
          setTimeout(connect, wait);
          backoff = Math.min(backoffMax, backoff * 2);
        }
      });
      ws.addEventListener("error", function () { /* close が来る */ });
    }
    connect();

    return {
      kind: "ws",
      get url() { return url; },
      candidates: candidates.slice(),
      send: function (m) {
        const s = JSON.stringify(m);
        if (ws && ws.readyState === 1) {
          try { ws.send(s); } catch (_) { outbox.push(s); }
        } else {
          outbox.push(s);
        }
      },
      onMessage: function (cb) { onMsg.push(cb); },
      onOpen:    function (cb) { onOpen.push(cb); },
      onClose:   function (cb) { onClose.push(cb); },
      close: function () { closed = true; try { ws && ws.close(); } catch (_) {} },
    };
  }

  // ─ BroadcastChannel transport (同一オリジン内輪用・差し替え候補) ────────────
  function createBroadcastTransport(opts) {
    const name = (opts && opts.name) || DEFAULT_BC_NAME;
    if (typeof BroadcastChannel === "undefined") {
      return { kind: "broadcast", send: function(){}, onMessage: function(){}, onOpen: function(){}, onClose: function(){}, close: function(){} };
    }
    const bc = new BroadcastChannel(name);
    const onMsg = [];
    const onOpen = [];
    bc.onmessage = function (ev) {
      for (let i = 0; i < onMsg.length; i++) onMsg[i](ev.data);
    };
    // BroadcastChannel は open イベントが無いので microtask で疑似発火
    Promise.resolve().then(function () {
      for (let i = 0; i < onOpen.length; i++) onOpen[i]();
    });
    return {
      kind: "broadcast",
      name,
      send: function (m) { bc.postMessage(m); },
      onMessage: function (cb) { onMsg.push(cb); },
      onOpen:    function (cb) { onOpen.push(cb); },
      onClose:   function () { /* 同一オリジンチャンネルは閉じない */ },
      close: function () { try { bc.close(); } catch (_) {} },
    };
  }

  function createTransport(opts) {
    opts = opts || {};
    const kind = opts.kind || "ws";
    if (kind === "ws") return createWsTransport(opts);
    if (kind === "broadcast") return createBroadcastTransport(opts);
    throw new Error("unknown transport kind: " + kind);
  }

  root.ElSystemaTransport = {
    createTransport,
    createWsTransport,
    createBroadcastTransport,
    DEFAULT_WS_URL,
    DEFAULT_BC_NAME,
  };
})(typeof window !== "undefined" ? window : globalThis);

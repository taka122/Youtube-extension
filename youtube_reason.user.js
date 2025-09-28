// ==UserScript==
// @name         YouTube: 再生前に「なぜ見るのか」入力
// @namespace    https://example.taka/yt-reason
// @version      1.2.0
// @description  YouTubeで再生前に理由入力を必須化。学習以外は任意で視聴時間制限も可能（設定可）。
// @author       you
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  /** ===================== 設定 ===================== */
  const CONFIG = {
    // 学習以外カテゴリの視聴時間を制限したい場合に true
    ENABLE_NON_LEARNING_LIMIT: false,
    // 学習以外の合計視聴許容時間（分）／1日
    NON_LEARNING_LIMIT_MIN: 30,
    // 理由テキストの最小文字数
    MIN_REASON_LEN: 5,
    // オーバーレイの最大幅(px)
    MODAL_WIDTH: 520,
  };

  /** ============== 便利関数・状態管理 ============== */
  const isShorts = () => location.pathname.startsWith("/shorts");
  const getVideoId = () => {
    if (isShorts()) {
      // /shorts/VIDEO_ID
      return location.pathname.split("/")[2] || null;
    }
    const url = new URL(location.href);
    return url.searchParams.get("v");
  };

  const todayKey = () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  };

  const STORAGE_KEYS = {
    reasons: "yt_reason_store_v1", // { [videoId]: { reason, category, time, url } }
    daily: "yt_reason_daily_v1",   // { [YYYY-MM-DD]: { nonLearningSeconds } }
    approved: "yt_reason_approved_v1", // { [videoId]: true }
  };

  const load = (k, def) => {
    try {
      return JSON.parse(localStorage.getItem(k)) ?? def;
    } catch {
      return def;
    }
  };
  const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));

  /** ============== 視聴カウント(学習以外) ============== */
  let tickTimer = null;
  let tickingCategory = null;

  function startTick(category) {
    stopTick();
    tickingCategory = category;
    if (!CONFIG.ENABLE_NON_LEARNING_LIMIT) return;

    tickTimer = setInterval(() => {
      if (tickingCategory && tickingCategory !== "学習") {
        const daily = load(STORAGE_KEYS.daily, {});
        const key = todayKey();
        daily[key] = daily[key] || { nonLearningSeconds: 0 };
        daily[key].nonLearningSeconds += 1; // 1秒加算
        save(STORAGE_KEYS.daily, daily);

        // 上限チェック
        const limitSec = CONFIG.NON_LEARNING_LIMIT_MIN * 60;
        if (daily[key].nonLearningSeconds >= limitSec) {
          // もう上限。全videoを停止
          pauseAllVideos();
          showLimitModal();
        }
      }
    }, 1000);
  }

  function stopTick() {
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = null;
    tickingCategory = null;
  }

  /** ================== 再生・停止制御 ================== */
  function pauseAllVideos() {
    document.querySelectorAll("video").forEach((v) => {
      try { v.pause(); } catch {}
    });
  }

  function onVideoPlay(e) {
    const el = e.target;
    if (el.tagName !== "VIDEO") return;

    const vid = getVideoId();
    if (!vid) {
      // 不明なら一旦ブロック
      el.pause();
      return showReasonModal();
    }

    const approved = load(STORAGE_KEYS.approved, {});
    if (!approved[vid]) {
      el.pause();
      showReasonModal();
      return;
    }

    // 承認済みならカウント開始（学習以外のみ）
    const reasons = load(STORAGE_KEYS.reasons, {});
    const info = reasons[vid];
    startTick(info?.category || "その他");
  }

  function onVideoPause() {
    stopTick();
  }

  /** ================== モーダルUI生成 ================== */
  function style(css) {
    const s = document.createElement("style");
    s.textContent = css;
    document.documentElement.appendChild(s);
  }

  style(`
  .yt-reason-backdrop {
    position: fixed; inset: 0; background: rgba(0,0,0,.5);
    display: flex; align-items: center; justify-content: center;
    z-index: 999999;
  }
  .yt-reason-card {
    width: 92%; max-width: ${CONFIG.MODAL_WIDTH}px;
    background: #111; color: #eee; border-radius: 16px;
    border: 1px solid #333; box-shadow: 0 10px 30px rgba(0,0,0,.4);
    padding: 20px 18px; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  }
  .yt-reason-title { font-size: 18px; font-weight: 700; margin: 2px 0 12px; }
  .yt-reason-row { display: grid; gap: 8px; margin-bottom: 12px; }
  .yt-reason-row label { font-size: 13px; opacity: .9; }
  .yt-reason-input, .yt-reason-select {
    width: 100%; padding: 10px 12px; border-radius: 10px; border: 1px solid #444;
    background: #1a1a1a; color: #eee; outline: none;
  }
  .yt-reason-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 8px; }
  .yt-btn {
    padding: 10px 14px; border-radius: 10px; border: 1px solid #3a3a3a; cursor: pointer;
    background: #222; color: #eee; font-weight: 600;
  }
  .yt-btn.primary { background: #2b5bd7; border-color:#2b5bd7; }
  .yt-btn:disabled { opacity: .5; cursor: not-allowed; }
  .yt-reason-helper { font-size: 12px; opacity: .85; }
  .yt-limit-msg { text-align: center; font-size: 15px; line-height: 1.6; }
  `);

  function showReasonModal() {
    removeModal();

    const vid = getVideoId();
    const url = location.href;

    const $back = document.createElement("div");
    $back.className = "yt-reason-backdrop";
    $back.innerHTML = `
      <div class="yt-reason-card" role="dialog" aria-modal="true">
        <div class="yt-reason-title">再生の前に — 「なぜ見るのか」を入力</div>
        <div class="yt-reason-row">
          <label>カテゴリ</label>
          <select class="yt-reason-select" id="yt_reason_category">
            <option>学習</option>
            <option>作業</option>
            <option>娯楽</option>
            <option>その他</option>
          </select>
        </div>
        <div class="yt-reason-row">
          <label>目的（${CONFIG.MIN_REASON_LEN}文字以上）</label>
          <textarea class="yt-reason-input" id="yt_reason_text" rows="3" placeholder="例: 英語発音のコツを学ぶ、LaravelのEloquent学習 など"></textarea>
          <div class="yt-reason-helper">入力後「開始」ボタンで再生できます。</div>
        </div>
        <div class="yt-reason-actions">
          <button class="yt-btn" id="yt_reason_cancel">キャンセル</button>
          <button class="yt-btn primary" id="yt_reason_ok" disabled>開始</button>
        </div>
      </div>
    `;

    document.documentElement.appendChild($back);

    const $text = $back.querySelector("#yt_reason_text");
    const $cat = $back.querySelector("#yt_reason_category");
    const $ok = $back.querySelector("#yt_reason_ok");
    const $cancel = $back.querySelector("#yt_reason_cancel");

    const validate = () => {
      const ok = ($text.value.trim().length >= CONFIG.MIN_REASON_LEN);
      $ok.disabled = !ok;
    };

    $text.addEventListener("input", validate);
    validate();

    $ok.addEventListener("click", () => {
      const reason = $text.value.trim();
      const category = $cat.value;

      // 保存
      const reasons = load(STORAGE_KEYS.reasons, {});
      reasons[vid || `unknown:${Date.now()}`] = {
        reason,
        category,
        time: Date.now(),
        url
      };
      save(STORAGE_KEYS.reasons, reasons);

      const approved = load(STORAGE_KEYS.approved, {});
      if (vid) {
        approved[vid] = true;
        save(STORAGE_KEYS.approved, approved);
      }

      removeModal();

      // 再生
      const v = document.querySelector("video");
      if (v) {
        v.play().catch(() => {});
      }

      // カウント開始
      startTick(category);
    });

    $cancel.addEventListener("click", () => {
      removeModal();
      pauseAllVideos();
    });

    // フォーカス
    setTimeout(() => $text.focus(), 0);
  }

  let modalEl = null;
  function removeModal() {
    document.querySelectorAll(".yt-reason-backdrop").forEach((n) => n.remove());
    modalEl = null;
  }

  function showLimitModal() {
    removeModal();
    const $back = document.createElement("div");
    $back.className = "yt-reason-backdrop";
    $back.innerHTML = `
      <div class="yt-reason-card">
        <div class="yt-reason-title">今日はここまで</div>
        <div class="yt-limit-msg">
          学習以外の視聴時間が設定上限に達しました。<br>
          目的を持った「学習」動画のみ視聴できます。
        </div>
        <div class="yt-reason-actions" style="justify-content:center;margin-top:14px;">
          <button class="yt-btn" id="yt_limit_ok">OK</button>
        </div>
      </div>
    `;
    document.documentElement.appendChild($back);
    $back.querySelector("#yt_limit_ok").addEventListener("click", () => {
      removeModal();
    });
  }

  /** ============== SPA(YouTube) への対応 ============== */
  // 1) play/pauseをグローバル監視してブロック
  document.addEventListener("play", onVideoPlay, true);
  document.addEventListener("pause", onVideoPause, true);

  // 2) URL変更（ナビゲーション）を検知して承認フラグをリセット
  let lastPath = location.href;
  const navObs = new MutationObserver(() => {
    if (lastPath !== location.href) {
      lastPath = location.href;
      stopTick();
      // 新しい動画では再入力を要求
      const vid = getVideoId();
      const approved = load(STORAGE_KEYS.approved, {});
      if (vid && approved[vid]) {
        // 同一動画に戻ってきたら保持
      } else {
        // 未承認なら次のplayでモーダル表示
        pauseAllVideos();
      }
    }
  });
  navObs.observe(document.documentElement, { childList: true, subtree: true });

  // 3) 初期ロード時にも停止して理由要求
  function initGate() {
    const v = getVideoId();
    const approved = load(STORAGE_KEYS.approved, {});
    if (!approved[v]) {
      pauseAllVideos();
      // 自動再生に備えて少し待ってからモーダル
      setTimeout(showReasonModal, 300);
    }
  }

  // 動画タグの出現を待つ
  const videoReady = new MutationObserver(() => {
    const vidEl = document.querySelector("video");
    if (vidEl) {
      initGate();
      videoReady.disconnect();
    }
  });
  videoReady.observe(document.documentElement, { childList: true, subtree: true });

  // 4) ページ離脱時にカウント終了
  window.addEventListener("beforeunload", stopTick);

})();
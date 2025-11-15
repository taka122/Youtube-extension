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
    // 娯楽カテゴリの視聴時間を制限したい場合に true
    ENABLE_ENTERTAINMENT_LIMIT: false,
    // 娯楽カテゴリの視聴許容時間（分）／1日
    ENTERTAINMENT_LIMIT_MIN: 30,
    // 理由テキストの最小文字数
    MIN_REASON_LEN: 5,
    // オーバーレイの最大幅(px)
    MODAL_WIDTH: 520,
    // Shorts をブロックする
    BLOCK_SHORTS: true,
    // Shorts関連UIを隠す
    HIDE_SHORTS_UI: true,
    // Shortsに遷移した場合のリダイレクト先（空文字でモーダル表示）
    SHORTS_REDIRECT_URL: "/feed/subscriptions",
    // 本日の視聴時間オーバーレイを表示
    SHOW_WATCH_OVERLAY: true,
    // 集計パネルを有効化
    ENABLE_SUMMARY_PANEL: true,
    // 再生ページのおすすめ欄（サイドバー）を隠す
    HIDE_RECOMMENDATIONS: true,
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

  const currentVideoKey = () => {
    const vid = getVideoId();
    return vid ? `id:${vid}` : `url:${location.href}`;
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
    daily: "yt_reason_daily_v1",   // { [YYYY-MM-DD]: { nonLearningSeconds, totalSeconds } }
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

  let dailyCache = load(STORAGE_KEYS.daily, {}) || {};

  function ensureTodayStats() {
    const key = todayKey();
    const existing = dailyCache[key];
    if (!existing || typeof existing !== "object") {
      dailyCache[key] = {
        totalSeconds: 0,
        nonLearningSeconds: 0,
        learningSeconds: 0,
        entertainmentSeconds: 0,
      };
    } else {
      existing.totalSeconds = Math.max(0, Number(existing.totalSeconds) || 0);
      existing.nonLearningSeconds = Math.max(0, Number(existing.nonLearningSeconds) || 0);
      existing.learningSeconds = Math.max(0, Number(existing.learningSeconds) || 0);
      existing.entertainmentSeconds = Math.max(0, Number(existing.entertainmentSeconds) || 0);
    }
    return { key, entry: dailyCache[key] };
  }

  function persistDailyStats() {
    save(STORAGE_KEYS.daily, dailyCache);
  }

  /** ============== 視聴カウント(学習以外) ============== */
  let tickTimer = null;
  let tickingCategory = null;

  function startTick(category) {
    stopTick();
    tickingCategory = category;
    tickTimer = setInterval(() => {
      const { entry } = ensureTodayStats();
      entry.totalSeconds += 1;

      const category = typeof tickingCategory === "string" ? tickingCategory : "その他";
      const isLearning = category === "学習";
      const isEntertainment = category === "娯楽";

      if (!isLearning) {
        entry.nonLearningSeconds += 1;
      }

      if (isLearning) entry.learningSeconds += 1;
      if (isEntertainment) entry.entertainmentSeconds += 1;

      let limitHandled = false;

      if (isEntertainment && CONFIG.ENABLE_ENTERTAINMENT_LIMIT) {
        const limitSec = CONFIG.ENTERTAINMENT_LIMIT_MIN * 60;
        if (entry.entertainmentSeconds >= limitSec) {
          limitHandled = true;
          pauseAllVideos();
          showLimitModal("entertainment");
        }
      }

      if (!limitHandled && !isLearning && CONFIG.ENABLE_NON_LEARNING_LIMIT) {
        const limitSec = CONFIG.NON_LEARNING_LIMIT_MIN * 60;
        if (entry.nonLearningSeconds >= limitSec) {
          limitHandled = true;
          pauseAllVideos();
          showLimitModal("non-learning");
        }
      }

      persistDailyStats();
      updateWatchOverlay(entry);
      if (!CONFIG.SHOW_WATCH_OVERLAY) refreshSummaryPanel();
    }, 1000);
  }

  function stopTick() {
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = null;
    tickingCategory = null;
    updateWatchOverlay();
    if (!CONFIG.SHOW_WATCH_OVERLAY) refreshSummaryPanel();
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

    if (CONFIG.BLOCK_SHORTS && isShorts()) {
      try { el.pause(); } catch {}
      handleShortsVisit();
      return;
    }

    const vid = getVideoId();
    const approved = load(STORAGE_KEYS.approved, {});
    const key = currentVideoKey();

    if (!(vid && approved[vid]) && !approved[key]) {
      el.pause();
      showReasonModal();
      return;
    }

    // 承認済みならカウント開始（学習以外のみ）
    const reasons = load(STORAGE_KEYS.reasons, {});
    const info = reasons[key] || (vid ? reasons[vid] : null);
    startTick(info?.category || "その他");
  }

  function onVideoPause() {
    stopTick();
  }

  /** ================== モーダルUI生成 ================== */
  let modalEl = null;

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
  .yt-watch-overlay {
    position: fixed; top: 58px; right: 16px; z-index: 999998;
    background: rgba(10, 10, 10, 0.78); color: #f6f6f6; border-radius: 12px;
    border: 1px solid rgba(255,255,255,0.08); box-shadow: 0 12px 30px rgba(0,0,0,.35);
    padding: 12px 14px 14px; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    pointer-events: auto; min-width: 160px;
  }
  .yt-watch-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 6px; }
  .yt-watch-overlay .yt-watch-label {
    font-size: 11px; letter-spacing: .08em; text-transform: uppercase;
    opacity: .7;
  }
  .yt-watch-overlay .yt-watch-total {
    font-size: 18px; font-weight: 700; line-height: 1.2;
  }
  .yt-watch-overlay .yt-watch-row {
    font-size: 12px; opacity: .82; margin-top: 3px;
    display: flex; justify-content: space-between;
  }
  .yt-watch-overlay .yt-watch-row .label {
    opacity: .75;
  }
  .yt-watch-overlay .yt-watch-row .time {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }
  .yt-summary-btn {
    background: rgba(98, 146, 255, 0.2);
    color: #e3ecff;
    border: 1px solid rgba(120, 170, 255, 0.35);
    border-radius: 8px;
    padding: 4px 8px;
    font-size: 11px;
    letter-spacing: .08em;
    text-transform: uppercase;
    cursor: pointer;
    transition: background .2s ease, border-color .2s ease;
  }
  .yt-summary-btn:hover { background: rgba(116, 162, 255, 0.32); border-color: rgba(155, 190, 255, 0.6); }
  .yt-summary-panel {
    position: fixed; inset: 10% 8% auto;
    min-height: 60%; max-height: 80%;
    background: rgba(14,14,16,0.96); color: #f4f4f4;
    border-radius: 18px; border: 1px solid rgba(255,255,255,0.1);
    box-shadow: 0 30px 60px rgba(0,0,0,0.45);
    padding: 20px 24px 28px; z-index: 1000000;
    overflow: auto; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  }
  .yt-summary-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
  .yt-summary-title { font-size: 20px; font-weight: 700; }
  .yt-summary-close { background: none; border: none; color: inherit; font-size: 18px; cursor: pointer; }
  .yt-summary-section { margin-bottom: 18px; }
  .yt-summary-section h3 { font-size: 14px; letter-spacing: .08em; text-transform: uppercase; opacity: .7; margin-bottom: 8px; }
  .yt-summary-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .yt-summary-table th, .yt-summary-table td { text-align: left; padding: 6px 8px; border-bottom: 1px solid rgba(255,255,255,0.08); }
  .yt-summary-table th { font-weight: 600; opacity: .75; }
  .yt-summary-empty { opacity: .6; font-size: 13px; }
  `);

  if (CONFIG.BLOCK_SHORTS && CONFIG.HIDE_SHORTS_UI) {
    style(`
    ytd-reel-shelf-renderer,
    ytd-reel-item-renderer,
    ytd-reel-video-renderer,
    ytd-rich-shelf-renderer[is-shorts],
    ytm-reel-shelf-renderer,
    ytm-reel-item-renderer,
    ytm-reel-video-renderer,
    ytm-shorts-shelf-renderer { display: none !important; }
    a[href^="/shorts"],
    a[href*="://www.youtube.com/shorts"],
    ytd-guide-entry-renderer a[href^="/shorts"],
    ytd-mini-guide-entry-renderer a[href^="/shorts"],
    ytm-guide-entry a[href^="/shorts"],
    ytm-item a[href^="/shorts"] { display: none !important; }
    `);
  }

  let watchOverlayEl = null;

  function ensureWatchOverlay() {
    if (!CONFIG.SHOW_WATCH_OVERLAY) return null;
    document.querySelectorAll('.yt-summary-btn').forEach((btn) => {
      if (!btn.closest('.yt-watch-overlay')) btn.remove();
    });
    if (!watchOverlayEl) {
      watchOverlayEl = document.createElement("div");
      watchOverlayEl.className = "yt-watch-overlay";
      watchOverlayEl.innerHTML = `
        <div class="yt-watch-header">
          <div class="yt-watch-label">本日の視聴</div>
          ${CONFIG.ENABLE_SUMMARY_PANEL ? '<button type="button" class="yt-summary-btn">集計</button>' : ""}
        </div>
        <div class="yt-watch-total">00:00:00</div>
        <div class="yt-watch-row yt-watch-learning" style="display:none;">
          <span class="label">学習</span>
          <span class="time">00:00:00</span>
        </div>
        <div class="yt-watch-row yt-watch-entertain" style="display:none;">
          <span class="label">娯楽</span>
          <span class="time">00:00:00</span>
        </div>
        <div class="yt-watch-row yt-watch-nonlearning" style="display:none;">
          <span class="label">その他</span>
          <span class="time">00:00:00</span>
        </div>
      `;
      document.documentElement.appendChild(watchOverlayEl);
    }
    if (CONFIG.ENABLE_SUMMARY_PANEL) {
      const btn = watchOverlayEl.querySelector(".yt-summary-btn");
      if (btn && !btn.__ytSummaryBound) {
        btn.addEventListener("click", toggleSummaryPanel);
        btn.__ytSummaryBound = true;
      }
      summaryBtnEl = btn || summaryBtnEl;
    } else {
      summaryBtnEl = null;
    }
    return watchOverlayEl;
  }

  function formatDuration(sec) {
    const total = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }

  function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>'"]/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    })[c] || c);
  }

  function updateWatchOverlay(entry) {
    if (!CONFIG.SHOW_WATCH_OVERLAY) return;
    const el = ensureWatchOverlay();
    if (!el) return;

    const stats = entry || ensureTodayStats().entry;
    const totalEl = el.querySelector(".yt-watch-total");
    const learnRow = el.querySelector(".yt-watch-learning");
    const learnTimeEl = learnRow?.querySelector(".time");
    const entertainRow = el.querySelector(".yt-watch-entertain");
    const entertainTimeEl = entertainRow?.querySelector(".time");
    const nonRow = el.querySelector(".yt-watch-nonlearning");
    const nonTimeEl = nonRow?.querySelector(".time");

    totalEl.textContent = formatDuration(stats?.totalSeconds ?? 0);

    if (learnRow && learnTimeEl) {
      learnRow.style.display = "flex";
      learnTimeEl.textContent = formatDuration(stats?.learningSeconds ?? 0);
    }

    if (entertainRow && entertainTimeEl) {
      entertainRow.style.display = "flex";
      entertainTimeEl.textContent = formatDuration(stats?.entertainmentSeconds ?? 0);
    }

    const totalNonLearning = stats?.nonLearningSeconds ?? 0;
    const entertainmentSeconds = stats?.entertainmentSeconds ?? 0;
    const otherSeconds = Math.max(0, totalNonLearning - entertainmentSeconds);

    if (nonRow && nonTimeEl) {
      if (otherSeconds > 0 || CONFIG.ENABLE_NON_LEARNING_LIMIT) {
        nonRow.style.display = "flex";
        nonTimeEl.textContent = formatDuration(otherSeconds);
      } else {
        nonRow.style.display = "none";
      }
    }

    refreshSummaryPanel();
  }

  let summaryBtnEl = null;
  let summaryPanelEl = null;
  let summaryEscHandler = null;

  function hideSummaryPanel() {
    if (!summaryPanelEl) return;
    summaryPanelEl.remove();
    summaryPanelEl = null;
    if (summaryEscHandler) {
      document.removeEventListener("keydown", summaryEscHandler, true);
      summaryEscHandler = null;
    }
  }

  function toggleSummaryPanel() {
    if (summaryPanelEl) {
      hideSummaryPanel();
    } else {
      showSummaryPanel();
    }
  }

  function formatDateLabel(dateKey) {
    try {
      const date = new Date(`${dateKey}T00:00:00`);
      if (!Number.isNaN(date.getTime())) {
        return `${date.getMonth() + 1}/${date.getDate()} (${"日月火水木金土"[date.getDay()]})`;
      }
    } catch {}
    return dateKey;
  }

  function collectDailyEntries() {
    const raw = load(STORAGE_KEYS.daily, {});
    dailyCache = raw || {};
    const entries = Object.entries(dailyCache)
      .map(([date, stats]) => {
        if (!stats || typeof stats !== "object") stats = {};
        const normalized = {
          date,
          totalSeconds: Math.max(0, Number(stats.totalSeconds) || 0),
          learningSeconds: Math.max(0, Number(stats.learningSeconds) || 0),
          entertainmentSeconds: Math.max(0, Number(stats.entertainmentSeconds) || 0),
          nonLearningSeconds: Math.max(0, Number(stats.nonLearningSeconds) || 0),
        };
        dailyCache[date] = {
          ...stats,
          totalSeconds: normalized.totalSeconds,
          learningSeconds: normalized.learningSeconds,
          entertainmentSeconds: normalized.entertainmentSeconds,
          nonLearningSeconds: normalized.nonLearningSeconds,
        };
        return normalized;
      })
      .sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : 0));
    persistDailyStats();
    return entries;
  }

  function collectReasonEntries(limit = 20) {
    const map = load(STORAGE_KEYS.reasons, {});
    const dedupe = new Map();
    Object.values(map || {}).forEach((val) => {
      if (!val || typeof val !== "object" || !val.time) return;
      const key = Number(val.time);
      if (!dedupe.has(key)) dedupe.set(key, val);
    });
    return Array.from(dedupe.values())
      .sort((a, b) => Number(b.time || 0) - Number(a.time || 0))
      .slice(0, limit);
  }

  function renderSummaryBody() {
    const dailyRows = collectDailyEntries();
    const reasons = collectReasonEntries();
    const dailyHtml = dailyRows.length
      ? dailyRows
          .map((d) => {
            const otherSeconds = Math.max(0, d.nonLearningSeconds - d.entertainmentSeconds);
            return `
              <tr>
                <td>${escapeHtml(formatDateLabel(d.date))}</td>
                <td>${formatDuration(d.totalSeconds)}</td>
                <td>${formatDuration(d.learningSeconds)}</td>
                <td>${formatDuration(d.entertainmentSeconds)}</td>
                <td>${formatDuration(otherSeconds)}</td>
              </tr>
            `;
          })
          .join("")
      : `<tr><td colspan="5" class="yt-summary-empty">まだデータがありません。</td></tr>`;

    const reasonHtml = reasons.length
      ? reasons
          .map((r) => {
            const date = new Date(Number(r.time || 0));
            const when = Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
            const reason = escapeHtml(r.reason || "-");
            const category = escapeHtml(r.category || "-");
            const url = typeof r.url === "string" ? r.url : "";
            const link = url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" style="color:#7ab7ff;">開く</a>` : "-";
            return `
              <tr>
                <td>${escapeHtml(when)}</td>
                <td>${category}</td>
                <td>${reason}</td>
                <td>${link}</td>
              </tr>
            `;
          })
          .join("")
      : `<tr><td colspan="4" class="yt-summary-empty">記録された理由はありません。</td></tr>`;

    return `
      <div class="yt-summary-section">
        <h3>日別サマリー</h3>
        <table class="yt-summary-table">
          <thead>
            <tr>
              <th>日付</th>
              <th>合計</th>
              <th>学習</th>
              <th>娯楽</th>
              <th>その他</th>
            </tr>
          </thead>
          <tbody>${dailyHtml}</tbody>
        </table>
      </div>
      <div class="yt-summary-section">
        <h3>最近の視聴理由</h3>
        <table class="yt-summary-table">
          <thead>
            <tr>
              <th>記録時刻</th>
              <th>カテゴリ</th>
              <th>理由</th>
              <th>リンク</th>
            </tr>
          </thead>
          <tbody>${reasonHtml}</tbody>
        </table>
      </div>
    `;
  }

  function refreshSummaryPanel() {
    if (!summaryPanelEl) return;
    const body = summaryPanelEl.querySelector(".yt-summary-body");
    if (body) body.innerHTML = renderSummaryBody();
  }

  function showSummaryPanel() {
    if (!CONFIG.ENABLE_SUMMARY_PANEL) return;
    if (summaryPanelEl) return refreshSummaryPanel();
    summaryPanelEl = document.createElement("div");
    summaryPanelEl.className = "yt-summary-panel";
    summaryPanelEl.innerHTML = `
      <div class="yt-summary-header">
        <div class="yt-summary-title">視聴集計</div>
        <button class="yt-summary-close" aria-label="閉じる">×</button>
      </div>
      <div class="yt-summary-body"></div>
    `;
    document.documentElement.appendChild(summaryPanelEl);
    summaryPanelEl.querySelector(".yt-summary-close").addEventListener("click", hideSummaryPanel);
    summaryEscHandler = (e) => {
      if (e.key === "Escape") {
        hideSummaryPanel();
      }
    };
    document.addEventListener("keydown", summaryEscHandler, true);
    refreshSummaryPanel();
  }

  function showReasonModal() {
    if (modalEl) removeModal();

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
          <button class="yt-btn primary" id="yt_reason_ok" disabled>開始</button>
        </div>
      </div>
    `;

    document.documentElement.appendChild($back);
    modalEl = $back;

    const $text = $back.querySelector("#yt_reason_text");
    const $cat = $back.querySelector("#yt_reason_category");
    const $ok = $back.querySelector("#yt_reason_ok");

    const validate = () => {
      const ok = ($text.value.trim().length >= CONFIG.MIN_REASON_LEN);
      $ok.disabled = !ok;
    };

    $text.addEventListener("input", validate);
    validate();

    const submitReason = () => {
      if ($ok.disabled) return;
      const reason = $text.value.trim();
      const category = $cat.value;

      const key = currentVideoKey();
      const reasons = load(STORAGE_KEYS.reasons, {});
      const payload = {
        reason,
        category,
        time: Date.now(),
        url
      };
      reasons[key] = payload;
      if (vid) reasons[vid] = payload;
      save(STORAGE_KEYS.reasons, reasons);

      const approved = load(STORAGE_KEYS.approved, {});
      approved[key] = true;
      if (vid) approved[vid] = true;
      save(STORAGE_KEYS.approved, approved);

      refreshSummaryPanel();

      removeModal();

      const v = document.querySelector("video");
      if (v) {
        v.play().catch(() => {});
      }

      startTick(category);
    };

    $ok.addEventListener("click", submitReason);

    $text.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        submitReason();
      }
    });

    // フォーカス & 入力初期化
    setTimeout(() => {
      if (!modalEl) return;
      $text.focus();
      $text.select();
    }, 0);
  }

  function removeModal() {
    document.querySelectorAll(".yt-reason-backdrop").forEach((n) => n.remove());
    modalEl = null;
  }

  function showLimitModal(kind = "non-learning") {
    removeModal();
    const isEntertainment = kind === "entertainment";
    const bodyMessage = isEntertainment
      ? "娯楽カテゴリの視聴時間が設定上限に達しました。<br>目的を持った動画だけを視聴するように切り替えましょう。"
      : "学習以外の視聴時間が設定上限に達しました。<br>目的を持った「学習」動画のみ視聴できます。";
    const $back = document.createElement("div");
    $back.className = "yt-reason-backdrop";
    $back.innerHTML = `
      <div class="yt-reason-card">
        <div class="yt-reason-title">今日はここまで</div>
        <div class="yt-limit-msg">${bodyMessage}</div>
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

  function showShortsBlockedModal() {
    removeModal();
    const $back = document.createElement("div");
    $back.className = "yt-reason-backdrop";
    $back.innerHTML = `
      <div class="yt-reason-card">
        <div class="yt-reason-title">ショート動画はブロック中</div>
        <div class="yt-limit-msg">
          集中と時間を守るため、ショート動画の視聴を禁止しています。
        </div>
        <div class="yt-reason-actions" style="justify-content:center;margin-top:14px;">
          <button class="yt-btn" id="yt_shorts_ok">OK</button>
        </div>
      </div>
    `;
    document.documentElement.appendChild($back);
    $back.querySelector("#yt_shorts_ok").addEventListener("click", () => {
      removeModal();
    });
  }

  function handleShortsVisit() {
    if (!CONFIG.BLOCK_SHORTS) return;
    const to = CONFIG.SHORTS_REDIRECT_URL;
    pauseAllVideos();
    if (to) {
      location.replace(to);
    } else {
      showShortsBlockedModal();
    }
  }

  function hideShortsUI() {
    if (!(CONFIG.BLOCK_SHORTS && CONFIG.HIDE_SHORTS_UI)) return;
    document.querySelectorAll('ytd-reel-shelf-renderer, ytd-reel-item-renderer, ytd-reel-video-renderer, ytd-rich-shelf-renderer[is-shorts], ytm-reel-shelf-renderer, ytm-reel-item-renderer, ytm-reel-video-renderer, ytm-shorts-shelf-renderer').forEach((n) => n.remove());
    const linkSel = 'a[href^="/shorts"], a[href*="://www.youtube.com/shorts"]';
    document.querySelectorAll(linkSel).forEach((a) => {
      const removable = a.closest('ytd-guide-entry-renderer, ytd-mini-guide-entry-renderer, ytd-rich-item-renderer, ytd-rich-section-renderer, ytd-shelf-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-compact-autoplay-renderer, ytd-grid-video-renderer, ytd-rich-grid-row, ytm-item, ytm-guide-entry, ytm-rich-item-renderer, ytm-item-section-renderer, ytm-section-list-renderer, ytm-rich-grid-row');
      if (removable) {
        removable.remove();
      } else {
        a.remove();
      }
    });
    document.querySelectorAll('yt-chip-cloud-chip-renderer, tp-yt-paper-chip, ytm-chip-with-avatar-renderer, ytm-chip-cloud-chip-renderer').forEach((chip) => {
      const text = (chip.textContent || '').trim();
      if (/shorts|ショート/i.test(text)) chip.remove();
    });
    const maybeShelves = document.querySelectorAll('ytd-rich-shelf-renderer, ytd-shelf-renderer, ytd-item-section-renderer, ytd-rich-grid-row, ytm-item-section-renderer, ytm-rich-item-renderer, ytm-section-list-renderer');
    maybeShelves.forEach((el) => {
      const txt = (el.textContent || '').toLowerCase();
      if (/(^|\s)shorts(\s|$)|ショート/.test(txt)) el.remove();
    });
  }

  function hideRecommendationsUI() {
    if (!CONFIG.HIDE_RECOMMENDATIONS) return;
    const path = location.pathname || "";
    if (!/^\/watch/.test(path)) return;
    const selectors = [
      "#secondary",
      "#related",
      "ytd-watch-next-secondary-results-renderer",
      "ytd-compact-autoplay-renderer",
      "ytd-compact-playlist-renderer",
      "ytd-compact-promoted-item-renderer",
      "ytd-compact-video-renderer",
      'ytd-item-section-renderer[section-identifier="watch-next-results"]',
      "ytm-single-column-watch-next-results-renderer",
      'ytm-item-section-renderer[section-identifier="watch-next-results"]',
      "ytm-watch-flexy #related",
      "ytm-watch-flexy ytm-item-section-renderer",
      "ytm-compact-video-renderer",
      "ytm-compact-video-list-renderer",
    ];
    selectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((node) => {
        if (node && node.parentNode) {
          node.remove();
        }
      });
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
      if (CONFIG.BLOCK_SHORTS && isShorts()) {
        handleShortsVisit();
        return;
      }
      hideShortsUI();
      hideRecommendationsUI();
      updateWatchOverlay();
      // 新しい動画では再入力を要求
      const vid = getVideoId();
      const key = currentVideoKey();
      const approved = load(STORAGE_KEYS.approved, {});
      if ((vid && approved[vid]) || approved[key]) {
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
    if (CONFIG.BLOCK_SHORTS && isShorts()) {
      handleShortsVisit();
      return;
    }
    const vid = getVideoId();
    const key = currentVideoKey();
    const approved = load(STORAGE_KEYS.approved, {});
    if (!(vid && approved[vid]) && !approved[key]) {
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

  hideShortsUI();
  hideRecommendationsUI();
  updateWatchOverlay();

  if ((CONFIG.BLOCK_SHORTS && CONFIG.HIDE_SHORTS_UI) || CONFIG.HIDE_RECOMMENDATIONS) {
    const cleaner = new MutationObserver(() => {
      hideShortsUI();
      hideRecommendationsUI();
    });
    cleaner.observe(document.documentElement, { childList: true, subtree: true });
    if (CONFIG.BLOCK_SHORTS && CONFIG.HIDE_SHORTS_UI) {
      document.addEventListener("click", (e) => {
        const target = e.target;
        if (!target || typeof target.closest !== "function") return;
        const shortLink = target.closest('a[href^="/shorts"], a[href*="://www.youtube.com/shorts"]');
        if (shortLink) {
          e.preventDefault();
          e.stopPropagation();
          handleShortsVisit();
        }
      }, true);
    }
  }

  // 4) ページ離脱時にカウント終了
  window.addEventListener("beforeunload", stopTick);

})();

// === 【Daily Purpose on Home Patch】===
(function () {
  "use strict";

  const STORAGE_KEY = "fg_daily_purpose_v1";
  const STYLE_ID = "fg-purpose-style";
  const MODAL_ID = "fg-purpose-modal";
  const DISPLAY_ID = "fg-purpose-display";
  const CHECK_INTERVAL = 2000;
  const EDIT_BUTTON_TEXT = "目的を編集";

  let modalEl = null;
  let displayEl = null;
  let tickTimer = null;
  let isPurposeEditing = false;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

  function init() {
    injectStyles();
    ensureTicker();
    document.addEventListener("yt-navigate-start", handleRouteChange, true);
    document.addEventListener("yt-navigate-finish", handleRouteChange, true);
    document.addEventListener("yt-page-data-updated", handleRouteChange, true);
    window.addEventListener("storage", (event) => {
      if (event.key === STORAGE_KEY) {
        refreshState();
      }
    });
    refreshState();
  }

  function ensureTicker() {
    if (tickTimer) return;
    tickTimer = setInterval(refreshState, CHECK_INTERVAL);
  }

  function handleRouteChange() {
    if (!isHome()) {
      removeModal();
      removeDisplay();
    }
    setTimeout(refreshState, 0);
  }

  function refreshState() {
    if (!isHome()) {
      removeModal();
      removeDisplay();
      return;
    }
    const payload = loadPurpose();
    const today = todayKey();
    const hasToday = payload && payload.date === today;
    const text = hasToday ? String(payload.text || "") : "";
    if (!hasToday || text.trim().length === 0) {
      removeDisplay();
      if (!isPurposeEditing) {
        showModal({ mandatory: true, initialText: text });
      }
    } else {
      if (isPurposeEditing) {
        return;
      }
      removeModal();
      updateDisplay(text);
    }
  }

  function showModal(options = {}) {
    const { mandatory = false, initialText = "" } = options;
    if (!document.body) return;
    if (modalEl && modalEl.isConnected) return;
    removeModal();

    const modal = document.createElement("div");
    modal.id = MODAL_ID;
    modal.className = "fg-purpose-backdrop";
    modal.innerHTML = `
      <div class="fg-purpose-card" role="dialog" aria-modal="true">
        <h2>今日の目的を決めましょう</h2>
        <p class="fg-purpose-sub">YouTubeを開いた理由や今日の達成目標を記入してください。</p>
        <textarea class="fg-purpose-input" rows="4" placeholder="例: 〇〇の学習、〇〇の調査など"></textarea>
        <div class="fg-purpose-actions">
          ${mandatory ? "" : '<button type="button" class="fg-purpose-cancel">キャンセル</button>'}
          <button type="button" class="fg-purpose-save" disabled>保存</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modalEl = modal;
    isPurposeEditing = !mandatory;

    if (!mandatory) {
      modal.addEventListener("click", (ev) => {
        if (ev.target === modal) {
          removeModal();
        }
      });
    }

    const textarea = modal.querySelector(".fg-purpose-input");
    const saveBtn = modal.querySelector(".fg-purpose-save");
    const cancelBtn = modal.querySelector(".fg-purpose-cancel");

    const payload = loadPurpose();
    let prefill = initialText;
    if (!prefill && payload && payload.date === todayKey()) {
      prefill = payload.text || "";
    }
    textarea.value = prefill;
    saveBtn.disabled = textarea.value.trim().length === 0;

    if (cancelBtn) {
      cancelBtn.addEventListener("click", () => {
        isPurposeEditing = false;
        removeModal();
      });
    }

    textarea.addEventListener("input", () => {
      saveBtn.disabled = textarea.value.trim().length === 0;
    });

    const submitPurpose = () => {
      const text = textarea.value.trim();
      if (!text) return;
      const payload = {
        date: todayKey(),
        text,
        updatedAt: Date.now(),
      };
      savePurpose(payload);
      isPurposeEditing = false;
      removeModal();
      updateDisplay(text);
    };

    saveBtn.addEventListener("click", submitPurpose);

    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        if (!saveBtn.disabled) submitPurpose();
      }
    });

    setTimeout(() => {
      textarea.focus();
      textarea.select();
    }, 0);
  }

  function removeModal() {
    if (modalEl) {
      modalEl.remove();
      modalEl = null;
    }
    isPurposeEditing = false;
  }

  function updateDisplay(text) {
    if (!document.body) return;
    if (!isHome()) {
      removeDisplay();
      return;
    }
    let el = displayEl || document.getElementById(DISPLAY_ID);
    if (!el) {
      el = document.createElement("div");
      el.id = DISPLAY_ID;
      el.className = "fg-purpose-display";
      el.innerHTML = `
        <div class="fg-purpose-text"></div>
        <button type="button" class="fg-purpose-edit">${EDIT_BUTTON_TEXT}</button>
      `;
      document.body.appendChild(el);
      displayEl = el;
      const editBtn = el.querySelector(".fg-purpose-edit");
      if (editBtn) {
        editBtn.addEventListener("click", () => {
          const payload = loadPurpose();
          const today = todayKey();
          let current = "";
          if (payload && payload.date === today) {
            current = String(payload.text || "");
          } else {
            const textEl = el.querySelector(".fg-purpose-text");
            current = textEl ? textEl.textContent || "" : "";
          }
          showModal({ mandatory: false, initialText: current });
        });
      }
    }
    const textEl = el.querySelector(".fg-purpose-text");
    if (textEl) {
      textEl.textContent = text;
    } else {
      el.textContent = text;
    }
  }

  function removeDisplay() {
    if (displayEl) {
      displayEl.remove();
      displayEl = null;
    } else {
      const el = document.getElementById(DISPLAY_ID);
      if (el) el.remove();
    }
  }

  function isHome() {
    const path = location.pathname || "";
    return path === "/" || path === "";
  }

  function todayKey() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function loadPurpose() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || typeof data !== "object") return null;
      if (typeof data.text !== "string" || typeof data.date !== "string") return null;
      return {
        date: data.date,
        text: data.text,
        updatedAt: Number(data.updatedAt) || 0,
      };
    } catch {
      return null;
    }
  }

  function savePurpose(payload) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      /* ignore storage errors */
    }
  }

  function injectStyles() {
    const existing = document.getElementById(STYLE_ID);
    if (existing) existing.remove();
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .fg-purpose-backdrop {
        position: fixed;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.55);
        z-index: 2147483647;
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      }
      .fg-purpose-card {
        width: min(92vw, 520px);
        background: rgba(12, 14, 22, 0.95);
        color: #f7f8fb;
        border-radius: 18px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        box-shadow: 0 30px 60px rgba(0, 0, 0, 0.4);
        padding: 24px 26px;
      }
      .fg-purpose-card h2 {
        margin: 0 0 12px;
        font-size: 22px;
        font-weight: 700;
      }
      .fg-purpose-sub {
        margin: 0 0 16px;
        font-size: 14px;
        opacity: 0.82;
        line-height: 1.6;
      }
      .fg-purpose-input {
        width: 100%;
        padding: 12px 14px;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(20, 22, 33, 0.9);
        color: inherit;
        font-size: 16px;
        resize: vertical;
        min-height: 120px;
      }
      .fg-purpose-input:focus {
        outline: none;
        border-color: rgba(98, 146, 255, 0.8);
        box-shadow: 0 0 0 2px rgba(98, 146, 255, 0.35);
      }
      .fg-purpose-actions {
        margin-top: 18px;
        display: flex;
        justify-content: flex-end;
        gap: 10px;
      }
      .fg-purpose-save {
        padding: 10px 18px;
        border-radius: 12px;
        border: none;
        background: #2b5bd7;
        color: #f2f5ff;
        font-weight: 600;
        font-size: 15px;
        cursor: pointer;
        transition: background 0.2s ease, transform 0.2s ease;
      }
      .fg-purpose-save:disabled {
        background: #454a60;
        cursor: not-allowed;
        opacity: 0.7;
      }
      .fg-purpose-save:not(:disabled):hover {
        background: #3166f0;
        transform: translateY(-1px);
      }
      .fg-purpose-cancel {
        padding: 10px 16px;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.18);
        background: rgba(37, 41, 58, 0.8);
        color: #f1f4ff;
        font-size: 15px;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.2s ease, transform 0.2s ease;
      }
      .fg-purpose-cancel:hover {
        background: rgba(52, 57, 78, 0.9);
      }
      .fg-purpose-display {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 2147483600;
        color: rgba(245, 248, 255, 0.9);
        font-size: clamp(22px, 5vw, 38px);
        line-height: 1.4;
        text-align: center;
        padding: 24px 36px;
        background: rgba(15, 17, 28, 0.6);
        border-radius: 24px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        box-shadow: 0 25px 45px rgba(0, 0, 0, 0.4);
        max-width: min(90vw, 760px);
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        backdrop-filter: blur(6px);
        pointer-events: auto;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 18px;
      }
      .fg-purpose-text {
        white-space: pre-wrap;
        word-break: break-word;
      }
      .fg-purpose-edit {
        padding: 8px 16px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.25);
        background: rgba(27, 32, 52, 0.7);
        color: #f2f5ff;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.2s ease, transform 0.2s ease;
      }
      .fg-purpose-edit:hover {
        background: rgba(55, 79, 139, 0.8);
        transform: translateY(-1px);
      }
      .fg-purpose-edit:focus {
        outline: none;
        box-shadow: 0 0 0 2px rgba(98, 146, 255, 0.45);
      }
    `;
    document.head.appendChild(style);
  }
})();

// === 【Leisure-Force-Home Patch】===
(function () {
  "use strict";

  const STORAGE_KEY = "fg_mode_on_search_v1";
  const HOME_PATH = "/";
  const WATCH_PATH = "/watch";
  const CHECK_INTERVAL = 1000;

  let lastMode = null;
  let scheduledUpdate = null;
  let tickTimer = null;
  let redirecting = false;
  let detachDomHandlers = null;
  let detachVideoWatcher = null;
  let videoRetryTimer = null;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

  function init() {
    lastMode = readMode();
    wrapHistory();
    window.addEventListener("popstate", scheduleUpdate, true);
    ["yt-navigate-start", "yt-navigate-finish"].forEach((evt) => {
      window.addEventListener(evt, scheduleUpdate, true);
    });
    document.addEventListener("yt-page-data-updated", scheduleUpdate, true);
    window.addEventListener("storage", (event) => {
      if (event.key === STORAGE_KEY) {
        scheduleUpdate();
      }
    });
    tickTimer = setInterval(checkModeTick, CHECK_INTERVAL);
    updateGuards();
  }

  function checkModeTick() {
    const current = readMode();
    if (current !== lastMode) {
      lastMode = current;
      scheduleUpdate();
    }
  }

  function scheduleUpdate() {
    if (scheduledUpdate) return;
    scheduledUpdate = setTimeout(() => {
      scheduledUpdate = null;
      updateGuards();
    }, 0);
  }

  function updateGuards() {
    if (!isLeisureMode()) {
      clearDomHandlers();
      clearVideoWatcher();
      return;
    }
    clearDomHandlers();
    clearVideoWatcher();
  }

  function attachDomHandlers() {
    if (detachDomHandlers) return;

    const clickHandler = (event) => {
      if (!isLeisureMode()) return;
      const anchor = findAnchor(event.target);
      if (!anchor) return;
      if (!shouldBlockAnchor(anchor)) return;
      event.preventDefault();
      event.stopPropagation();
      goHome();
    };

    const submitHandler = (event) => {
      if (!isLeisureMode()) return;
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (!shouldBlockForm(form)) return;
      event.preventDefault();
      event.stopPropagation();
      goHome();
    };

    const keydownHandler = (event) => {
      if (!isLeisureMode()) return;
      if (isEditableTarget(event.target)) return;
      const key = event.key;
      if (key === "Escape" || key === "h" || key === "H" || key === "Home") {
        event.preventDefault();
        event.stopPropagation();
        goHome();
      }
    };

    document.addEventListener("click", clickHandler, true);
    document.addEventListener("submit", submitHandler, true);
    document.addEventListener("keydown", keydownHandler, true);

    detachDomHandlers = () => {
      document.removeEventListener("click", clickHandler, true);
      document.removeEventListener("submit", submitHandler, true);
      document.removeEventListener("keydown", keydownHandler, true);
      detachDomHandlers = null;
    };
  }

  function clearDomHandlers() {
    if (!detachDomHandlers) return;
    detachDomHandlers();
  }

  function attachVideoWatcher() {
    clearVideoWatcher();
    if (!isLeisureMode()) return;
    if (!isWatchPage()) return;

    let attempts = 0;

    const tryAttach = () => {
      if (!isLeisureMode() || !isWatchPage()) {
        videoRetryTimer = null;
        return;
      }
      const video = document.querySelector("video");
      if (video) {
        const endedHandler = () => {
          goHome();
        };
        video.addEventListener("ended", endedHandler, { once: true });
        detachVideoWatcher = () => {
          video.removeEventListener("ended", endedHandler);
          detachVideoWatcher = null;
        };
        return;
      }
      attempts += 1;
      const delay = attempts < 20 ? 500 : 2000;
      videoRetryTimer = setTimeout(tryAttach, delay);
    };

    tryAttach();
  }

  function clearVideoWatcher() {
    if (videoRetryTimer) {
      clearTimeout(videoRetryTimer);
      videoRetryTimer = null;
    }
    if (detachVideoWatcher) {
      detachVideoWatcher();
      detachVideoWatcher = null;
    }
  }

  function goHome() {
    if (redirecting) return;
    if (location.pathname === HOME_PATH) return;
    redirecting = true;
    location.assign(HOME_PATH);
    setTimeout(() => {
      redirecting = false;
    }, 3000);
  }

  function shouldBlockAnchor(anchor) {
    const href = anchor.getAttribute("href");
    if (!href) return false;
    const trimmed = href.trim();
    if (!trimmed || trimmed.startsWith("#") || /^javascript:/i.test(trimmed)) {
      return false;
    }
    let url;
    try {
      url = new URL(trimmed, location.origin);
    } catch {
      return false;
    }
    if (url.origin !== location.origin) {
      return true;
    }
    return url.pathname !== WATCH_PATH;
  }

  function shouldBlockForm(form) {
    const action = form.getAttribute("action");
    if (!action || action === "#") return false;
    let url;
    try {
      url = new URL(action, location.origin);
    } catch {
      return false;
    }
    if (url.origin !== location.origin) return true;
    return url.pathname !== WATCH_PATH;
  }

  function findAnchor(node) {
    if (!node) return null;
    if (typeof node.closest === "function") {
      return node.closest("a");
    }
    while (node && node !== document) {
      if (node instanceof HTMLAnchorElement) return node;
      node = node.parentNode;
    }
    return null;
  }

  function isEditableTarget(target) {
    if (!target || !(target instanceof Element)) return false;
    if (target.hasAttribute("contenteditable")) return true;
    const tag = target.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
  }

  function wrapHistory() {
    ["pushState", "replaceState"].forEach((method) => {
      const original = history[method];
      if (typeof original !== "function" || original.__fgLeisurePatched) return;
      const wrapped = function (...args) {
        const result = original.apply(this, args);
        scheduleUpdate();
        return result;
      };
      wrapped.__fgLeisurePatched = true;
      history[method] = wrapped;
    });
  }

  function isWatchPage() {
    const path = location.pathname || "";
    return path === WATCH_PATH || path.startsWith(`${WATCH_PATH}/`);
  }

  function readMode() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return typeof parsed.mode === "string" ? parsed.mode : null;
    } catch {
      return null;
    }
  }

  function isLeisureMode() {
    return lastMode === "leisure";
  }
})();

/* Mode-on-Search Patch */
(function () {
  "use strict";

  const STORAGE_KEY = "fg_mode_on_search_v1";
  const STYLE_ID = "fg-mode-style";
  const MODE_MODAL_ID = "fg-mode-modal";
  const LEISURE_MODAL_ID = "fg-leisure-modal";
  const LEISURE_BADGE_ID = "fg-leisure-badge";
  const COLLECT_MODAL_ID = "fg-collect-modal";
  const COLLECT_BADGE_ID = "fg-collect-badge";
  const COLLECT_REVIEW_MODAL_ID = "fg-collect-review";
  const COLLECT_NOTION_MODAL_ID = "fg-collect-notion";
  const MODE_INDICATOR_ID = "fg-mode-indicator";
  const BAN_BADGE_ID = "fg-ban-badge";
  const TOAST_ID = "fg-ban-toast";
  const LEISURE_REMAIN_CLASS = "fg-leisure-remaining";
  const COLLECT_REMAIN_CLASS = "fg-collect-remaining";
  const COLLECT_EXTEND_CLASS = "fg-collect-extend";
  const COLLECT_DONE_CLASS = "fg-collect-done";
  const COLLECT_TOPIC_CLASS = "fg-collect-topic";
  const COLLECT_TIME_OPTIONS = [5, 10, 15];
  const TICK_MS = 1000;

  const state = load();
  state.collectTopic = typeof state.collectTopic === "string" ? state.collectTopic : "";
  state.collectPurpose = typeof state.collectPurpose === "string" ? state.collectPurpose : "";
  state.collectDurationSec = Number(state.collectDurationSec) || 0;
  state.collectUntil = Number(state.collectUntil) || 0;
  state.collectNeedsReview = Boolean(state.collectNeedsReview);
  let modeModalEl = null;
  let leisureModalEl = null;
  let leisureBadgeEl = null;
  let collectModalEl = null;
  let collectBadgeEl = null;
  let collectReviewModalEl = null;
  let collectNotionModalEl = null;
  let modeIndicatorEl = null;
  let banBadgeEl = null;
  let toastEl = null;
  let toastTimer = null;
  let tickHandle = null;
  let hooksAttached = false;
  let suppressPromptOnce = false;
  let activeSearchInput = null;
  let lastSearchInput = null;
  let lastLeisureIncrementSec = 0;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

  function init() {
    injectStyles();
    hookSearchBar();
    ensureTicker();
    restoreUI();
    enforceSearchBan();
    updateModeIndicator();
  }

  function ensureTicker() {
    if (tickHandle) return;
    tickHandle = setInterval(tick, TICK_MS);
    tick();
  }

  function tick() {
    const current = now();
    let changed = false;
    let banJustStarted = false;
    let banDurationSec = 0;

    const leisureActive = state.leisureUntil > current;
    if (!leisureActive && state.leisureUntil > 0) {
      if (state.mode === "leisure" && state.leisureDurationSec > 0) {
        banDurationSec = state.leisureDurationSec * 2;
        state.searchBanUntil = current + banDurationSec * 1000;
        banJustStarted = state.searchBanUntil > current;
      }
      state.leisureUntil = 0;
      state.leisureDurationSec = 0;
      if (state.mode === "leisure") state.mode = null;
      changed = true;
    }

    if (state.leisureUntil > current) {
      showLeisureBadge();
      updateLeisureBadge();
      incrementLeisureWatch();
    } else {
      removeLeisureBadge();
    }

    const collectActive = isCollectActive();
    if (collectActive) {
      showCollectBadge();
      updateCollectBadge();
    } else if (state.collectNeedsReview && state.collectTopic) {
      showCollectCompletionModal();
    } else {
      removeCollectBadge();
      removeCollectReviewModal();
    }

    const banActive = state.searchBanUntil > current;
    if (!banActive && state.searchBanUntil > 0) {
      state.searchBanUntil = 0;
      changed = true;
      removeBanBadge();
      removeBanToast();
    }

    if (banActive) {
      showBanBadge();
      updateBanBadge();
    }

    if (banJustStarted && banDurationSec > 0) {
      showBanBadge();
      updateBanBadge();
      showBanToast(true, banDurationSec);
    }

    if (changed) save();
    enforceSearchBan();
    updateModeIndicator();
  }

  function restoreUI() {
    if (isLeisureActive()) {
      showLeisureBadge();
      updateLeisureBadge();
    }
    if (isCollectActive()) {
      showCollectBadge();
      updateCollectBadge();
    }
    if (isBanActive()) {
      showBanBadge();
      updateBanBadge();
      enforceSearchBan();
    }
    if (state.collectNeedsReview && state.collectTopic && !isCollectActive()) {
      showCollectCompletionModal();
    }
    updateModeIndicator();
  }

  function hookSearchBar() {
    if (hooksAttached) return;
    hooksAttached = true;
    document.addEventListener("focusin", handleFocusIn, true);
    document.addEventListener("focusout", handleFocusOut, true);
    document.addEventListener("submit", handleSubmit, true);
    document.addEventListener("keydown", handleKeyDown, true);
  }

  function handleFocusIn(event) {
    const target = event.target;
    if (!isSearchInput(target)) return;
    activeSearchInput = target;
    lastSearchInput = target;
    if (isBanActive()) {
      enforceSearchBan();
      showBanToast(false);
      return;
    }
    if (modeModalEl || leisureModalEl) return;
    if (isLeisureActive()) return;
    if (suppressPromptOnce) {
      suppressPromptOnce = false;
      return;
    }
    showModeModal();
  }

  function handleFocusOut(event) {
    if (!isSearchInput(event.target)) return;
    activeSearchInput = null;
    if (!isLeisureActive() && state.mode === "study") {
      state.mode = null;
      save();
      updateModeIndicator();
    }
  }

  function handleSubmit(event) {
    const form = event.target;
    if (!isSearchForm(form)) return;
    if (isBanActive()) {
      event.preventDefault();
      event.stopPropagation();
      enforceSearchBan();
      showBanToast(false);
      return;
    }
    if (state.mode === "study") {
      state.mode = null;
      save();
      updateModeIndicator();
    }
  }

  function handleKeyDown(event) {
    if (!isBanActive()) return;
    if (event.key !== "Enter") return;
    const target = event.target;
    if (isSearchInput(target) || isSearchForm(target.closest("form"))) {
      event.preventDefault();
      event.stopPropagation();
      showBanToast(false);
    }
  }

  function showModeModal() {
    if (!document.body) return;
    closeModeModal();
    closeLeisureModal();
    modeModalEl = modal(
      MODE_MODAL_ID,
      `
        <h2>検索モードを選択</h2>
        <div class="fg-mode-sub">目的を決めてから検索しましょう。</div>
        <div class="fg-mode-buttons">
          <button type="button" class="fg-mode-btn" data-mode="study">学習</button>
          <button type="button" class="fg-mode-btn primary" data-mode="leisure">娯楽</button>
          <button type="button" class="fg-mode-btn danger" data-mode="cancel">キャンセル</button>
        </div>
      `,
      (card, wrap) => {
        wrap.addEventListener("click", (ev) => {
          if (ev.target === wrap) {
            state.mode = null;
            save();
            closeModeModal();
            blurSearchInput();
            updateModeIndicator();
          }
        });
        const buttons = card.querySelectorAll(".fg-mode-btn");
        buttons.forEach((btn) => {
          btn.addEventListener("click", () => {
            const mode = btn.getAttribute("data-mode");
            if (mode === "leisure") {
              closeModeModal();
              askLeisureMinutes();
              return;
            }
            if (mode === "collect") {
              closeModeModal();
              showCollectSetupModal();
              return;
            }
            if (mode === "cancel") {
              state.mode = null;
              state.collectTopic = "";
              state.collectPurpose = "";
              state.collectDurationSec = 0;
              state.collectUntil = 0;
              state.collectNeedsReview = false;
              save();
              closeModeModal();
              blurSearchInput();
              removeCollectBadge();
              removeCollectReviewModal();
              closeCollectModal();
              closeCollectNotionModal();
              updateModeIndicator();
              return;
            }
            state.mode = "study";
            state.leisureUntil = 0;
            state.leisureDurationSec = 0;
            state.collectTopic = "";
            state.collectPurpose = "";
            state.collectDurationSec = 0;
            state.collectUntil = 0;
            state.collectNeedsReview = false;
            save();
            closeModeModal();
            focusSearchInput();
            removeCollectBadge();
            removeCollectReviewModal();
            closeCollectModal();
            closeCollectNotionModal();
            updateModeIndicator();
          });
        });
        const first = card.querySelector(".fg-mode-btn");
        if (first) first.focus();
      }
    );
  }

  function closeModeModal() {
    if (!modeModalEl) return;
    close(modeModalEl);
    modeModalEl = null;
  }

  function showCollectSetupModal(options = {}) {
    const {
      initialTopic = state.collectTopic || "",
      initialPurpose = state.collectPurpose || "",
      initialMinutes = state.collectDurationSec ? Math.round(state.collectDurationSec / 60) : 0,
      isExtension = false,
    } = options;

    if (collectModalEl) {
      close(collectModalEl);
      collectModalEl = null;
    }

    const title = isExtension ? "情報収集を延長" : "情報収集モード";
    const actionLabel = isExtension ? "延長開始" : "開始";

    const timeButtons = COLLECT_TIME_OPTIONS.map((min) => `
      <button type="button" class="fg-mode-btn fg-collect-time-btn${min === initialMinutes ? " selected" : ""}" data-min="${min}">${min} 分</button>
    `).join("");

    collectModalEl = modal(
      COLLECT_MODAL_ID,
      `
        <div class="fg-mode-sub">調べたい内容と目的、所要時間を入力してください。</div>
        <div class="fg-mode-buttons fg-collect-field">
          <label class="fg-collect-label">調べたい内容</label>
          <textarea class="fg-collect-input" id="fg_collect_topic" rows="3" placeholder="例: 最新のLLMベンチマークと特徴"></textarea>
        </div>
        <div class="fg-mode-buttons fg-collect-field">
          <label class="fg-collect-label">何のために調べる？</label>
          <input type="text" class="fg-collect-purpose" id="fg_collect_purpose" placeholder="例: 社内共有資料にまとめる" />
        </div>
        <div class="fg-mode-buttons fg-mode-buttons-inline fg-collect-time-picker">
          ${timeButtons}
        </div>
        <div class="fg-mode-buttons fg-collect-actions">
          <button type="button" class="fg-mode-btn danger" data-action="cancel">キャンセル</button>
          <button type="button" class="fg-mode-btn primary" data-action="save" disabled>${actionLabel}</button>
        </div>
      `,
      (card, wrap) => {
        wrap.addEventListener("click", (ev) => {
          if (ev.target === wrap) {
            closeCollectModal();
            if (!isExtension && !state.collectTopic) {
              state.mode = null;
              save();
              updateModeIndicator();
            }
          }
        });

        const topicEl = card.querySelector("#fg_collect_topic");
        const purposeEl = card.querySelector("#fg_collect_purpose");
        const saveBtn = card.querySelector('[data-action="save"]');
        const cancelBtn = card.querySelector('[data-action="cancel"]');
        const timeBtns = Array.from(card.querySelectorAll(".fg-collect-time-btn"));

        let selectedMinutes = initialMinutes && COLLECT_TIME_OPTIONS.includes(initialMinutes) ? initialMinutes : 0;

        const updateSaveState = () => {
          const topicOk = topicEl.value.trim().length >= 3;
          const purposeOk = purposeEl.value.trim().length >= 3;
          saveBtn.disabled = !(topicOk && purposeOk && selectedMinutes > 0);
        };

        timeBtns.forEach((btn) => {
          btn.addEventListener("click", () => {
            timeBtns.forEach((b) => b.classList.remove("selected"));
            btn.classList.add("selected");
            selectedMinutes = Number(btn.getAttribute("data-min") || "0");
            updateSaveState();
          });
        });

        topicEl.value = initialTopic;
        purposeEl.value = initialPurpose;
        updateSaveState();

        topicEl.addEventListener("input", updateSaveState);
        purposeEl.addEventListener("input", updateSaveState);

        topicEl.addEventListener("keydown", (event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            if (!saveBtn.disabled) saveBtn.click();
          }
        });

        purposeEl.addEventListener("keydown", (event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            if (!saveBtn.disabled) saveBtn.click();
          }
        });

        if (cancelBtn) {
          cancelBtn.addEventListener("click", () => {
            closeCollectModal();
            if (!isExtension && !state.collectTopic) {
              state.mode = null;
              save();
              updateModeIndicator();
            } else if (isExtension) {
              state.collectNeedsReview = true;
              save();
              if (!isCollectActive()) {
                showCollectCompletionModal();
              }
            }
          });
        }

        saveBtn.addEventListener("click", () => {
          const topic = topicEl.value.trim();
          const purpose = purposeEl.value.trim();
          if (!topic || !purpose || selectedMinutes <= 0) return;
          startCollectSession({ topic, purpose, minutes: selectedMinutes });
          closeCollectModal();
        });

        setTimeout(() => {
          topicEl.focus();
          topicEl.select();
        }, 0);
      }
    );
  }

  function closeCollectModal() {
    if (!collectModalEl) return;
    close(collectModalEl);
    collectModalEl = null;
  }

  function askLeisureMinutes() {
    if (!document.body) return;
    closeLeisureModal();
    leisureModalEl = modal(
      LEISURE_MODAL_ID,
      `
        <h2>娯楽タイマー</h2>
        <div class="fg-mode-sub">視聴時間を選んでタイマーを開始します。</div>
        <div class="fg-mode-buttons fg-mode-buttons-inline">
          <button type="button" class="fg-mode-btn primary" data-sec="300">5 分</button>
          <button type="button" class="fg-mode-btn primary" data-sec="600">10 分</button>
          <button type="button" class="fg-mode-btn primary" data-sec="900">15 分</button>
        </div>
        <div class="fg-mode-buttons">
          <button type="button" class="fg-mode-btn danger" data-action="cancel">キャンセル</button>
        </div>
      `,
      (card, wrap) => {
        wrap.addEventListener("click", (ev) => {
          if (ev.target === wrap) {
            state.mode = null;
            save();
            closeLeisureModal();
            blurSearchInput();
          }
        });
        card.querySelectorAll("[data-sec]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const sec = Number(btn.getAttribute("data-sec") || "0");
            if (sec > 0) {
              startLeisureTimer(sec);
            }
          });
        });
        const cancel = card.querySelector('[data-action="cancel"]');
        if (cancel) {
          cancel.addEventListener("click", () => {
            state.mode = null;
            save();
            closeLeisureModal();
            blurSearchInput();
          });
        }
        const first = card.querySelector("[data-sec]");
        if (first) first.focus();
      }
    );
  }

  function closeLeisureModal() {
    if (!leisureModalEl) return;
    close(leisureModalEl);
    leisureModalEl = null;
  }

  function startLeisureTimer(seconds) {
    state.mode = "leisure";
    state.leisureDurationSec = seconds;
    state.leisureUntil = now() + seconds * 1000;
    save();
    closeLeisureModal();
    showLeisureBadge();
    updateLeisureBadge();
    ensureTicker();
    removeBanToast();
    focusSearchInput();
    updateModeIndicator();
  }

  function startCollectSession({ topic, purpose, minutes }) {
    state.mode = "collect";
    state.collectTopic = topic;
    state.collectPurpose = purpose;
    state.collectDurationSec = minutes * 60;
    state.collectUntil = now() + minutes * 60 * 1000;
    state.collectNeedsReview = true;
    save();
    removeCollectReviewModal();
    closeCollectNotionModal();
    showCollectBadge();
    updateCollectBadge();
    ensureTicker();
    updateModeIndicator();
    focusSearchInput();
  }

  function showLeisureBadge() {
    if (!document.body) return;
    const existing = document.getElementById(LEISURE_BADGE_ID);
    if (existing) existing.remove();
    leisureBadgeEl = document.createElement("div");
    leisureBadgeEl.id = LEISURE_BADGE_ID;
    leisureBadgeEl.className = "fg-badge";
    leisureBadgeEl.innerHTML = `
      <div class="fg-leisure-label">
        娯楽 残り <span class="${LEISURE_REMAIN_CLASS}">${fmt(getRemainingSec(state.leisureUntil))}</span>
      </div>
    `;
    document.body.appendChild(leisureBadgeEl);
  }

  function updateLeisureBadge() {
    if (!isLeisureActive()) {
      removeLeisureBadge();
      return;
    }
    if (!leisureBadgeEl) leisureBadgeEl = document.getElementById(LEISURE_BADGE_ID);
    if (!leisureBadgeEl) {
      showLeisureBadge();
      return;
    }
    const remainEl = leisureBadgeEl.querySelector(`.${LEISURE_REMAIN_CLASS}`);
    if (remainEl) {
      remainEl.textContent = fmt(getRemainingSec(state.leisureUntil));
    } else {
      leisureBadgeEl.textContent = `娯楽 残り ${fmt(getRemainingSec(state.leisureUntil))}`;
    }
  }

  function removeLeisureBadge() {
    if (leisureBadgeEl) {
      leisureBadgeEl.remove();
      leisureBadgeEl = null;
    } else {
      const existing = document.getElementById(LEISURE_BADGE_ID);
      if (existing) existing.remove();
    }
  }

  function showCollectBadge() {
    if (!document.body) return;
    const existing = document.getElementById(COLLECT_BADGE_ID);
    if (existing) existing.remove();
    collectBadgeEl = document.createElement("div");
    collectBadgeEl.id = COLLECT_BADGE_ID;
    collectBadgeEl.className = "fg-badge fg-collect-badge";
    const topic = escapeHtml(state.collectTopic || "");
    collectBadgeEl.innerHTML = `
      <div class="fg-collect-row">
        <span class="fg-collect-label">情報収集</span>
        <span class="${COLLECT_TOPIC_CLASS}">${topic}</span>
      </div>
      <div class="fg-collect-row">
        <span>残り</span>
        <span class="${COLLECT_REMAIN_CLASS}">${formatHMS(Math.max(0, Math.ceil((state.collectUntil - now()) / 1000)))}</span>
      </div>
      <div class="fg-collect-actions">
        <button type="button" class="fg-collect-btn ${COLLECT_DONE_CLASS}">完了</button>
        <button type="button" class="fg-collect-btn ${COLLECT_EXTEND_CLASS}">延長</button>
      </div>
    `;
    const doneBtn = collectBadgeEl.querySelector(`.${COLLECT_DONE_CLASS}`);
    const extendBtn = collectBadgeEl.querySelector(`.${COLLECT_EXTEND_CLASS}`);
    if (doneBtn) {
      doneBtn.addEventListener("click", () => {
        completeCollectSession(true);
      });
    }
    if (extendBtn) {
      extendBtn.addEventListener("click", () => {
        showCollectExtensionSetup();
      });
    }
    document.body.appendChild(collectBadgeEl);
  }

  function updateCollectBadge() {
    if (!isCollectActive()) {
      removeCollectBadge();
      return;
    }
    if (!collectBadgeEl) collectBadgeEl = document.getElementById(COLLECT_BADGE_ID);
    if (!collectBadgeEl) {
      showCollectBadge();
      return;
    }
    const remainEl = collectBadgeEl.querySelector(`.${COLLECT_REMAIN_CLASS}`);
    if (remainEl) {
      remainEl.textContent = formatHMS(Math.max(0, Math.ceil((state.collectUntil - now()) / 1000)));
    }
    const topicEl = collectBadgeEl.querySelector(`.${COLLECT_TOPIC_CLASS}`);
    if (topicEl) topicEl.textContent = state.collectTopic;
  }

  function removeCollectBadge() {
    if (collectBadgeEl) {
      collectBadgeEl.remove();
      collectBadgeEl = null;
    } else {
      const el = document.getElementById(COLLECT_BADGE_ID);
      if (el) el.remove();
    }
  }

  function showCollectCompletionModal() {
    if (collectReviewModalEl) return;
    const topic = escapeHtml(state.collectTopic || "");
    const purpose = escapeHtml(state.collectPurpose || "");
    collectReviewModalEl = modal(
      COLLECT_REVIEW_MODAL_ID,
      `
        <div class="fg-mode-sub">設定した時間が終了しました。結果を確認してください。</div>
        <div class="fg-collect-summary">
          <div><strong>調べた内容:</strong> ${topic || "-"}</div>
          <div><strong>目的:</strong> ${purpose || "-"}</div>
        </div>
        <div class="fg-collect-actions">
          <button type="button" class="fg-mode-btn primary" data-action="done">完了</button>
          <button type="button" class="fg-mode-btn" data-action="extend">時間を追加する</button>
        </div>
      `,
      (card) => {
        const doneBtn = card.querySelector('[data-action="done"]');
        const extendBtn = card.querySelector('[data-action="extend"]');
        if (doneBtn) {
          doneBtn.addEventListener("click", () => {
            completeCollectSession(true);
            removeCollectReviewModal();
          });
        }
        if (extendBtn) {
          extendBtn.addEventListener("click", () => {
            state.collectNeedsReview = false;
            save();
            removeCollectReviewModal();
            showCollectExtensionSetup();
          });
        }
        doneBtn?.focus();
      }
    );
  }

  function removeCollectReviewModal() {
    if (collectReviewModalEl) {
      close(collectReviewModalEl);
      collectReviewModalEl = null;
    }
  }

  function showCollectExtensionSetup() {
    const minutes = state.collectDurationSec ? Math.max(1, Math.round(state.collectDurationSec / 60)) : COLLECT_TIME_OPTIONS[0];
    showCollectSetupModal({
      initialTopic: state.collectTopic,
      initialPurpose: state.collectPurpose,
      initialMinutes: COLLECT_TIME_OPTIONS.includes(minutes) ? minutes : COLLECT_TIME_OPTIONS[0],
      isExtension: true,
    });
  }

  function completeCollectSession(success) {
    removeCollectBadge();
    removeCollectReviewModal();
    closeCollectModal();
    state.collectUntil = 0;
    state.collectDurationSec = 0;
    state.collectNeedsReview = false;
    const topic = state.collectTopic;
    const purpose = state.collectPurpose;
    if (success) {
      state.mode = null;
      state.collectTopic = "";
      state.collectPurpose = "";
    }
    save();
    updateModeIndicator();
    if (success) {
      showCollectNotionPrompt(topic, purpose);
    }
  }

  function showCollectNotionPrompt(topic, purpose) {
    if (collectNotionModalEl) {
      close(collectNotionModalEl);
      collectNotionModalEl = null;
    }
    const topicText = escapeHtml(topic || "");
    const purposeText = escapeHtml(purpose || "");
    collectNotionModalEl = modal(
      COLLECT_NOTION_MODAL_ID,
      `
        <div class="fg-mode-sub">情報整理を Notion などにまとめておきましょう。</div>
        <div class="fg-collect-summary">
          <div><strong>調べた内容:</strong> ${topicText || "-"}</div>
          <div><strong>目的:</strong> ${purposeText || "-"}</div>
        </div>
        <div class="fg-collect-actions">
          <button type="button" class="fg-mode-btn primary" data-action="ok">OK</button>
        </div>
      `,
      (card, wrap) => {
        wrap.addEventListener("click", (ev) => {
          if (ev.target === wrap) {
            closeCollectNotionModal();
          }
        });
        const okBtn = card.querySelector('[data-action="ok"]');
        okBtn?.addEventListener("click", () => {
          closeCollectNotionModal();
        });
        okBtn?.focus();
      }
    );
  }

  function closeCollectNotionModal() {
    if (collectNotionModalEl) {
      close(collectNotionModalEl);
      collectNotionModalEl = null;
    }
    updateModeIndicator();
  }

  function incrementLeisureWatch() {
    if (!isLeisureMode()) return;
    if (isVideoPlaying()) return;
    const nowSec = Math.floor(Date.now() / 1000);
    if (lastLeisureIncrementSec === nowSec) return;
    lastLeisureIncrementSec = nowSec;

    const today = todayKey();
    if (!today) return;
    const KEY = "yt_reason_daily_v1";
    let store = {};
    try {
      store = JSON.parse(localStorage.getItem(KEY)) || {};
    } catch {
      store = {};
    }
    const entry = normalizeDailyEntry(store[today]);
    entry.totalSeconds += 1;
    entry.nonLearningSeconds += 1;
    entry.entertainmentSeconds += 1;
    store[today] = entry;
    try {
      localStorage.setItem(KEY, JSON.stringify(store));
    } catch {
      /* ignore quota errors */
    }
    refreshWatchOverlay(entry);
  }

  function normalizeDailyEntry(val) {
    const base = {
      totalSeconds: 0,
      nonLearningSeconds: 0,
      learningSeconds: 0,
      entertainmentSeconds: 0,
    };
    if (!val || typeof val !== "object") return { ...base };
    return {
      totalSeconds: Math.max(0, Number(val.totalSeconds) || 0),
      nonLearningSeconds: Math.max(0, Number(val.nonLearningSeconds) || 0),
      learningSeconds: Math.max(0, Number(val.learningSeconds) || 0),
      entertainmentSeconds: Math.max(0, Number(val.entertainmentSeconds) || 0),
    };
  }

  function refreshWatchOverlay(entry) {
    const overlay = document.querySelector(".yt-watch-overlay");
    if (!overlay) return;
    const stats = entry || getTodayStats();
    if (!stats) return;
    const totalEl = overlay.querySelector(".yt-watch-total");
    const learnRow = overlay.querySelector(".yt-watch-learning");
    const learnTimeEl = learnRow ? learnRow.querySelector(".time") : null;
    const entertainRow = overlay.querySelector(".yt-watch-entertain");
    const entertainTimeEl = entertainRow ? entertainRow.querySelector(".time") : null;
    const nonRow = overlay.querySelector(".yt-watch-nonlearning");
    const nonTimeEl = nonRow ? nonRow.querySelector(".time") : null;

    if (totalEl) totalEl.textContent = formatHMS(stats.totalSeconds);
    if (learnRow && learnTimeEl) {
      learnRow.style.display = "flex";
      learnTimeEl.textContent = formatHMS(stats.learningSeconds);
    }
    if (entertainRow && entertainTimeEl) {
      entertainRow.style.display = "flex";
      entertainTimeEl.textContent = formatHMS(stats.entertainmentSeconds);
    }
    if (nonRow && nonTimeEl) {
      const otherSeconds = Math.max(0, stats.nonLearningSeconds - stats.entertainmentSeconds);
      if (otherSeconds > 0) {
        nonRow.style.display = "flex";
        nonTimeEl.textContent = formatHMS(otherSeconds);
      } else {
        nonRow.style.display = "none";
      }
    }
  }

  function getTodayStats() {
    const KEY = "yt_reason_daily_v1";
    const today = todayKey();
    if (!today) return null;
    try {
      const store = JSON.parse(localStorage.getItem(KEY)) || {};
      return normalizeDailyEntry(store[today]);
    } catch {
      return null;
    }
  }

  function formatHMS(sec) {
    const total = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }

  function isCollectActive() {
    return state.collectUntil > now();
  }

  function ensureModeIndicator() {
    if (!document.body) return null;
    if (!modeIndicatorEl) {
      modeIndicatorEl = document.createElement("div");
      modeIndicatorEl.id = MODE_INDICATOR_ID;
      modeIndicatorEl.className = "fg-mode-indicator";
      document.body.appendChild(modeIndicatorEl);
    }
    return modeIndicatorEl;
  }

  function removeModeIndicator() {
    if (modeIndicatorEl) {
      modeIndicatorEl.remove();
      modeIndicatorEl = null;
    } else {
      const el = document.getElementById(MODE_INDICATOR_ID);
      if (el) el.remove();
    }
  }

  function updateModeIndicator() {
    const mode = state.mode;
    const leisureActive = isLeisureActive();
    const collectActive = isCollectActive();
    const needsReview = state.collectNeedsReview && state.collectTopic;
    if (!mode && !leisureActive && !collectActive && !needsReview) {
      removeModeIndicator();
      return;
    }
    const el = ensureModeIndicator();
    if (!el) return;

    let text = "";
    if (mode === "study") {
      text = "現在モード: 学習";
    } else if (mode === "leisure" || leisureActive) {
      const remain = leisureActive ? formatHMS(Math.max(0, Math.ceil((state.leisureUntil - now()) / 1000))) : "完了";
      text = leisureActive ? `現在モード: 娯楽（残り ${remain}）` : "現在モード: 娯楽";
    } else if (mode === "collect" || collectActive || needsReview) {
      const topic = state.collectTopic ? `「${state.collectTopic}」` : "";
      if (collectActive) {
        const remain = formatHMS(Math.max(0, Math.ceil((state.collectUntil - now()) / 1000)));
        text = `現在モード: 情報収集${topic ? ` ${topic}` : ""}（残り ${remain}）`;
      } else if (needsReview) {
        text = `情報収集の確認待ち${topic ? ` ${topic}` : ""}`;
      } else {
        text = `現在モード: 情報収集${topic ? ` ${topic}` : ""}`;
      }
    } else if (mode === "leisure") {
      text = "現在モード: 娯楽";
    } else if (mode === "collect") {
      text = "現在モード: 情報収集";
    } else {
      text = "現在モード: -";
    }

    el.textContent = text;
  }

  function todayKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function isVideoPlaying() {
    const videos = Array.from(document.querySelectorAll("video"));
    return videos.some((video) => {
      try {
        return !video.paused && !video.ended && video.readyState >= 2;
      } catch {
        return false;
      }
    });
  }

  function showBanBadge() {
    if (!document.body) return;
    const existing = document.getElementById(BAN_BADGE_ID);
    if (existing) existing.remove();
    banBadgeEl = document.createElement("div");
    banBadgeEl.id = BAN_BADGE_ID;
    banBadgeEl.className = "fg-badge";
    banBadgeEl.textContent = `検索禁止 残り ${fmt(getRemainingSec(state.searchBanUntil))}`;
    document.body.appendChild(banBadgeEl);
  }

  function updateBanBadge() {
    if (!isBanActive()) {
      removeBanBadge();
      return;
    }
    if (!banBadgeEl) banBadgeEl = document.getElementById(BAN_BADGE_ID);
    if (!banBadgeEl) {
      showBanBadge();
      return;
    }
    banBadgeEl.textContent = `検索禁止 残り ${fmt(getRemainingSec(state.searchBanUntil))}`;
  }

  function removeBanBadge() {
    if (banBadgeEl) {
      banBadgeEl.remove();
      banBadgeEl = null;
    } else {
      const existing = document.getElementById(BAN_BADGE_ID);
      if (existing) existing.remove();
    }
  }

  function showBanToast(justStarted, totalSec) {
    const remaining = getRemainingSec(state.searchBanUntil);
    if (remaining <= 0) return;
    const total = typeof totalSec === "number" && totalSec > 0 ? fmt(totalSec) : null;
    const message = justStarted
      ? `検索禁止モード開始 (${total ?? fmt(remaining)})。残り ${fmt(remaining)}。`
      : `検索禁止中です。残り ${fmt(remaining)}。`;
    toast(message);
  }

  function toast(text) {
    if (!document.body) return;
    removeBanToast();
    toastEl = document.createElement("div");
    toastEl.id = TOAST_ID;
    toastEl.textContent = text;
    toastEl.setAttribute("role", "status");
    document.body.appendChild(toastEl);
    toastTimer = setTimeout(removeBanToast, 3200);
  }

  function removeBanToast() {
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    if (toastEl) {
      toastEl.remove();
      toastEl = null;
    } else {
      const existing = document.getElementById(TOAST_ID);
      if (existing) existing.remove();
    }
  }

  function enforceSearchBan() {
    const active = isBanActive();
    const inputs = querySearchInputs();
    inputs.forEach((input) => {
      if (!(input instanceof HTMLInputElement)) return;
      if (active) {
        if (!input.dataset.fgBanFlag) {
          input.dataset.fgBanFlag = input.disabled ? "1" : "0";
        }
        input.disabled = true;
        input.setAttribute("aria-disabled", "true");
        input.classList.add("fg-search-blocked");
        if (document.activeElement === input) {
          input.blur();
        }
      } else if (input.dataset.fgBanFlag !== undefined) {
        if (input.dataset.fgBanFlag === "0") {
          input.disabled = false;
        }
        delete input.dataset.fgBanFlag;
        input.removeAttribute("aria-disabled");
        input.classList.remove("fg-search-blocked");
      }
    });
  }

  function modal(id, innerHTML, onAttach) {
    const existing = document.getElementById(id);
    if (existing) existing.remove();
    const wrap = document.createElement("div");
    wrap.id = id;
    wrap.className = "fg-modal-backdrop";
    wrap.innerHTML = `<div class="fg-modal-card" role="dialog" aria-modal="true">${innerHTML}</div>`;
    document.body.appendChild(wrap);
    const card = wrap.querySelector(".fg-modal-card");
    if (typeof onAttach === "function") {
      onAttach(card, wrap);
    }
    return wrap;
  }

  function close(el) {
    if (el && el.parentNode) {
      el.parentNode.removeChild(el);
    }
  }

  function blurSearchInput() {
    if (activeSearchInput && typeof activeSearchInput.blur === "function") {
      activeSearchInput.blur();
    }
  }

  function focusSearchInput() {
    if (!lastSearchInput || isBanActive()) return;
    suppressPromptOnce = true;
    setTimeout(() => {
      if (!lastSearchInput || isBanActive()) {
        suppressPromptOnce = false;
        return;
      }
      try {
        lastSearchInput.focus();
        if (typeof lastSearchInput.select === "function") {
          lastSearchInput.select();
        }
      } catch (err) {
        // ignore
      } finally {
        suppressPromptOnce = false;
      }
    }, 0);
  }

  function injectStyles() {
    const existing = document.getElementById(STYLE_ID);
    if (existing) existing.remove();
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .fg-modal-backdrop {
        position: fixed;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.45);
        z-index: 2147483647;
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      }
      .fg-modal-card {
        width: min(92vw, 360px);
        background: rgba(18, 18, 22, 0.96);
        color: #f1f3f6;
        border-radius: 16px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        box-shadow: 0 28px 56px rgba(0, 0, 0, 0.45);
        padding: 20px 22px 24px;
      }
      .fg-modal-card h2 {
        margin: 0 0 10px;
        font-size: 18px;
        font-weight: 700;
      }
      .fg-mode-sub {
        font-size: 13px;
        opacity: 0.78;
        line-height: 1.5;
      }
      .fg-mode-buttons {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-top: 16px;
      }
      .fg-mode-buttons-inline {
        flex-direction: row;
        flex-wrap: wrap;
        justify-content: space-between;
      }
      .fg-mode-buttons-inline .fg-mode-btn {
        flex: 1 1 calc(33% - 8px);
        min-width: 90px;
      }
      .fg-mode-btn {
        padding: 11px 14px;
        border-radius: 12px;
        border: none;
        background: #2c2e3a;
        color: #fefefe;
        cursor: pointer;
        font-size: 15px;
        font-weight: 600;
        transition: background 0.2s ease, transform 0.2s ease;
      }
      .fg-mode-btn:hover {
        background: #3c3f4c;
        transform: translateY(-1px);
      }
      .fg-mode-btn:focus {
        outline: none;
        box-shadow: 0 0 0 2px rgba(86, 141, 255, 0.6);
      }
      .fg-mode-btn.selected {
        background: #3166f0;
        border-color: rgba(120, 170, 255, 0.6);
      }
      .fg-mode-btn.primary {
        background: #2b5bd7;
      }
      .fg-mode-btn.primary:hover {
        background: #3166f0;
      }
      .fg-mode-btn.danger {
        background: #a23a3a;
      }
      .fg-mode-btn.danger:hover {
        background: #b64444;
      }
      .fg-badge {
        position: fixed;
        z-index: 2147483647;
        padding: 10px 16px;
        border-radius: 12px;
        background: rgba(20, 22, 33, 0.9);
        color: #f7f9ff;
        font-size: 13px;
        font-weight: 600;
        box-shadow: 0 18px 36px rgba(0, 0, 0, 0.45);
        border: 1px solid rgba(255, 255, 255, 0.08);
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      }
      #fg-leisure-badge {
        right: 18px;
        bottom: 18px;
        display: flex;
        align-items: center;
        gap: 12px;
      }
      #fg-leisure-badge button {
        display: none !important;
      }
      #fg-leisure-badge .fg-leisure-label {
        display: flex;
        align-items: center;
        gap: 6px;
        font-weight: 600;
      }
      #fg-leisure-badge .${LEISURE_REMAIN_CLASS} {
        font-variant-numeric: tabular-nums;
      }
      #${MODE_INDICATOR_ID} {
        position: fixed;
        top: 72px;
        left: 18px;
        z-index: 2147483500;
        padding: 10px 14px;
        border-radius: 10px;
        background: rgba(20, 24, 35, 0.88);
        color: #f2f5ff;
        font-size: 13px;
        font-weight: 600;
        border: 1px solid rgba(255, 255, 255, 0.08);
        box-shadow: 0 12px 24px rgba(0, 0, 0, 0.35);
      }
      .fg-collect-badge {
        right: 18px;
        bottom: 94px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 220px;
      }
      .fg-collect-row {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        font-size: 12px;
        font-weight: 500;
      }
      .fg-collect-row .${COLLECT_TOPIC_CLASS} {
        font-weight: 700;
      }
      .fg-collect-label {
        opacity: 0.85;
      }
      .fg-collect-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
      }
      .fg-collect-btn {
        padding: 6px 12px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.18);
        background: rgba(55, 74, 120, 0.8);
        color: #f3f5ff;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.2s ease, transform 0.2s ease;
      }
      .fg-collect-btn:hover {
        background: rgba(75, 98, 150, 0.9);
        transform: translateY(-1px);
      }
      .fg-collect-field label {
        font-size: 12px;
        opacity: 0.75;
      }
      .fg-collect-time-picker {
        flex-wrap: wrap;
      }
      .fg-collect-input,
      .fg-collect-purpose {
        width: 100%;
        padding: 10px 12px;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(20, 22, 33, 0.9);
        color: #f2f5ff;
        font-size: 15px;
        resize: vertical;
      }
      .fg-collect-input:focus,
      .fg-collect-purpose:focus {
        outline: none;
        border-color: rgba(98, 146, 255, 0.7);
        box-shadow: 0 0 0 2px rgba(98, 146, 255, 0.35);
      }
      .fg-collect-summary {
        margin: 14px 0;
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 14px;
      }
      #fg-ban-badge {
        left: 18px;
        bottom: 18px;
      }
      #fg-ban-toast {
        position: fixed;
        left: 50%;
        bottom: 32px;
        transform: translateX(-50%);
        background: rgba(25, 27, 40, 0.95);
        color: #f5f7ff;
        border-radius: 12px;
        padding: 12px 18px;
        z-index: 2147483647;
        box-shadow: 0 16px 32px rgba(0, 0, 0, 0.4);
        border: 1px solid rgba(255, 255, 255, 0.08);
        font-size: 14px;
        max-width: 80vw;
        text-align: center;
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      }
      .fg-search-blocked {
        cursor: not-allowed !important;
      }
    `;
    document.head.appendChild(style);
  }

  function getSearchSelectors() {
    return [
      "input#search",
      "input#search-input",
      "input#masthead-search-term",
      "input[id='searchbox-input']",
      "ytd-searchbox input",
      "input[name='search_query']",
      "form#search-form input",
      "input[aria-label*='Search']",
      "input[aria-label*='search']",
      "input[aria-label*='検索']",
      "input[type='search']"
    ];
  }

  function querySearchInputs() {
    const selectors = getSearchSelectors();
    const results = [];
    selectors.forEach((selector) => {
      let nodes;
      try {
        nodes = document.querySelectorAll(selector);
      } catch {
        nodes = [];
      }
      nodes.forEach((node) => {
        if (!(node instanceof HTMLInputElement)) return;
        if (!results.includes(node)) results.push(node);
      });
    });
    return results;
  }

  function isSearchInput(el) {
    if (!(el instanceof HTMLInputElement)) return false;
    const selectors = getSearchSelectors();
    return selectors.some((selector) => {
      try {
        return el.matches(selector);
      } catch {
        return false;
      }
    });
  }

  function isSearchForm(el) {
    if (!(el instanceof HTMLFormElement)) return false;
    const inputs = querySearchInputs();
    return inputs.some((input) => input.form === el || el.contains(input));
  }

  function now() {
    return Date.now();
  }

  function getRemainingSec(untilMs) {
    return Math.max(0, Math.ceil((untilMs - now()) / 1000));
  }

  function fmt(sec) {
    const total = Math.max(0, Math.floor(sec));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n) => String(n).padStart(2, "0");
    if (h > 0) {
      return `${h}:${pad(m)}:${pad(s)}`;
    }
    return `${pad(m)}:${pad(s)}`;
  }

  function isLeisureActive() {
    return state.leisureUntil > now();
  }

  function isBanActive() {
    return state.searchBanUntil > now();
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* ignore quota errors */
    }
  }

  function load() {
  const fallback = {
    mode: null,
    leisureUntil: 0,
    searchBanUntil: 0,
    leisureDurationSec: 0,
    collectUntil: 0,
    collectDurationSec: 0,
    collectTopic: "",
    collectPurpose: "",
    collectNeedsReview: false
  };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
    return {
      mode: typeof parsed.mode === "string" ? parsed.mode : null,
      leisureUntil: Number(parsed.leisureUntil) || 0,
      searchBanUntil: Number(parsed.searchBanUntil) || 0,
      leisureDurationSec: Number(parsed.leisureDurationSec) || 0,
      collectUntil: Number(parsed.collectUntil) || 0,
      collectDurationSec: Number(parsed.collectDurationSec) || 0,
      collectTopic: typeof parsed.collectTopic === "string" ? parsed.collectTopic : "",
      collectPurpose: typeof parsed.collectPurpose === "string" ? parsed.collectPurpose : "",
      collectNeedsReview: Boolean(parsed.collectNeedsReview)
    };
    } catch {
      return fallback;
    }
  }
})();

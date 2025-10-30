// ==UserScript==
// @name         YouTube: 再生前に理由入力 (iPad)
// @namespace    https://example.taka/yt-reason
// @version      0.1.0
// @description  iPad の YouTube で再生前に視聴理由を入力。学習以外の視聴時間を集計し、Shorts をブロックします。
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
    ENABLE_NON_LEARNING_LIMIT: false,
    NON_LEARNING_LIMIT_MIN: 30,
    ENABLE_ENTERTAINMENT_LIMIT: false,
    ENTERTAINMENT_LIMIT_MIN: 30,
    MIN_REASON_LEN: 5,
    MODAL_WIDTH: 560,
    BLOCK_SHORTS: true,
    HIDE_SHORTS_UI: true,
    SHORTS_REDIRECT_URL: "/feed/subscriptions",
    SHOW_WATCH_OVERLAY: true,
    ENABLE_SUMMARY_PANEL: true,
    // 再生ページのおすすめ欄（サイドバー）を隠す
    HIDE_RECOMMENDATIONS: true,
  };

  const CATEGORIES = [
    {
      value: "学習",
      label: "学習",
      helper: "学習目的の動画。視聴時間は制限対象外です。",
      placeholder: "例: 英語リスニングの練習、物理の復習 など",
    },
    {
      value: "作業",
      label: "作業",
      helper: "作業用のBGMや集中維持のための動画。",
      placeholder: "例: 作業BGMとして使う、集中を保つため など",
    },
    {
      value: "娯楽",
      label: "娯楽",
      helper: "純粋な娯楽目的。設定に応じて視聴時間を制限します。",
      placeholder: "例: 好きな実況を1本だけ観る など",
    },
    {
      value: "その他",
      label: "その他",
      helper: "上記以外。学習以外としてカウントされます。",
      placeholder: "例: 気になるニュースをチェック など",
    },
  ];

  /** ============== 便利関数・状態管理 ============== */
  const isShorts = () => location.pathname.startsWith("/shorts");
  const getVideoId = () => {
    if (isShorts()) {
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
    reasons: "yt_reason_store_v1",
    daily: "yt_reason_daily_v1",
    approved: "yt_reason_approved_v1",
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

  /** ============== 視聴カウント ============== */
  let tickTimer = null;
  let tickingCategory = null;

  function pauseAllVideos() {
    document.querySelectorAll("video").forEach((v) => {
      try {
        v.pause();
      } catch {
        /* noop */
      }
    });
  }

  function startTick(category) {
    stopTick();
    tickingCategory = category;
    tickTimer = setInterval(() => {
      const { entry } = ensureTodayStats();
      entry.totalSeconds += 1;

      const current = typeof tickingCategory === "string" ? tickingCategory : "その他";
      const isLearning = current === "学習";
      const isEntertainment = current === "娯楽";

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

  /** ============== ウォッチオーバーレイ ============== */
  let watchOverlayEl = null;
  let summaryBtnEl = null;
  let summaryPanelEl = null;
  let summaryEscHandler = null;

  function style(css) {
    const s = document.createElement("style");
    s.textContent = css;
    document.documentElement.appendChild(s);
  }

  style(`
  .yt-reason-backdrop {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.55);
    z-index: 2147483000;
    backdrop-filter: blur(2px);
  }
  .yt-reason-card {
    width: min(94vw, ${CONFIG.MODAL_WIDTH}px);
    background: rgba(18, 18, 20, 0.96);
    color: #f5f6fb;
    border-radius: 20px;
    border: 1px solid rgba(255,255,255,0.1);
    box-shadow: 0 18px 46px rgba(0,0,0,0.45);
    padding: 22px 22px 24px;
    font-family: system-ui, -apple-system, "Helvetica Neue", "Segoe UI", sans-serif;
  }
  .yt-reason-title {
    font-size: 20px;
    font-weight: 700;
    margin: 4px 0 16px;
    text-align: center;
  }
  .yt-cat-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 10px;
    margin-bottom: 16px;
  }
  .yt-cat-btn {
    padding: 13px 14px;
    border-radius: 14px;
    border: 1px solid rgba(255,255,255,0.18);
    background: rgba(40, 44, 56, 0.85);
    color: inherit;
    font-size: 16px;
    font-weight: 600;
    text-align: center;
    cursor: pointer;
    transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease;
  }
  .yt-cat-btn:active {
    transform: scale(0.98);
  }
  .yt-cat-btn.active {
    background: rgba(58, 110, 232, 0.9);
    border-color: rgba(110, 160, 255, 0.8);
    color: #f7f9ff;
    box-shadow: 0 6px 18px rgba(70, 120, 255, 0.28);
  }
  .yt-reason-helper {
    font-size: 13px;
    opacity: 0.82;
    margin-bottom: 14px;
    line-height: 1.5;
  }
  .yt-reason-input {
    width: 100%;
    border-radius: 16px;
    border: 1px solid rgba(255,255,255,0.14);
    background: rgba(28, 28, 36, 0.95);
    color: inherit;
    padding: 16px 18px;
    font-size: 16px;
    min-height: 130px;
    resize: vertical;
  }
  .yt-reason-input:focus {
    outline: none;
    border-color: rgba(110, 160, 255, 0.85);
    box-shadow: 0 0 0 3px rgba(90, 140, 255, 0.28);
  }
  .yt-reason-actions {
    margin-top: 20px;
    display: flex;
    gap: 12px;
    justify-content: center;
  }
  .yt-btn {
    min-width: 140px;
    padding: 12px 18px;
    border-radius: 16px;
    border: none;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    transition: transform 0.18s ease, opacity 0.18s ease;
  }
  .yt-btn.primary {
    background: linear-gradient(130deg, #5f82ff, #3460f0);
    color: #f5f7ff;
  }
  .yt-btn.primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .yt-btn.primary:not(:disabled):active {
    transform: scale(0.97);
  }
  .yt-limit-msg {
    text-align: center;
    font-size: 16px;
    line-height: 1.6;
  }
  .yt-watch-overlay {
    position: fixed;
    right: 18px;
    bottom: 24px;
    z-index: 2147482800;
    background: rgba(12, 14, 20, 0.88);
    color: #f5f6fb;
    border-radius: 18px;
    border: 1px solid rgba(255,255,255,0.08);
    box-shadow: 0 16px 30px rgba(0,0,0,0.4);
    padding: 16px 18px;
    min-width: 200px;
    font-family: system-ui, -apple-system, "Helvetica Neue", "Segoe UI", sans-serif;
  }
  .yt-watch-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
  }
  .yt-watch-overlay .yt-watch-label {
    font-size: 12px;
    letter-spacing: 0.08em;
    opacity: 0.68;
    text-transform: uppercase;
  }
  .yt-watch-total {
    font-size: 22px;
    font-weight: 700;
    line-height: 1.2;
  }
  .yt-watch-row {
    display: flex;
    justify-content: space-between;
    margin-top: 6px;
    font-size: 13px;
    opacity: 0.86;
  }
  .yt-watch-row .label {
    opacity: 0.74;
  }
  .yt-watch-row .time {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }
  .yt-summary-btn {
    border: 1px solid rgba(110,160,255,0.45);
    background: rgba(74, 110, 240, 0.15);
    color: #dbe7ff;
    border-radius: 12px;
    padding: 6px 10px;
    font-size: 12px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    cursor: pointer;
  }
  .yt-summary-btn:active {
    transform: scale(0.97);
  }
  .yt-summary-panel {
    position: fixed;
    inset: auto 4% 4% 4%;
    min-height: 40%;
    max-height: 70%;
    background: rgba(14, 16, 24, 0.96);
    color: #f1f4ff;
    border-radius: 22px;
    border: 1px solid rgba(255,255,255,0.12);
    box-shadow: 0 30px 60px rgba(0,0,0,0.45);
    padding: 20px 22px 24px;
    overflow: auto;
    z-index: 2147482900;
    font-family: system-ui, -apple-system, "Helvetica Neue", "Segoe UI", sans-serif;
  }
  .yt-summary-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 14px;
  }
  .yt-summary-title {
    font-size: 19px;
    font-weight: 700;
  }
  .yt-summary-close {
    border: none;
    background: none;
    color: inherit;
    font-size: 22px;
    cursor: pointer;
  }
  .yt-summary-body table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  .yt-summary-body th,
  .yt-summary-body td {
    text-align: left;
    padding: 6px 8px;
    border-bottom: 1px solid rgba(255,255,255,0.08);
  }
  .yt-summary-empty {
    opacity: 0.7;
    text-align: center;
    padding: 12px 0;
  }
  @media (max-width: 900px) {
    .yt-watch-overlay {
      right: 12px;
      left: 12px;
      bottom: 16px;
      min-width: unset;
    }
    .yt-watch-header {
      flex-direction: column;
      align-items: flex-start;
      gap: 6px;
    }
    .yt-watch-total {
      font-size: 20px;
    }
  }
  `);

  function ensureWatchOverlay() {
    if (!CONFIG.SHOW_WATCH_OVERLAY) return null;
    document.querySelectorAll(".yt-summary-btn").forEach((btn) => {
      if (!btn.closest(".yt-watch-overlay")) btn.remove();
    });
    if (!watchOverlayEl) {
      watchOverlayEl = document.createElement("div");
      watchOverlayEl.className = "yt-watch-overlay";
      watchOverlayEl.innerHTML = `
        <div class="yt-watch-header">
          <div class="yt-watch-label">Today</div>
          ${CONFIG.ENABLE_SUMMARY_PANEL ? '<button type="button" class="yt-summary-btn">Summary</button>' : ""}
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

  const pad = (n) => String(n).padStart(2, "0");

  function formatDuration(sec) {
    const total = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
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
      const seconds = stats?.learningSeconds ?? 0;
      if (seconds > 0) {
        learnRow.style.display = "flex";
        learnTimeEl.textContent = formatDuration(seconds);
      } else {
        learnRow.style.display = "none";
      }
    }

    const entertainmentSeconds = stats?.entertainmentSeconds ?? 0;
    if (entertainRow && entertainTimeEl) {
      if (entertainmentSeconds > 0 || CONFIG.ENABLE_ENTERTAINMENT_LIMIT) {
        entertainRow.style.display = "flex";
        entertainTimeEl.textContent = formatDuration(entertainmentSeconds);
      } else {
        entertainRow.style.display = "none";
      }
    }

    const totalNonLearning = stats?.nonLearningSeconds ?? 0;
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

  /** ============== 集計パネル ============== */
  function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>'"]/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    })[c] || c);
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

  function formatDateLabel(dateKey) {
    try {
      const date = new Date(`${dateKey}T00:00:00`);
      if (!Number.isNaN(date.getTime())) {
        const day = "日月火水木金土"[date.getDay()];
        return `${date.getMonth() + 1}/${date.getDate()} (${day})`;
      }
    } catch {
      /* ignore */
    }
    return dateKey;
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
                <th scope="row">${escapeHtml(formatDateLabel(d.date))}</th>
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
      : `<tr><td colspan="4" class="yt-summary-empty">まだ記録がありません。</td></tr>`;

    return `
      <div class="yt-summary-section">
        <h3 style="margin:0 0 10px;font-size:13px;text-transform:uppercase;letter-spacing:0.08em;opacity:0.7;">日別</h3>
        <table>
          <thead>
            <tr>
              <th scope="col">日付</th>
              <th scope="col">合計</th>
              <th scope="col">学習</th>
              <th scope="col">娯楽</th>
              <th scope="col">その他</th>
            </tr>
          </thead>
          <tbody>${dailyHtml}</tbody>
        </table>
      </div>
      <div class="yt-summary-section">
        <h3 style="margin:16px 0 10px;font-size:13px;text-transform:uppercase;letter-spacing:0.08em;opacity:0.7;">直近の理由</h3>
        <table>
          <thead>
            <tr>
              <th scope="col">記録日時</th>
              <th scope="col">カテゴリ</th>
              <th scope="col">理由</th>
              <th scope="col">リンク</th>
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
      if (e.key === "Escape") hideSummaryPanel();
    };
    document.addEventListener("keydown", summaryEscHandler, true);
    refreshSummaryPanel();
  }

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
    if (summaryPanelEl) hideSummaryPanel();
    else showSummaryPanel();
  }

  /** ============== モーダル ============== */
  let modalEl = null;

  function showReasonModal() {
    if (modalEl) removeModal();

    const vid = getVideoId();
    const key = currentVideoKey();
    const reasons = load(STORAGE_KEYS.reasons, {});
    const prev = reasons[key] || (vid ? reasons[vid] : null);

    const $back = document.createElement("div");
    $back.className = "yt-reason-backdrop";
    $back.innerHTML = `
      <div class="yt-reason-card" role="dialog" aria-modal="true">
        <div class="yt-reason-title">再生前に目的を決めましょう</div>
        <div class="yt-cat-grid" id="yt_reason_categories">
          ${CATEGORIES.map((cat) => `<button type="button" class="yt-cat-btn" data-value="${cat.value}">${cat.label}</button>`).join("")}
        </div>
        <div class="yt-reason-helper" id="yt_reason_helper"></div>
        <textarea class="yt-reason-input" id="yt_reason_text" placeholder="" rows="5"></textarea>
        <div class="yt-reason-actions">
          <button class="yt-btn primary" id="yt_reason_ok" disabled>開始する</button>
        </div>
      </div>
    `;

    document.documentElement.appendChild($back);
    modalEl = $back;

    const $text = $back.querySelector("#yt_reason_text");
    const $helper = $back.querySelector("#yt_reason_helper");
    const $ok = $back.querySelector("#yt_reason_ok");
    const buttons = Array.from($back.querySelectorAll(".yt-cat-btn"));

    let selectedCategory = prev?.category || CATEGORIES[0].value;

    function applySelection() {
      buttons.forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.value === selectedCategory);
      });
      const meta = CATEGORIES.find((cat) => cat.value === selectedCategory) || CATEGORIES[0];
      $helper.textContent = meta.helper;
      const placeholder = meta.placeholder || "";
      if (!$text.value.trim()) {
        $text.placeholder = placeholder;
      }
    }

    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedCategory = btn.dataset.value || CATEGORIES[0].value;
        applySelection();
        validate();
      });
    });

    const validate = () => {
      const ok = $text.value.trim().length >= CONFIG.MIN_REASON_LEN;
      $ok.disabled = !ok;
    };

    const submitReason = () => {
      if ($ok.disabled) return;
      const reason = $text.value.trim();
      const category = selectedCategory;
      const url = location.href;
      const payload = {
        reason,
        category,
        time: Date.now(),
        url,
      };
      const store = load(STORAGE_KEYS.reasons, {});
      store[key] = payload;
      if (vid) store[vid] = payload;
      save(STORAGE_KEYS.reasons, store);

      const approved = load(STORAGE_KEYS.approved, {});
      approved[key] = true;
      if (vid) approved[vid] = true;
      save(STORAGE_KEYS.approved, approved);

      refreshSummaryPanel();
      removeModal();

      const video = document.querySelector("video");
      if (video) video.play().catch(() => {});
      startTick(category);
    };

    $ok.addEventListener("click", submitReason);
    $text.addEventListener("input", validate);
    $text.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        submitReason();
      }
    });

    if (prev?.reason) {
      $text.value = prev.reason;
    }

    applySelection();
    validate();

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
      ? "娯楽カテゴリの視聴時間が上限に達しました。別の目的に切り替えましょう。"
      : "学習以外の視聴時間が上限に達しました。今日はここまでにしましょう。";
    const $back = document.createElement("div");
    $back.className = "yt-reason-backdrop";
    $back.innerHTML = `
      <div class="yt-reason-card">
        <div class="yt-reason-title">今日はここまで</div>
        <div class="yt-limit-msg">${bodyMessage}</div>
        <div class="yt-reason-actions" style="margin-top:18px;">
          <button class="yt-btn primary" id="yt_limit_ok">OK</button>
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
          集中を守るため、ショート動画の視聴を禁止しています。
        </div>
        <div class="yt-reason-actions" style="margin-top:18px;">
          <button class="yt-btn primary" id="yt_shorts_ok">OK</button>
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
    pauseAllVideos();
    const to = CONFIG.SHORTS_REDIRECT_URL;
    if (to) {
      location.replace(to);
    } else {
      showShortsBlockedModal();
    }
  }

  function hideShortsUI() {
    if (!(CONFIG.BLOCK_SHORTS && CONFIG.HIDE_SHORTS_UI)) return;
    const remover = (selector) => {
      document.querySelectorAll(selector).forEach((el) => {
        el.remove();
      });
    };
    remover(
      [
        "ytd-reel-shelf-renderer",
        "ytd-reel-item-renderer",
        "ytd-reel-video-renderer",
        "ytd-rich-shelf-renderer[is-shorts]",
        "ytm-reel-shelf-renderer",
        "ytm-reel-item-renderer",
        "ytm-reel-video-renderer",
        "ytm-shorts-shelf-renderer",
      ].join(",")
    );
    const linkSel = 'a[href^="/shorts"], a[href*="://www.youtube.com/shorts"]';
    document.querySelectorAll(linkSel).forEach((a) => {
      const removable = a.closest(
        [
          "ytd-guide-entry-renderer",
          "ytd-mini-guide-entry-renderer",
          "ytd-rich-item-renderer",
          "ytd-rich-section-renderer",
          "ytd-shelf-renderer",
          "ytd-video-renderer",
          "ytd-compact-video-renderer",
          "ytd-grid-video-renderer",
          "ytd-rich-grid-row",
          "ytm-item",
          "ytm-guide-entry",
          "ytm-rich-item-renderer",
          "ytm-item-section-renderer",
          "ytm-section-list-renderer",
          "ytm-rich-grid-row",
        ].join(",")
      );
      if (removable) removable.remove();
      else a.remove();
    });
    document.querySelectorAll("yt-chip-cloud-chip-renderer, tp-yt-paper-chip, ytm-chip-with-avatar-renderer, ytm-chip-cloud-chip-renderer").forEach((chip) => {
      const text = (chip.textContent || "").trim();
      if (/shorts|ショート/i.test(text)) chip.remove();
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

  /** ============== イベントハンドラ ============== */
  function onVideoPlay(e) {
    const el = e.target;
    if (!(el instanceof HTMLVideoElement)) return;

    if (CONFIG.BLOCK_SHORTS && isShorts()) {
      try {
        el.pause();
      } catch {
        /* noop */
      }
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

    const reasons = load(STORAGE_KEYS.reasons, {});
    const info = reasons[key] || (vid ? reasons[vid] : null);
    startTick(info?.category || "その他");
  }

  function onVideoPause() {
    stopTick();
  }

  /** ============== SPA 対応 ============== */
  document.addEventListener("play", onVideoPlay, true);
  document.addEventListener("pause", onVideoPause, true);

  let lastHref = location.href;
  const navObs = new MutationObserver(() => {
    if (lastHref !== location.href) {
      lastHref = location.href;
      stopTick();
      if (CONFIG.BLOCK_SHORTS && isShorts()) {
        handleShortsVisit();
        return;
      }
      hideShortsUI();
      hideRecommendationsUI();
      updateWatchOverlay();
      const vid = getVideoId();
      const key = currentVideoKey();
      const approved = load(STORAGE_KEYS.approved, {});
      if (!(vid && approved[vid]) && !approved[key]) {
        pauseAllVideos();
      }
    }
  });
  navObs.observe(document.documentElement, { childList: true, subtree: true });

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
      setTimeout(showReasonModal, 250);
    }
  }

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
      document.addEventListener(
        "click",
        (e) => {
          const target = e.target;
          if (!target || typeof target.closest !== "function") return;
          const shortLink = target.closest('a[href^="/shorts"], a[href*="://www.youtube.com/shorts"]');
          if (shortLink) {
            e.preventDefault();
            e.stopPropagation();
            handleShortsVisit();
          }
        },
        true
      );
    }
  }

  window.addEventListener("beforeunload", stopTick);
})();

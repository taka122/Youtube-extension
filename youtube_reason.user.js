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

      if (category !== "学習") {
        entry.nonLearningSeconds += 1;

        if (CONFIG.ENABLE_NON_LEARNING_LIMIT) {
          const limitSec = CONFIG.NON_LEARNING_LIMIT_MIN * 60;
          if (entry.nonLearningSeconds >= limitSec) {
            pauseAllVideos();
            showLimitModal();
          }
        }
      }

      if (category === "学習") entry.learningSeconds += 1;
      if (category === "娯楽") entry.entertainmentSeconds += 1;

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

    $ok.addEventListener("click", () => {
      const reason = $text.value.trim();
      const category = $cat.value;

      // 保存
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

      // 再生
      const v = document.querySelector("video");
      if (v) {
        v.play().catch(() => {});
      }

      // カウント開始
      startTick(category);
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
  updateWatchOverlay();

  if (CONFIG.BLOCK_SHORTS && CONFIG.HIDE_SHORTS_UI) {
    const cleaner = new MutationObserver(() => {
      hideShortsUI();
    });
    cleaner.observe(document.documentElement, { childList: true, subtree: true });
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

  // 4) ページ離脱時にカウント終了
  window.addEventListener("beforeunload", stopTick);

})();

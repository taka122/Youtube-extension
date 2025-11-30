// ==UserScript==
// @name         YouTube: Hide search results
// @namespace    https://example.taka/yt-block-search
// @version      0.3.0
// @description  YouTube 検索結果ページの動画カードをすべて非表示にし、視聴時間選択→カウントダウン→ブロックを制御します。
// @author       you
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const ATTR = "data-yt-hide-search-results";
  const OVERLAY_ID = "yt-search-hide-overlay";
  const STYLE_ID = "yt-search-hide-style";
  const CHECK_INTERVAL_MS = 400;
  const COUNTDOWN_BADGE_ID = "yt-countdown-badge";
  const MODAL_ID = "yt-search-time-modal";
  const MODAL_OPEN_CLASS = "yt-search-time-open";
  const STORAGE_KEY = "yt_state";
  const DURATIONS_MIN = [1, 3, 5, 10, 15, 30];

  const isSearchPage = () => location.pathname === "/results";
  const hasSearchQueryParam = () => {
    try {
      const url = new URL(location.href);
      return url.searchParams.has("search_query");
    } catch {
      return false;
    }
  };

  function getSearchQuery() {
    try {
      const url = new URL(location.href);
      return (
        url.searchParams.get("search_query") ||
        url.searchParams.get("query") ||
        url.searchParams.get("q") ||
        ""
      );
    } catch {
      return "";
    }
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
:root[${ATTR}] ytd-two-column-search-results-renderer #contents,
:root[${ATTR}] ytd-section-list-renderer,
:root[${ATTR}] ytd-item-section-renderer,
:root[${ATTR}] ytd-search #contents,
:root[${ATTR}] ytd-video-renderer,
:root[${ATTR}] ytd-grid-video-renderer,
:root[${ATTR}] ytd-reel-shelf-renderer,
:root[${ATTR}] ytd-channel-renderer,
:root[${ATTR}] ytd-playlist-renderer,
:root[${ATTR}] ytd-horizontal-card-list-renderer,
:root[${ATTR}] ytd-reel-item-renderer,
:root[${ATTR}] ytd-shelf-renderer,
:root[${ATTR}] ytm-search #contents,
:root[${ATTR}] ytm-item-section-renderer,
:root[${ATTR}] ytm-video-with-context-renderer,
:root[${ATTR}] ytm-compact-video-renderer,
:root[${ATTR}] ytm-horizontal-card-list-renderer,
:root[${ATTR}] ytm-reel-shelf-renderer {
  display: none !important;
}

#${OVERLAY_ID} {
  position: fixed;
  inset: 0;
  display: none;
  align-items: center;
  justify-content: center;
  padding: 32px;
  box-sizing: border-box;
  background: rgba(0, 0, 0, 0.1);
  z-index: 99999;
  pointer-events: none;
  font-family: Arial, sans-serif;
}
:root[${ATTR}] #${OVERLAY_ID} {
  display: flex;
}
#${OVERLAY_ID} .yt-block-card {
  max-width: 460px;
  width: min(460px, 92vw);
  background: #fff;
  color: #0f0f0f;
  border-radius: 12px;
  padding: 20px 24px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
  pointer-events: auto;
}
@media (prefers-color-scheme: dark) {
  #${OVERLAY_ID} {
    background: rgba(0, 0, 0, 0.2);
  }
  #${OVERLAY_ID} .yt-block-card {
    background: #1f1f1f;
    color: #f1f1f1;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
  }
}
#${OVERLAY_ID} .yt-block-title {
  font-size: 18px;
  font-weight: 700;
  margin: 0 0 6px;
}
#${OVERLAY_ID} .yt-block-desc {
  margin: 0;
  line-height: 1.4;
  font-size: 14px;
  color: inherit;
}

#${COUNTDOWN_BADGE_ID} {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 100000;
  display: none;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.75);
  color: #fff;
  font-size: 14px;
  border-radius: 999px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  font-family: Arial, sans-serif;
}
#${COUNTDOWN_BADGE_ID}[data-visible="1"] {
  display: inline-flex;
}
#${COUNTDOWN_BADGE_ID}[data-mode="block"] {
  background: rgba(255, 80, 80, 0.9);
}

#${MODAL_ID} {
  position: fixed;
  inset: 0;
  display: none;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.35);
  z-index: 100001;
  padding: 16px;
  box-sizing: border-box;
}
.${MODAL_OPEN_CLASS} #${MODAL_ID} {
  display: flex;
}
#${MODAL_ID} .yt-modal-card {
  width: min(480px, 94vw);
  background: #fff;
  color: #0f0f0f;
  border-radius: 12px;
  padding: 20px 24px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.22);
  font-family: Arial, sans-serif;
}
@media (prefers-color-scheme: dark) {
  #${MODAL_ID} .yt-modal-card {
    background: #1f1f1f;
    color: #f1f1f1;
  }
}
#${MODAL_ID} .yt-modal-title {
  margin: 0 0 12px;
  font-size: 18px;
  font-weight: 700;
}
#${MODAL_ID} .yt-modal-buttons {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(90px, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}
#${MODAL_ID} button {
  padding: 10px 12px;
  font-size: 14px;
  border-radius: 10px;
  border: none;
  cursor: pointer;
  transition: transform 0.08s ease, box-shadow 0.12s ease, background 0.12s ease;
}
#${MODAL_ID} button:hover {
  transform: translateY(-1px);
}
#${MODAL_ID} .yt-btn-duration {
  background: #065fd4;
  color: #fff;
  box-shadow: 0 6px 16px rgba(6, 95, 212, 0.35);
}
#${MODAL_ID} .yt-btn-cancel {
  background: #e5e5e5;
  color: #111;
}
@media (prefers-color-scheme: dark) {
  #${MODAL_ID} .yt-btn-cancel {
    background: #333;
    color: #f1f1f1;
  }
}
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureOverlay(rawQuery) {
    const queryText = (rawQuery || "").trim();
    if (!document.body) return;
    let overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = OVERLAY_ID;
      overlay.innerHTML = `
        <div class="yt-block-card">
          <p class="yt-block-title">検索結果を非表示にしました</p>
          <p class="yt-block-desc"></p>
        </div>
      `;
      document.body.appendChild(overlay);
    }
    const desc = overlay.querySelector(".yt-block-desc");
    if (desc) {
      desc.textContent = queryText
        ? `"${queryText}" の検索結果カードを非表示にしています。`
        : "検索結果カードを非表示にしています。";
    }
  }

  function setHidden(query) {
    document.documentElement.setAttribute(ATTR, "1");
    ensureOverlay(query);
  }

  function clearHidden() {
    document.documentElement.removeAttribute(ATTR);
    const overlay = document.getElementById(OVERLAY_ID);
    if (overlay) overlay.style.removeProperty("display");
  }

  const nowSec = () => Math.floor(Date.now() / 1000);

  let state = loadState();
  let countdownTimer = null;
  let blockTimer = null;
  let lastUrl = location.href;
  let modalEl = null;
  let badgeEl = null;

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return {
        mode: parsed.mode || "idle",
        remainingSeconds: Number(parsed.remainingSeconds) || 0,
        blockUntil: Number(parsed.blockUntil) || 0,
        lastUpdated: Number(parsed.lastUpdated) || nowSec(),
        countdownTotalSeconds: Number(parsed.countdownTotalSeconds) || 0,
      };
    } catch {
      return { mode: "idle", remainingSeconds: 0, blockUntil: 0, lastUpdated: nowSec(), countdownTotalSeconds: 0 };
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function ensureBadge() {
    if (badgeEl) return badgeEl;
    badgeEl = document.createElement("div");
    badgeEl.id = COUNTDOWN_BADGE_ID;
    badgeEl.dataset.visible = "0";
    document.documentElement.appendChild(badgeEl);
    return badgeEl;
  }

  function hideBadge() {
    if (badgeEl) {
      badgeEl.dataset.visible = "0";
      badgeEl.textContent = "";
    }
  }

  function formatTime(sec) {
    const s = Math.max(0, Math.floor(sec));
    const m = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return `${m}:${ss}`;
  }

  function updateBadge(mode, sec) {
    const badge = ensureBadge();
    badge.dataset.visible = sec > 0 ? "1" : "0";
    badge.dataset.mode = mode;
    const label = mode === "block" ? "ブロック中" : "残り";
    badge.textContent = `${label} ${formatTime(sec)}`;
  }

  function clearTimers() {
    if (countdownTimer) clearInterval(countdownTimer);
    if (blockTimer) clearInterval(blockTimer);
    countdownTimer = null;
    blockTimer = null;
  }

  function setIdle(skipEvaluate = false) {
    clearTimers();
    hideBadge();
    state = { mode: "idle", remainingSeconds: 0, blockUntil: 0, countdownTotalSeconds: 0, lastUpdated: nowSec() };
    saveState();
    if (!skipEvaluate) evaluate();
  }

  function startBlock(seconds) {
    clearTimers();
    const duration = Math.max(0, Math.ceil(seconds));
    const now = nowSec();
    if (duration <= 0) {
      setIdle();
      return;
    }
    state = {
      mode: "block",
      remainingSeconds: 0,
      blockUntil: now + duration,
      countdownTotalSeconds: 0,
      lastUpdated: now,
    };
    saveState();
    evaluate();
    blockTimer = setInterval(() => {
      const remaining = (state.blockUntil || 0) - nowSec();
      if (remaining <= 0) {
        setIdle();
      } else {
        updateBadge("block", remaining);
      }
    }, 1000);
  }

  function startCountdown(totalSeconds, remainingSecondsOverride = null) {
    clearTimers();
    const total = Math.max(0, Math.ceil(totalSeconds));
    const remaining = remainingSecondsOverride == null ? total : Math.max(0, Math.ceil(remainingSecondsOverride));
    if (total <= 0) {
      setIdle();
      return;
    }
    const now = nowSec();
    state = {
      mode: "countdown",
      remainingSeconds: remaining,
      countdownTotalSeconds: total,
      blockUntil: 0,
      lastUpdated: now,
    };
    saveState();
    applyVisibleUI();
    updateBadge("countdown", total);
    countdownTimer = setInterval(() => {
      const current = nowSec();
      const elapsed = Math.max(0, current - (state.lastUpdated || current));
      state.remainingSeconds = Math.max(0, (state.remainingSeconds || 0) - elapsed);
      state.lastUpdated = current;
      saveState();
      if (state.remainingSeconds <= 0) {
        startBlock((state.countdownTotalSeconds || 0) * 2);
      } else {
        updateBadge("countdown", state.remainingSeconds);
      }
    }, 1000);
  }

  function refreshStateFromClock() {
    const now = nowSec();
    if (state.mode === "countdown") {
      const elapsed = Math.max(0, now - (state.lastUpdated || now));
      state.remainingSeconds = Math.max(0, (state.remainingSeconds || 0) - elapsed);
      state.lastUpdated = now;
      saveState();
      if (state.remainingSeconds <= 0) {
        startBlock((state.countdownTotalSeconds || 0) * 2);
        return;
      }
    }
    if (state.mode === "block") {
      if (!state.blockUntil || now >= state.blockUntil) {
        setIdle(true);
      }
    }
  }

  function applyBlockUI() {
    const query = getSearchQuery();
    if (!isSearchPage() || !hasSearchQueryParam()) {
      clearHidden();
      return;
    }
    setHidden(query);
  }

  function applyVisibleUI() {
    clearHidden();
  }

  function applyStateToUI() {
    refreshStateFromClock();
    if (!isSearchPage() || !hasSearchQueryParam()) {
      applyVisibleUI();
      hideBadge();
      return;
    }

    if (state.mode === "block") {
      const remaining = (state.blockUntil || 0) - nowSec();
      if (remaining <= 0) {
        setIdle(true);
        applyBlockUI();
        return;
      }
      applyBlockUI();
      updateBadge("block", remaining);
    } else if (state.mode === "countdown") {
      applyVisibleUI();
      updateBadge("countdown", state.remainingSeconds || 0);
    } else {
      applyBlockUI();
      hideBadge();
    }
  }

  function evaluate() {
    applyStateToUI();
  }

  function resumeTimersIfNeeded() {
    if (state.mode === "countdown" && !countdownTimer) {
      startCountdown(state.countdownTotalSeconds || state.remainingSeconds, state.remainingSeconds || state.countdownTotalSeconds);
      return;
    }
    if (state.mode === "block" && !blockTimer) {
      const remaining = (state.blockUntil || 0) - nowSec();
      if (remaining > 0) {
        startBlock(remaining);
      } else {
        setIdle(true);
      }
    }
  }

  function onUrlChange() {
    refreshStateFromClock();
    if (state.mode === "countdown") {
      const remaining = Math.max(0, state.remainingSeconds || 0);
      startBlock(remaining * 2);
    }
    lastUrl = location.href;
    evaluate();
  }

  function watchNavigation() {
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    history.pushState = function (...args) {
      const ret = origPush.apply(this, args);
      onUrlChange();
      return ret;
    };
    history.replaceState = function (...args) {
      const ret = origReplace.apply(this, args);
      onUrlChange();
      return ret;
    };
    window.addEventListener("popstate", onUrlChange);
    window.addEventListener("yt-navigate-finish", onUrlChange);
    setInterval(() => {
      if (location.href !== lastUrl) {
        onUrlChange();
      }
    }, CHECK_INTERVAL_MS);
  }

  function ensureModal() {
    if (modalEl) return modalEl;
    modalEl = document.createElement("div");
    modalEl.id = MODAL_ID;
    modalEl.innerHTML = `
      <div class="yt-modal-card">
        <p class="yt-modal-title">視聴時間を選択</p>
        <div class="yt-modal-buttons yt-modal-durations"></div>
        <button class="yt-btn-cancel" type="button">キャンセル</button>
      </div>
    `;
    document.documentElement.appendChild(modalEl);
    const btnWrap = modalEl.querySelector(".yt-modal-durations");
    if (btnWrap) {
      DURATIONS_MIN.forEach((min) => {
        const btn = document.createElement("button");
        btn.className = "yt-btn-duration";
        btn.type = "button";
        btn.textContent = `${min} 分`;
        btn.addEventListener("click", () => {
          hideModal();
          startCountdown(min * 60);
        });
        btnWrap.appendChild(btn);
      });
    }
    const cancelBtn = modalEl.querySelector(".yt-btn-cancel");
    if (cancelBtn instanceof HTMLElement) {
      cancelBtn.addEventListener("click", hideModal);
    }
    return modalEl;
  }

  function showModal() {
    ensureModal();
    document.documentElement.classList.add(MODAL_OPEN_CLASS);
  }

  function hideModal() {
    document.documentElement.classList.remove(MODAL_OPEN_CLASS);
  }

  function isSearchInput(el) {
    if (!(el instanceof HTMLElement)) return false;
    const selectors = [
      "input#search",
      "input#search-input",
      "input[name='search_query']",
      "form#search-form input",
      "ytd-searchbox input",
      "ytm-search input",
      "ytm-search-box input",
      "#masthead-search input",
    ];
    return selectors.some((sel) => el.matches(sel));
  }

  function handleSearchClick(e) {
    const target = e.target;
    if (!isSearchInput(target)) return;
    if (!isSearchPage()) return;
    if (state.mode !== "idle") return;
    showModal();
  }

  function attachSearchListener() {
    document.addEventListener("focusin", handleSearchClick, true);
    document.addEventListener("click", handleSearchClick, true);
  }

  function init() {
    ensureStyles();
    refreshStateFromClock();
    resumeTimersIfNeeded();
    applyStateToUI();
    attachSearchListener();
    watchNavigation();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

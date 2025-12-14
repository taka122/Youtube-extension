// ==UserScript==
// @name         YouTube Watch Time Modal
// @namespace    https://example.taka/yt-watch-modal
// @version      0.1.0
// @description  再生中の動画について「実際に視聴した時間」をリアルタイム表示する小さなモーダルを追加します。
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const MODAL_ID = "yt-watch-modal";
  const TIMER_ID = "yt-watch-timer";
  const TITLE_ID = "yt-watch-title";
  const TOTAL_ID = "yt-watch-total";
  const BAN_ID = "yt-watch-ban";
  const INFO_ID = "yt-watch-info";
  const STYLE_ID = "yt-watch-style";
  const TOTAL_STORAGE_KEY = "yt-watch-total-v1";
  const BLOCK_STORAGE_KEY = "yt-watch-block-v1";
  const MIN_SESSION_MS = 3000; // 短すぎる視聴は誤検知として無視
  const TICK_MS = 500;

  let currentVideoId = null;
  let watchMs = 0;
  let totalMs = 0;
  let totalDate = null;
  let blockUntilMs = 0;
  let lastSessionVideoId = null;
  let lastSessionSeconds = 0;
  let lastAddedSeconds = 0;
  let lastTick = Date.now();

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
#${MODAL_ID} {
  position: fixed;
  top: 14px;
  right: 14px;
  display: none;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  background: rgba(0, 0, 0, 0.82);
  color: #fff;
  border-radius: 12px;
  box-shadow: 0 10px 32px rgba(0, 0, 0, 0.35);
  z-index: 999999;
  font-family: "Helvetica Neue", Arial, sans-serif;
  pointer-events: none;
}
#${MODAL_ID}[data-visible="1"] {
  display: flex;
}
#${MODAL_ID} #${TITLE_ID} {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.01em;
  opacity: 0.9;
}
#${MODAL_ID} #${TIMER_ID} {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 0.02em;
}
#${MODAL_ID} #${TOTAL_ID} {
  margin: 0;
  font-size: 13px;
  letter-spacing: 0.01em;
  opacity: 0.8;
}
#${MODAL_ID} #${BAN_ID} {
  margin: 0;
  font-size: 13px;
  letter-spacing: 0.01em;
  opacity: 0.9;
}
#${MODAL_ID} #${INFO_ID} {
  margin: 0;
  font-size: 12px;
  letter-spacing: 0.01em;
  opacity: 0.72;
}
#${MODAL_ID}[data-state="paused"] #${TIMER_ID} {
  opacity: 0.72;
}
@media (max-width: 640px) {
  #${MODAL_ID} {
    top: auto;
    bottom: 12px;
    right: 12px;
    left: 12px;
    align-items: center;
  }
}
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureModal() {
    let modal = document.getElementById(MODAL_ID);
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = MODAL_ID;

    const title = document.createElement("p");
    title.id = TITLE_ID;
    title.textContent = "視聴時間";

    const timer = document.createElement("p");
    timer.id = TIMER_ID;
    timer.textContent = "00:00";

    const total = document.createElement("p");
    total.id = TOTAL_ID;
    total.textContent = "今日の累計 00:00";

    const ban = document.createElement("p");
    ban.id = BAN_ID;
    ban.textContent = "現在、視聴禁止はありません";

    const info = document.createElement("p");
    info.id = INFO_ID;
    info.textContent = "";

    modal.appendChild(title);
    modal.appendChild(timer);
    modal.appendChild(total);
    modal.appendChild(ban);
    modal.appendChild(info);

    const parent = document.body || document.documentElement;
    parent.appendChild(modal);
    return modal;
  }

  function formatMs(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const parts = [
      hours > 0 ? String(hours).padStart(2, "0") : null,
      String(minutes).padStart(2, "0"),
      String(seconds).padStart(2, "0"),
    ].filter(Boolean);
    return parts.join(":");
  }

  function todayKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function formatDateTime(ms) {
    const d = new Date(ms);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${y}/${m}/${day} ${hh}:${mm}`;
  }

  function loadTotalFromStorage() {
    try {
      const stored = JSON.parse(localStorage.getItem(TOTAL_STORAGE_KEY));
      if (
        stored &&
        typeof stored.ms === "number" &&
        typeof stored.date === "string"
      ) {
        totalMs = Math.max(0, stored.ms);
        totalDate = stored.date;
      }
    } catch {
      // ignore parse errors
    }
    if (totalDate !== todayKey()) {
      totalDate = todayKey();
      totalMs = 0;
    }
  }

  function persistTotal() {
    try {
      localStorage.setItem(
        TOTAL_STORAGE_KEY,
        JSON.stringify({
          ms: Math.max(0, Math.floor(totalMs)),
          date: totalDate,
        })
      );
    } catch {
      // ignore quota issues
    }
  }

  function ensureTotalDate() {
    const today = todayKey();
    if (totalDate !== today) {
      totalDate = today;
      totalMs = 0;
      persistTotal();
    }
  }

  function loadBlockFromStorage() {
    try {
      const stored = JSON.parse(localStorage.getItem(BLOCK_STORAGE_KEY));
      if (stored && typeof stored === "object") {
        blockUntilMs = Math.max(0, Number(stored.blockUntilMs) || 0);
        lastSessionVideoId =
          typeof stored.lastSessionVideoId === "string"
            ? stored.lastSessionVideoId
            : null;
        lastSessionSeconds = Math.max(
          0,
          Number(stored.lastSessionSeconds) || 0
        );
        lastAddedSeconds = Math.max(0, Number(stored.lastAddedSeconds) || 0);
      }
    } catch {
      // ignore parse errors
    }
  }

  function persistBlockState() {
    try {
      localStorage.setItem(
        BLOCK_STORAGE_KEY,
        JSON.stringify({
          blockUntilMs,
          lastSessionVideoId,
          lastSessionSeconds,
          lastAddedSeconds,
        })
      );
    } catch {
      // ignore quota issues
    }
  }

  function getRemainingMs() {
    return Math.max(0, blockUntilMs - Date.now());
  }

  function getVideoId() {
    try {
      const url = new URL(location.href);
      if (url.pathname.startsWith("/shorts/")) {
        const segments = url.pathname.split("/").filter(Boolean);
        return segments[1] || null;
      }
      return url.searchParams.get("v");
    } catch {
      return null;
    }
  }

  function findVideo() {
    return document.querySelector("video");
  }

  function isPlaying(video) {
    return (
      !!video &&
      !video.paused &&
      video.readyState >= 2 &&
      !video.seeking &&
      !document.hidden
    );
  }

  function finalizeWatchSession(trigger, videoIdOverride) {
    const sessionMs = watchMs;
    const sessionSeconds = Math.floor(sessionMs / 1000);
    if (sessionMs < MIN_SESSION_MS || sessionSeconds <= 0) {
      watchMs = 0;
      return;
    }

    const vid = videoIdOverride ?? currentVideoId;
    const addSeconds = sessionSeconds * 2;
    const base = Math.max(Date.now(), blockUntilMs);
    blockUntilMs = base + addSeconds * 1000;

    lastSessionVideoId = vid || null;
    lastSessionSeconds = sessionSeconds;
    lastAddedSeconds = addSeconds;

    persistBlockState();
    watchMs = 0;
    renderModal(true, false, vid);
  }

  function handleVisibilityChange() {
    if (document.hidden) {
      finalizeWatchSession("visibilitychange");
    }
  }

  function handleBeforeUnload() {
    finalizeWatchSession("beforeunload");
  }

  function handleNavigate() {
    finalizeWatchSession("yt-navigate");
  }

  function handleVideoPlay(e) {
    const el = e?.target;
    if (!el || el.tagName !== "VIDEO") return;
    if (getRemainingMs() > 0) {
      try {
        el.pause();
      } catch {}
      renderModal(true, false, getVideoId());
    }
  }

  function renderModal(visible, playing, videoId) {
    const modal = ensureModal();
    modal.setAttribute("data-visible", visible ? "1" : "0");
    modal.setAttribute("data-state", playing ? "playing" : "paused");
    const remainingMs = getRemainingMs();
    const blocked = remainingMs > 0;
    modal.setAttribute("data-block", blocked ? "1" : "0");

    const title = modal.querySelector(`#${TITLE_ID}`);
    if (title) {
      title.textContent = blocked
        ? "視聴禁止中"
        : videoId
        ? `視聴時間 (ID: ${videoId})`
        : "視聴時間";
    }

    const timer = modal.querySelector(`#${TIMER_ID}`);
    if (timer) {
      timer.textContent = formatMs(watchMs);
    }

    const total = modal.querySelector(`#${TOTAL_ID}`);
    if (total) {
      const label = totalDate === todayKey() ? "今日の累計" : "累計";
      total.textContent = `${label} ${formatMs(totalMs)}`;
    }

    const ban = modal.querySelector(`#${BAN_ID}`);
    if (ban) {
      if (blocked) {
        const planned = formatDateTime(blockUntilMs);
        ban.textContent = `禁止残り ${formatMs(remainingMs)}（解除予定: ${planned}）`;
      } else {
        ban.textContent = "現在、視聴禁止はありません";
      }
    }

    const info = modal.querySelector(`#${INFO_ID}`);
    if (info) {
      if (blocked) {
        const remainText = formatMs(remainingMs);
        if (lastSessionSeconds > 0) {
          info.textContent = `直前視聴: ${lastSessionSeconds}秒 / 追加: ${lastAddedSeconds}秒 / 残り: ${remainText}`;
        } else {
          info.textContent = `このタブでは再生できません（残り: ${remainText}）`;
        }
      } else if (lastSessionSeconds > 0) {
        info.textContent = `直前の視聴: ${lastSessionSeconds}秒 / 付与: ${lastAddedSeconds}秒`;
      } else {
        info.textContent = "";
      }
    }
  }

  function tick() {
    const now = Date.now();
    const delta = Math.max(0, now - lastTick);
    lastTick = now;

    const video = findVideo();
    const videoId = getVideoId();
    let playing = isPlaying(video);
    const remainingMs = getRemainingMs();

    const prevVideoId = currentVideoId;
    // 動画遷移・離脱を検知したら視聴秒数を確定
    if (prevVideoId && videoId !== prevVideoId) {
      finalizeWatchSession("video-change", prevVideoId);
    } else if (prevVideoId && !videoId) {
      finalizeWatchSession("leave-video", prevVideoId);
    }

    if (videoId && videoId !== prevVideoId) {
      watchMs = 0;
    } else if (!videoId && prevVideoId) {
      watchMs = 0;
    }
    currentVideoId = videoId || null;

    // 新しい動画に切り替わったらリセット
    ensureTotalDate();

    if (playing && remainingMs > 0 && video) {
      try {
        video.pause();
      } catch {}
      playing = false;
    }

    if (playing) {
      watchMs += delta;
      totalMs += delta;
      persistTotal();
    }

    const shouldShow = remainingMs > 0 || !!(video || videoId);
    renderModal(shouldShow, playing, videoId);
  }

  function init() {
    loadTotalFromStorage();
    loadBlockFromStorage();
    ensureStyles();
    ensureModal();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("play", handleVideoPlay, true);
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("yt-navigate-finish", handleNavigate);
    window.addEventListener("popstate", handleNavigate);
    tick();
    setInterval(tick, TICK_MS);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();

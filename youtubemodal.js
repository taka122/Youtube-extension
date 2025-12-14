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
  const STYLE_ID = "yt-watch-style";
  const TICK_MS = 500;

  let currentVideoId = null;
  let watchMs = 0;
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

    modal.appendChild(title);
    modal.appendChild(timer);

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

  function renderModal(visible, playing, videoId) {
    const modal = ensureModal();
    modal.setAttribute("data-visible", visible ? "1" : "0");
    modal.setAttribute("data-state", playing ? "playing" : "paused");

    const title = modal.querySelector(`#${TITLE_ID}`);
    if (title) {
      title.textContent = videoId ? `視聴時間 (ID: ${videoId})` : "視聴時間";
    }

    const timer = modal.querySelector(`#${TIMER_ID}`);
    if (timer) {
      timer.textContent = formatMs(watchMs);
    }
  }

  function tick() {
    const now = Date.now();
    const delta = Math.max(0, now - lastTick);
    lastTick = now;

    const video = findVideo();
    const videoId = getVideoId();

    // 新しい動画に切り替わったらリセット
    if (videoId && videoId !== currentVideoId) {
      currentVideoId = videoId;
      watchMs = 0;
    }

    if (isPlaying(video)) {
      watchMs += delta;
    }

    const shouldShow = !!(video || videoId);
    renderModal(shouldShow, isPlaying(video), videoId);
  }

  function init() {
    ensureStyles();
    ensureModal();
    tick();
    setInterval(tick, TICK_MS);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
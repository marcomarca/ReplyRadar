// ==UserScript==
// @name         ReplyRadar
// @namespace    https://github.com/marcomarca/ReplyRadar
// @version      1.4.5
// @description  Navegador flotante de conversaciones y notificador de respuestas para ChatGPT y Gemini.
// @author       marcomarca
// @homepageURL  https://github.com/marcomarca/ReplyRadar
// @supportURL   https://github.com/marcomarca/ReplyRadar/issues
// @downloadURL  https://raw.githubusercontent.com/marcomarca/ReplyRadar/main/ReplyRadar.user.js
// @updateURL    https://raw.githubusercontent.com/marcomarca/ReplyRadar/main/ReplyRadar.user.js
// @match        *://chatgpt.com/*
// @match        *://gemini.google.com/*
// @grant        GM_addStyle
// @grant        GM_notification
// @grant        unsafeWindow
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  try {
    if (window.top !== window.self) return;
  } catch (_) {
    return;
  }

  let __cg_nav_policy = null;
  if (window.trustedTypes && window.trustedTypes.createPolicy) {
    for (const name of ['MyPromptPolicy', 'dompurify', 'default', 'cwm-policy', '__cg_nav_policy']) {
      try {
        __cg_nav_policy = window.trustedTypes.createPolicy(name, {
          createHTML: (s) => s,
        });
        break;
      } catch (_) { }
    }
  }

  function setSafeInnerHTML(el, html) {
    if (!el) return;
    el.innerHTML = __cg_nav_policy ? __cg_nav_policy.createHTML(html) : html;
  }

  const PLATFORM = detectPlatform();
  if (!PLATFORM) return;

  const STORAGE_KEYS = {
    position: '__cg_nav_position_v1',
    theme: '__cg_nav_theme_v1',
    alarmEnabled: '__cg_nav_alarm_enabled_v1',
  };

  const ALARM_COOLDOWN_MS = 13500;
  const ALARM_CHIME_REPEAT_COUNT = 2;
  const ALARM_CHIME_REPEAT_INTERVAL_SEC = 2.75;
  const CHATGPT_LAT_COMPLETION_URL = 'https://chatgpt.com/backend-api/lat/r';
  const CHATGPT_NETWORK_HOOK_RETRY_MS = 2000;

  const GEMINI_NETWORK_TARGET_ENDPOINT = 'batchexecute';
  const GEMINI_NETWORK_BURST_THRESHOLD = 3;
  const GEMINI_NETWORK_PULSE_TIMEOUT_MS = 3500;
  const GEMINI_NETWORK_MONITOR_INTERVAL_MS = 1000;


  const THEME_ORDER = ['auto', 'dark', 'light'];
  const COLOR_SCHEME_QUERY = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  const STATE = {
    filterMode: 'all', // all | user | ai
    items: [],
    currentIndex: -1,
    observer: null,
    panel: null,
    listModal: null,
    initialized: false,
    navLockUntil: 0,
    navLockIndex: -1,
    lastFocusedElement: null,
    lastFocusedText: '',
    lastFocusedType: '',
    themeMode: 'auto',
    resolvedTheme: 'dark',
    panelPosition: null,
    alarmEnabled: false,
    alarmAudioCtx: null,
    alarmKeepAliveAudio: null,
    lastAlarmAt: 0,
    chatgptNetworkInitialized: false,
    chatgptNetworkMonitor: null,
    chatgptNetworkHookRetryAt: 0,
    geminiNetworkInitialized: false,
    geminiNetworkMonitor: null,
    geminiNetworkIsGenerating: false,
    geminiNetworkLastPulseAt: 0,
    geminiNetworkPulseCount: 0,
    geminiNetworkHookRetryAt: 0,
    drag: {
      active: false,
      pointerId: null,
      startX: 0,
      startY: 0,
      originLeft: 0,
      originTop: 0,
    },
  };

  const FILTER_LABELS = {
    all: 'Todos',
    user: 'Prompt de usuario',
    ai: 'Respuesta de AI',
  };

  const SELECTORS = {
    chatgpt: {
      user: {
        items: [
          'div[data-message-author-role="user"]',
          'div[class*="user-message-bubble"]',
        ],
        text: [
          '.whitespace-pre-wrap',
          '.text-message',
        ],
      },
      ai: {
        items: [
          'div[data-message-author-role="assistant"]',
        ],
        text: [
          '.markdown',
          '.prose',
          '[data-message-author-role="assistant"]',
        ],
      },
    },
    gemini: {
      user: {
        items: [
          'span[class^="user-query-bubble"]',
          'div.query-text',
          'message-content .query-text',
        ],
        text: [
          '.horizontal-container .query-text p',
          'p',
          '.query-text',
        ],
      },
      ai: {
        items: [
          'div[class^="markdown markdown-main-panel"]',
          'message-content .model-response-text',
          'model-response .markdown',
        ],
        text: [
          'p',
          '.markdown',
          '.model-response-text',
        ],
      },
    },
  };

  function detectPlatform() {
    const host = location.hostname;
    if (host === 'chatgpt.com' || host.endsWith('.chatgpt.com')) return 'chatgpt';
    if (host === 'gemini.google.com') return 'gemini';
    return null;
  }

  function uniqueElements(elements) {
    return [...new Set(elements.filter(Boolean))];
  }

  function queryMany(selectorList) {
    const elements = [];
    for (const selector of selectorList) {
      document.querySelectorAll(selector).forEach((el) => elements.push(el));
    }
    return uniqueElements(elements);
  }

  function getSafeText(element, textSelectors) {
    if (!element) return '';

    for (const selector of textSelectors) {
      try {
        const found = element.matches(selector) ? element : element.querySelector(selector);
        if (found) {
          const text = (found.innerText || found.textContent || '').replace(/\s+/g, ' ').trim();
          if (text) return text;
        }
      } catch (_) {
        // ignore selector errors on dynamic DOMs
      }
    }

    return (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function isVisibleEnough(element) {
    if (!element || !element.isConnected) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function getAbsoluteRect(element) {
    const rect = element.getBoundingClientRect();
    const top = window.scrollY + rect.top;
    const left = window.scrollX + rect.left;
    return {
      top,
      left,
      right: left + rect.width,
      bottom: top + rect.height,
      width: rect.width,
      height: rect.height,
    };
  }

  function isSameConversationBlock(a, b) {
    if (!a || !b) return false;
    if (a.type !== b.type) return false;
    if (!a.text || !b.text) return false;
    if (a.text !== b.text) return false;

    if (a.element === b.element) return true;
    if (a.element.contains(b.element) || b.element.contains(a.element)) return true;

    const rectA = getAbsoluteRect(a.element);
    const rectB = getAbsoluteRect(b.element);
    const closeTop = Math.abs(rectA.top - rectB.top) <= 28;
    const overlapY = Math.max(0, Math.min(rectA.bottom, rectB.bottom) - Math.max(rectA.top, rectB.top));
    const minHeight = Math.max(1, Math.min(rectA.height, rectB.height));
    const heavyOverlap = overlapY / minHeight >= 0.6;

    return closeTop || heavyOverlap;
  }

  function pickBetterBlock(current, candidate) {
    if (!current) return candidate;
    if (!candidate) return current;

    if (current.element.contains(candidate.element)) return current;
    if (candidate.element.contains(current.element)) return candidate;

    const currentRect = current.element.getBoundingClientRect();
    const candidateRect = candidate.element.getBoundingClientRect();
    const currentArea = currentRect.width * currentRect.height;
    const candidateArea = candidateRect.width * candidateRect.height;

    return candidateArea > currentArea ? candidate : current;
  }

  function findAnchoredIndex() {
    if (!STATE.items.length) return -1;

    if (STATE.lastFocusedElement && STATE.lastFocusedElement.isConnected) {
      const byElement = STATE.items.findIndex((item) => item.element === STATE.lastFocusedElement);
      if (byElement !== -1) return byElement;
    }

    if (STATE.lastFocusedText && STATE.lastFocusedType) {
      const bySignature = STATE.items.findIndex((item) => item.type === STATE.lastFocusedType && item.fullText === STATE.lastFocusedText);
      if (bySignature !== -1) return bySignature;
    }

    return -1;
  }

  function rememberItemAsAnchor(index) {
    if (index < 0 || index >= STATE.items.length) {
      STATE.lastFocusedElement = null;
      STATE.lastFocusedText = '';
      STATE.lastFocusedType = '';
      return;
    }

    const item = STATE.items[index];
    STATE.currentIndex = index;
    STATE.lastFocusedElement = item.element;
    STATE.lastFocusedText = item.fullText;
    STATE.lastFocusedType = item.type;
  }

  function hasActiveNavLock() {
    return Date.now() < STATE.navLockUntil && STATE.navLockIndex >= 0 && STATE.navLockIndex < STATE.items.length;
  }

  function clearNavigationLock() {
    STATE.navLockUntil = 0;
    STATE.navLockIndex = -1;
  }

  function syncAnchorToViewport(force = false) {
    if (!STATE.items.length) {
      STATE.currentIndex = -1;
      rememberItemAsAnchor(-1);
      refreshPanelState();
      renderListBody();
      return;
    }

    updateCurrentIndexFromViewport(force);
    rememberItemAsAnchor(STATE.currentIndex);
    refreshPanelState();
    renderListBody();
  }

  function handleManualScrollIntent() {
    clearNavigationLock();
  }

  function scanMessages() {
    const defs = SELECTORS[PLATFORM];
    const pool = [];

    for (const el of queryMany(defs.user.items)) {
      pool.push({
        type: 'user',
        element: el,
        top: el.getBoundingClientRect().top + window.scrollY,
        text: getSafeText(el, defs.user.text),
      });
    }

    for (const el of queryMany(defs.ai.items)) {
      pool.push({
        type: 'ai',
        element: el,
        top: el.getBoundingClientRect().top + window.scrollY,
        text: getSafeText(el, defs.ai.text),
      });
    }

    pool.sort((a, b) => a.top - b.top);

    const dedup = [];
    const seen = new Set();

    for (const item of pool) {
      if (!item.text) continue;
      if (!isVisibleEnough(item.element)) continue;
      if (seen.has(item.element)) continue;
      seen.add(item.element);

      const last = dedup[dedup.length - 1];
      if (last && isSameConversationBlock(last, item)) {
        dedup[dedup.length - 1] = pickBetterBlock(last, item);
        continue;
      }

      dedup.push(item);
    }

    const filtered = dedup.filter((item) => STATE.filterMode === 'all' || item.type === STATE.filterMode);

    STATE.items = filtered.map((item, index) => ({
      index,
      type: item.type,
      element: item.element,
      fullText: item.text,
      preview: item.text.length > 90 ? item.text.slice(0, 90) + '…' : item.text,
    }));

    const anchoredIndex = findAnchoredIndex();
    if (anchoredIndex !== -1) {
      STATE.currentIndex = anchoredIndex;
    } else {
      updateCurrentIndexFromViewport();
      rememberItemAsAnchor(STATE.currentIndex);
    }

    refreshPanelState();
    renderListBody();
  }

  function updateCurrentIndexFromViewport(force = false) {
    if (!STATE.items.length) {
      STATE.currentIndex = -1;
      return;
    }

    if (!force && Date.now() < STATE.navLockUntil && STATE.navLockIndex >= 0 && STATE.navLockIndex < STATE.items.length) {
      STATE.currentIndex = STATE.navLockIndex;
      return;
    }

    const viewportTop = window.scrollY + 20;
    let containingIndex = -1;
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;

    STATE.items.forEach((item, index) => {
      const rect = item.element.getBoundingClientRect();
      if (!rect.width && !rect.height) return;

      const top = window.scrollY + rect.top;
      const bottom = top + Math.max(rect.height, 1);
      const distanceToTop = Math.abs(top - viewportTop);

      if (viewportTop >= top && viewportTop < bottom && containingIndex === -1) {
        containingIndex = index;
      }

      if (distanceToTop < nearestDistance) {
        nearestDistance = distanceToTop;
        nearestIndex = index;
      }
    });

    STATE.currentIndex = containingIndex !== -1 ? containingIndex : nearestIndex;
  }

  function getScrollParent(element) {
    if (!element) return document.documentElement;

    let parent = element.parentElement;
    while (parent) {
      const style = window.getComputedStyle(parent);
      if (parent.scrollHeight > parent.clientHeight && (style.overflowY === 'auto' || style.overflowY === 'scroll')) {
        return parent;
      }
      parent = parent.parentElement;
    }

    return document.documentElement;
  }

  function scrollToItem(index) {
    if (index < 0 || index >= STATE.items.length) return;

    const item = STATE.items[index];
    const target = item.element;
    const scrollParent = getScrollParent(target);
    const topOffset = 16;

    rememberItemAsAnchor(index);
    STATE.navLockIndex = index;
    STATE.navLockUntil = Date.now() + 900;

    try {
      target.style.scrollMarginTop = `${topOffset}px`;

      if (scrollParent === document.documentElement) {
        const targetTop = window.scrollY + target.getBoundingClientRect().top - topOffset;
        window.scrollTo({
          top: Math.max(0, targetTop),
          behavior: 'smooth',
        });
      } else {
        const parentRect = scrollParent.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const targetTop = scrollParent.scrollTop + (targetRect.top - parentRect.top) - topOffset;
        scrollParent.scrollTo({
          top: Math.max(0, targetTop),
          behavior: 'smooth',
        });
      }
    } catch (_) {
      target.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
        inline: 'nearest',
      });
    }

    flashItem(target);
    refreshPanelState();
    renderListBody();
  }

  function resolveNavigationBaseIndex() {
    scanMessages();

    const anchoredIndex = findAnchoredIndex();
    if (anchoredIndex !== -1) {
      STATE.currentIndex = anchoredIndex;
      return anchoredIndex;
    }

    updateCurrentIndexFromViewport(true);
    return Math.max(STATE.currentIndex, 0);
  }

  function goNext() {
    if (!STATE.items.length) return;
    const baseIndex = resolveNavigationBaseIndex();
    const nextIndex = Math.min(baseIndex + 1, STATE.items.length - 1);
    scrollToItem(nextIndex);
  }

  function goPrev() {
    if (!STATE.items.length) return;
    const baseIndex = resolveNavigationBaseIndex();
    const prevIndex = Math.max(baseIndex - 1, 0);
    scrollToItem(prevIndex);
  }

  function flashItem(element) {
    element.classList.add('__cg_nav_flash');
    setTimeout(() => element.classList.remove('__cg_nav_flash'), 1300);
  }

  function readStorageJson(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function writeStorageJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) { }
  }

  function loadUiPreferences() {
    const storedTheme = localStorage.getItem(STORAGE_KEYS.theme);
    if (THEME_ORDER.includes(storedTheme)) {
      STATE.themeMode = storedTheme;
    }

    const storedPosition = readStorageJson(STORAGE_KEYS.position);
    if (storedPosition && Number.isFinite(storedPosition.left) && Number.isFinite(storedPosition.top)) {
      STATE.panelPosition = {
        left: storedPosition.left,
        top: storedPosition.top,
      };
    }

    const storedAlarmEnabled = localStorage.getItem(STORAGE_KEYS.alarmEnabled);
    STATE.alarmEnabled = storedAlarmEnabled === '1';
  }

  function getResolvedTheme() {
    if (STATE.themeMode === 'dark') return 'dark';
    if (STATE.themeMode === 'light') return 'light';
    return COLOR_SCHEME_QUERY && COLOR_SCHEME_QUERY.matches ? 'dark' : 'light';
  }

  function applyTheme() {
    STATE.resolvedTheme = getResolvedTheme();
    document.documentElement.setAttribute('data-__cg-nav-theme', STATE.resolvedTheme);
    document.documentElement.setAttribute('data-__cg-nav-theme-mode', STATE.themeMode);
    refreshThemeControls();
  }

  function cycleThemeMode() {
    const currentIndex = THEME_ORDER.indexOf(STATE.themeMode);
    const nextIndex = (currentIndex + 1) % THEME_ORDER.length;
    STATE.themeMode = THEME_ORDER[nextIndex];

    try {
      localStorage.setItem(STORAGE_KEYS.theme, STATE.themeMode);
    } catch (_) { }

    applyTheme();
  }


  function getThemeIconSvg(mode) {
    if (mode === 'dark') {
      return `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M20 15.31A8 8 0 0 1 8.69 4 9 9 0 1 0 20 15.31z" fill="currentColor"></path>
        </svg>
      `;
    }

    if (mode === 'light') {
      return `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="4" fill="currentColor"></circle>
          <path d="M12 2v3M12 19v3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M2 12h3M19 12h3M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"></path>
        </svg>
      `;
    }

    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="3" y="5" width="18" height="12" rx="2.5" ry="2.5" stroke="currentColor" stroke-width="1.8" fill="none"></rect>
        <path d="M8 20h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"></path>
      </svg>
    `;
  }

  function getAlarmIconSvg(enabled) {
    if (enabled) {
      return `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-4H5l2-2v-4.5a5 5 0 1 1 10 0V16l2 2Z" fill="currentColor"></path>
        </svg>
      `;
    }

    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Z" fill="currentColor"></path>
        <path d="M4 4l16 16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"></path>
        <path d="M8.2 8.2A4.97 4.97 0 0 0 7 11.5V16l-2 2h10.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"></path>
        <path d="M15.8 15.8 17 17h2l-2-2v-3.5a5 5 0 0 0-5-5c-.59 0-1.17.1-1.71.3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"></path>
      </svg>
    `;
  }

  function getListIconSvg() {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"></path>
      </svg>
    `;
  }

  function getResetIconSvg() {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 4v4M12 16v4M4 12h4M16 12h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"></path>
        <circle cx="12" cy="12" r="3.5" stroke="currentColor" stroke-width="1.8" fill="none"></circle>
      </svg>
    `;
  }

  function getDragIconSvg() {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="8" cy="6" r="1.4" fill="currentColor"></circle>
        <circle cx="16" cy="6" r="1.4" fill="currentColor"></circle>
        <circle cx="8" cy="12" r="1.4" fill="currentColor"></circle>
        <circle cx="16" cy="12" r="1.4" fill="currentColor"></circle>
        <circle cx="8" cy="18" r="1.4" fill="currentColor"></circle>
        <circle cx="16" cy="18" r="1.4" fill="currentColor"></circle>
      </svg>
    `;
  }

  function refreshThemeControls() {
    const controls = document.querySelectorAll('[data-role="__cg_nav_theme_toggle"]');
    controls.forEach((button) => {
      setSafeInnerHTML(button, getThemeIconSvg(STATE.themeMode));
      button.setAttribute('aria-label', `Tema: ${STATE.themeMode}`);
      button.setAttribute('data-theme-mode', STATE.themeMode);
      button.title = `Tema: ${STATE.themeMode}. Click para alternar.`;
    });
  }

  function refreshAlarmControls() {
    const controls = document.querySelectorAll('[data-role="__cg_nav_alarm_toggle"]');
    controls.forEach((button) => {
      setSafeInnerHTML(button, getAlarmIconSvg(STATE.alarmEnabled));
      button.classList.toggle('__cg_nav_primary', STATE.alarmEnabled);
      button.classList.toggle('__cg_nav_ghost', !STATE.alarmEnabled);
      button.setAttribute('aria-pressed', STATE.alarmEnabled ? 'true' : 'false');
      button.setAttribute('aria-label', STATE.alarmEnabled ? 'Alarma activada' : 'Alarma desactivada');
      button.title = STATE.alarmEnabled ? 'Alarma activada' : 'Alarma desactivada';
    });
  }


  function setAlarmEnabled(enabled) {
    STATE.alarmEnabled = !!enabled;

    try {
      localStorage.setItem(STORAGE_KEYS.alarmEnabled, STATE.alarmEnabled ? '1' : '0');
    } catch (_) { }

    if (STATE.alarmEnabled) {
      initAlarmAudio();
      startAlarmKeepAlive();
      initChatGptNetworkAlarm();
      initGeminiNetworkAlarm();
    } else {
      stopAlarmKeepAlive();
      resetChatGptNetworkAlarmState();
      resetGeminiNetworkAlarmState();
    }

    refreshAlarmControls();
  }

  function toggleAlarmEnabled() {
    setAlarmEnabled(!STATE.alarmEnabled);
  }

  function initAlarmAudio() {
    try {
      if (!STATE.alarmAudioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) STATE.alarmAudioCtx = new Ctx();
      }
      if (STATE.alarmAudioCtx && STATE.alarmAudioCtx.state === 'suspended') {
        STATE.alarmAudioCtx.resume().catch(() => { });
      }
    } catch (_) { }
  }

  function startAlarmKeepAlive() {
    if (STATE.alarmKeepAliveAudio) return;

    try {
      const b64Data = 'UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
      const bytes = Uint8Array.from(atob(b64Data), (char) => char.charCodeAt(0));
      const blob = new Blob([bytes], { type: 'audio/wav' });
      const audio = new Audio(URL.createObjectURL(blob));
      audio.loop = true;
      audio.volume = 0.01;
      audio.play().catch(() => { });
      STATE.alarmKeepAliveAudio = audio;
    } catch (_) { }
  }

  function stopAlarmKeepAlive() {
    const audio = STATE.alarmKeepAliveAudio;
    if (!audio) return;

    try {
      audio.pause();
      audio.src = '';
    } catch (_) { }

    STATE.alarmKeepAliveAudio = null;
  }

  function shouldDeliverAlarm() {
    return STATE.alarmEnabled && (document.hidden || !document.hasFocus());
  }

  function scheduleGainEnvelope(gainParam, startAt, peak, attack = 0.018, hold = 0.035, release = 1.85) {
    const floor = 0.0001;
    try {
      gainParam.cancelScheduledValues(startAt);
      gainParam.setValueAtTime(floor, startAt);
      gainParam.linearRampToValueAtTime(peak, startAt + attack);
      gainParam.setValueAtTime(peak * 0.82, startAt + attack + hold);
      gainParam.exponentialRampToValueAtTime(floor, startAt + attack + hold + release);
    } catch (_) { }
  }

  function createAlarmImpulseResponse(ctx, duration = 2.35, decay = 3.2) {
    const sampleRate = ctx.sampleRate || 44100;
    const length = Math.max(1, Math.floor(sampleRate * duration));
    const impulse = ctx.createBuffer(2, length, sampleRate);

    for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i += 1) {
        const t = i / length;
        const envelope = Math.pow(1 - t, decay);
        data[i] = (Math.random() * 2 - 1) * envelope * 0.34;
      }
    }

    return impulse;
  }

  function makeAlarmOutputChain(ctx) {
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    const master = ctx.createGain();
    const highpass = ctx.createBiquadFilter();
    const lowpass = ctx.createBiquadFilter();
    const compressor = ctx.createDynamicsCompressor();
    const delay = ctx.createDelay(1.0);
    const delayFeedback = ctx.createGain();
    const convolver = ctx.createConvolver();

    dry.gain.setValueAtTime(0.82, ctx.currentTime);
    wet.gain.setValueAtTime(0.26, ctx.currentTime);
    master.gain.setValueAtTime(0.72, ctx.currentTime);

    highpass.type = 'highpass';
    highpass.frequency.setValueAtTime(180, ctx.currentTime);
    highpass.Q.setValueAtTime(0.72, ctx.currentTime);

    lowpass.type = 'lowpass';
    lowpass.frequency.setValueAtTime(7600, ctx.currentTime);
    lowpass.Q.setValueAtTime(0.52, ctx.currentTime);

    compressor.threshold.setValueAtTime(-22, ctx.currentTime);
    compressor.knee.setValueAtTime(18, ctx.currentTime);
    compressor.ratio.setValueAtTime(3.2, ctx.currentTime);
    compressor.attack.setValueAtTime(0.006, ctx.currentTime);
    compressor.release.setValueAtTime(0.22, ctx.currentTime);

    delay.delayTime.setValueAtTime(0.145, ctx.currentTime);
    delayFeedback.gain.setValueAtTime(0.16, ctx.currentTime);
    convolver.buffer = createAlarmImpulseResponse(ctx);

    dry.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(compressor);
    compressor.connect(master);
    compressor.connect(delay);
    compressor.connect(convolver);
    delay.connect(delayFeedback);
    delayFeedback.connect(delay);
    delay.connect(wet);
    convolver.connect(wet);
    wet.connect(master);
    master.connect(ctx.destination);

    const nodes = [dry, wet, master, highpass, lowpass, compressor, delay, delayFeedback, convolver];
    dry.__cgNavDisconnect = () => {
      nodes.forEach((node) => {
        try { node.disconnect(); } catch (_) { }
      });
    };

    return dry;
  }

  function scheduleBellPartial(ctx, output, frequency, startAt, gainValue, duration, type = 'sine', detune = 0) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;

    osc.type = type;
    osc.frequency.setValueAtTime(frequency, startAt);
    if (osc.detune) osc.detune.setValueAtTime(detune, startAt);

    scheduleGainEnvelope(gain.gain, startAt, gainValue, 0.016, 0.025, duration);

    osc.connect(gain);
    if (panner) {
      const pan = Math.max(-0.34, Math.min(0.34, Math.sin(frequency * 0.017) * 0.22));
      panner.pan.setValueAtTime(pan, startAt);
      gain.connect(panner);
      panner.connect(output);
    } else {
      gain.connect(output);
    }

    osc.start(startAt);
    osc.stop(startAt + duration + 0.12);
  }

  function playAppleInspiredChime() {
    initAlarmAudio();
    const ctx = STATE.alarmAudioCtx;
    if (!ctx) return false;

    const startAt = ctx.currentTime + 0.018;
    const output = makeAlarmOutputChain(ctx);

    // Campana sintética: Dmaj9 ascendente, ataque limpio y cola amplia.
    // El mismo motivo se repite 4 veces para que no sea fácil de ignorar.
    // No usa ni replica assets propietarios; sólo osciladores Web Audio.
    const motif = [
      { t: 0.00, f: 587.33, g: 0.080, d: 1.55 }, // D5
      { t: 0.14, f: 739.99, g: 0.070, d: 1.65 }, // F#5
      { t: 0.30, f: 880.00, g: 0.066, d: 1.80 }, // A5
      { t: 0.54, f: 1108.73, g: 0.054, d: 1.95 }, // C#6
      { t: 0.84, f: 1174.66, g: 0.050, d: 2.05 }, // D6
    ];

    const scheduleChimeOnce = (baseAt, gainScale = 1) => {
      motif.forEach((note) => {
        const t = baseAt + note.t;
        scheduleBellPartial(ctx, output, note.f, t, note.g * gainScale, note.d, 'sine', -2);
        scheduleBellPartial(ctx, output, note.f * 2.01, t + 0.006, note.g * 0.34 * gainScale, note.d * 0.82, 'triangle', 3);
        scheduleBellPartial(ctx, output, note.f * 3.01, t + 0.012, note.g * 0.12 * gainScale, note.d * 0.55, 'sine', -5);
      });

      // Refuerzo muy suave al final: hace que la notificación dure sin volverse agresiva.
      scheduleBellPartial(ctx, output, 1479.98, baseAt + 1.18, 0.028 * gainScale, 1.65, 'sine', 1); // F#6
      scheduleBellPartial(ctx, output, 1760.00, baseAt + 1.34, 0.020 * gainScale, 1.45, 'sine', -3); // A6
    };

    for (let i = 0; i < ALARM_CHIME_REPEAT_COUNT; i += 1) {
      const baseAt = startAt + (i * ALARM_CHIME_REPEAT_INTERVAL_SEC);
      const gainScale = Math.max(0.72, 1 - (i * 0.06));
      scheduleChimeOnce(baseAt, gainScale);
    }

    const totalMs = Math.ceil(((ALARM_CHIME_REPEAT_COUNT - 1) * ALARM_CHIME_REPEAT_INTERVAL_SEC + 4.2) * 1000);
    window.setTimeout(() => {
      try {
        if (output && typeof output.__cgNavDisconnect === 'function') output.__cgNavDisconnect();
      } catch (_) { }
    }, totalMs);

    return true;
  }


  function triggerAlarm(message = 'Alarma de conversación.') {
    const now = Date.now();
    if (!shouldDeliverAlarm()) return false;
    if (now - STATE.lastAlarmAt < ALARM_COOLDOWN_MS) return false;

    STATE.lastAlarmAt = now;

    try {
      initAlarmAudio();

      playAppleInspiredChime();

      if (typeof GM_notification === 'function') {
        GM_notification({
          title: PLATFORM === 'gemini' ? 'Gemini' : 'ChatGPT',
          text: message,
          timeout: 12000,
          onclick: () => window.focus(),
        });
      }

      return true;
    } catch (_) {
      return false;
    }
  }


  function getUserscriptWindow() {
    try {
      if (typeof unsafeWindow !== 'undefined' && unsafeWindow) return unsafeWindow;
    } catch (_) { }
    return window;
  }

  function extractRequestUrl(input) {
    try {
      if (typeof input === 'string') return input;
      if (input instanceof URL) return input.href;
      if (input && typeof input.href === 'string') return input.href;
      if (input && typeof input.url === 'string') return input.url;
      if (input && typeof input.toString === 'function') return input.toString();
    } catch (_) { }
    return '';
  }

  function extractRequestMethod(input, init) {
    try {
      if (init && typeof init.method === 'string') return init.method.toUpperCase();
      if (input && typeof input.method === 'string') return input.method.toUpperCase();
    } catch (_) { }
    return 'GET';
  }

  function normalizeRequestUrl(url) {
    try {
      return new URL(String(url || ''), location.href).href;
    } catch (_) {
      return String(url || '');
    }
  }

  function isChatGptLatCompletionRequest(url, method) {
    return PLATFORM === 'chatgpt'
      && String(method || '').toUpperCase() === 'POST'
      && normalizeRequestUrl(url) === CHATGPT_LAT_COMPLETION_URL;
  }

  function isGeminiBatchExecuteUrl(url) {
    return typeof url === 'string' && url.includes(GEMINI_NETWORK_TARGET_ENDPOINT);
  }

  function resetChatGptNetworkAlarmState() {
    // Los hooks permanecen instalados; no disparan si la alarma está apagada.
  }

  function initChatGptNetworkAlarm() {
    if (PLATFORM !== 'chatgpt') return;

    initChatGptNetworkHooks();
    startChatGptNetworkMonitor();
    STATE.chatgptNetworkInitialized = true;
  }

  function initChatGptNetworkHooks() {
    if (PLATFORM !== 'chatgpt') return;

    const pageWindow = getUserscriptWindow();
    hookChatGptFetch(pageWindow);
    hookChatGptXhr(pageWindow);
  }

  function registerChatGptLatCompletion() {
    if (PLATFORM !== 'chatgpt' || !STATE.alarmEnabled) return false;
    return triggerAlarm('ChatGPT terminó de responder.');
  }

  function hookChatGptFetch(pageWindow) {
    try {
      if (!pageWindow || typeof pageWindow.fetch !== 'function') return;
      if (isHookedFunction(pageWindow.fetch, '__cgNavChatGptFetchHook')) return;

      const originalFetch = pageWindow.fetch;

      const wrappedFetch = function (...args) {
        const input = args[0];
        const init = args[1];
        const url = extractRequestUrl(input);
        const method = extractRequestMethod(input, init);

        if (isChatGptLatCompletionRequest(url, method)) {
          registerChatGptLatCompletion();
        }

        return originalFetch.apply(this, args);
      };

      markHookedFunction(wrappedFetch, '__cgNavChatGptFetchHook');
      pageWindow.fetch = wrappedFetch;
    } catch (_) { }
  }

  function hookChatGptXhr(pageWindow) {
    try {
      const XHR = pageWindow && pageWindow.XMLHttpRequest;
      const proto = XHR && XHR.prototype;

      if (!proto || typeof proto.open !== 'function' || typeof proto.send !== 'function') return;

      if (!isHookedFunction(proto.open, '__cgNavChatGptXhrOpenHook')) {
        const originalOpen = proto.open;

        const wrappedOpen = function (method, url) {
          try {
            const requestMethod = String(method || 'GET').toUpperCase();
            const requestUrl = extractRequestUrl(url);
            this.__cgNavChatGptLatRequest = isChatGptLatCompletionRequest(requestUrl, requestMethod);
          } catch (_) {
            this.__cgNavChatGptLatRequest = false;
          }

          return originalOpen.apply(this, arguments);
        };

        markHookedFunction(wrappedOpen, '__cgNavChatGptXhrOpenHook');
        proto.open = wrappedOpen;
      }

      if (!isHookedFunction(proto.send, '__cgNavChatGptXhrSendHook')) {
        const originalSend = proto.send;

        const wrappedSend = function () {
          if (this.__cgNavChatGptLatRequest) {
            registerChatGptLatCompletion();
          }

          return originalSend.apply(this, arguments);
        };

        markHookedFunction(wrappedSend, '__cgNavChatGptXhrSendHook');
        proto.send = wrappedSend;
      }
    } catch (_) { }
  }

  function startChatGptNetworkMonitor() {
    if (PLATFORM !== 'chatgpt' || STATE.chatgptNetworkMonitor) return;

    STATE.chatgptNetworkMonitor = window.setInterval(() => {
      const now = Date.now();
      if (STATE.alarmEnabled && now - STATE.chatgptNetworkHookRetryAt > CHATGPT_NETWORK_HOOK_RETRY_MS) {
        STATE.chatgptNetworkHookRetryAt = now;
        initChatGptNetworkHooks();
      }
    }, CHATGPT_NETWORK_HOOK_RETRY_MS);
  }

  function resetGeminiNetworkAlarmState() {
    STATE.geminiNetworkIsGenerating = false;
    STATE.geminiNetworkLastPulseAt = 0;
    STATE.geminiNetworkPulseCount = 0;
  }

  function registerGeminiNetworkPulse() {
    if (PLATFORM !== 'gemini') return;
    if (!STATE.alarmEnabled) return;

    const now = Date.now();
    STATE.geminiNetworkLastPulseAt = now;
    STATE.geminiNetworkPulseCount += 1;

    if (!STATE.geminiNetworkIsGenerating && STATE.geminiNetworkPulseCount >= GEMINI_NETWORK_BURST_THRESHOLD) {
      STATE.geminiNetworkIsGenerating = true;
    }
  }

  function triggerGeminiNetworkAlarm() {
    const now = Date.now();

    // Mantiene el contrato del script dedicado: solo suena/notifica cuando Gemini está en segundo plano.
    if (PLATFORM !== 'gemini' || !STATE.alarmEnabled || !document.hidden) return false;
    if (now - STATE.lastAlarmAt < ALARM_COOLDOWN_MS) return false;

    STATE.lastAlarmAt = now;

    try {
      initAlarmAudio();

      playAppleInspiredChime();

      if (typeof GM_notification === 'function') {
        GM_notification({
          title: 'Gemini',
          text: 'Flujo de red completado.',
          timeout: 12000,
          onclick: () => window.focus(),
        });
      }

      return true;
    } catch (_) {
      return false;
    }
  }

  function markHookedFunction(fn, markerName) {
    try {
      Object.defineProperty(fn, markerName, {
        value: true,
        configurable: false,
        enumerable: false,
        writable: false,
      });
    } catch (_) {
      try {
        fn[markerName] = true;
      } catch (_) { }
    }
  }

  function isHookedFunction(fn, markerName) {
    try {
      return !!(fn && fn[markerName]);
    } catch (_) {
      return false;
    }
  }

  function initGeminiNetworkAlarm() {
    if (PLATFORM !== 'gemini') return;

    initGeminiNetworkHooks();
    startGeminiNetworkMonitor();

    STATE.geminiNetworkInitialized = true;
  }

  function initGeminiNetworkHooks() {
    if (PLATFORM !== 'gemini') return;

    const pageWindow = getUserscriptWindow();

    hookGeminiXhr(pageWindow);
    hookGeminiFetch(pageWindow);
  }

  function hookGeminiXhr(pageWindow) {
    try {
      const XHR = pageWindow && pageWindow.XMLHttpRequest;
      const proto = XHR && XHR.prototype;

      if (!proto || typeof proto.open !== 'function') return;
      if (isHookedFunction(proto.open, '__cgNavGeminiXhrOpenHook')) return;

      const originalOpen = proto.open;

      const wrappedOpen = function (method, url) {
        if (isGeminiBatchExecuteUrl(extractRequestUrl(url))) {
          try {
            this.addEventListener('loadstart', registerGeminiNetworkPulse);
          } catch (_) { }
        }

        return originalOpen.apply(this, arguments);
      };

      markHookedFunction(wrappedOpen, '__cgNavGeminiXhrOpenHook');
      proto.open = wrappedOpen;
    } catch (_) { }
  }

  function hookGeminiFetch(pageWindow) {
    try {
      if (!pageWindow || typeof pageWindow.fetch !== 'function') return;
      if (isHookedFunction(pageWindow.fetch, '__cgNavGeminiFetchHook')) return;

      const originalFetch = pageWindow.fetch;

      const wrappedFetch = function (...args) {
        const url = extractRequestUrl(args[0]);
        if (isGeminiBatchExecuteUrl(url)) {
          registerGeminiNetworkPulse();
        }

        return originalFetch.apply(this, args);
      };

      markHookedFunction(wrappedFetch, '__cgNavGeminiFetchHook');
      pageWindow.fetch = wrappedFetch;
    } catch (_) { }
  }

  function startGeminiNetworkMonitor() {
    if (PLATFORM !== 'gemini' || STATE.geminiNetworkMonitor) return;

    STATE.geminiNetworkMonitor = window.setInterval(() => {
      const now = Date.now();

      // Reenganche defensivo: Gemini puede reemplazar fetch/XHR durante navegación SPA.
      if (STATE.alarmEnabled && now - STATE.geminiNetworkHookRetryAt > 2000) {
        STATE.geminiNetworkHookRetryAt = now;
        initGeminiNetworkHooks();
      }

      if (!STATE.alarmEnabled) {
        resetGeminiNetworkAlarmState();
        return;
      }

      if (STATE.geminiNetworkIsGenerating) {
        const idleTime = now - STATE.geminiNetworkLastPulseAt;

        if (idleTime > GEMINI_NETWORK_PULSE_TIMEOUT_MS) {
          STATE.geminiNetworkIsGenerating = false;
          STATE.geminiNetworkPulseCount = 0;
          triggerGeminiNetworkAlarm();
        }
      } else if (!document.hidden) {
        // Mismo comportamiento que el script dedicado: al estar visible, no acumula pulsos antiguos.
        STATE.geminiNetworkPulseCount = 0;
      }
    }, GEMINI_NETWORK_MONITOR_INTERVAL_MS);
  }

  function ensureStyles() {
    if (document.getElementById('__cg_nav_styles')) return;

    const css = `
      html[data-__cg-nav-theme="dark"] {
        --cg-nav-bg: rgba(18, 18, 22, 0.92);
        --cg-nav-bg-solid: #121216;
        --cg-nav-surface: rgba(255,255,255,.05);
        --cg-nav-surface-2: rgba(255,255,255,.08);
        --cg-nav-surface-3: rgba(255,255,255,.12);
        --cg-nav-border: rgba(255,255,255,.10);
        --cg-nav-text: #f5f7fb;
        --cg-nav-text-soft: rgba(245,247,251,.72);
        --cg-nav-primary: #6d83ff;
        --cg-nav-primary-soft: rgba(109,131,255,.20);
        --cg-nav-shadow: 0 14px 40px rgba(0,0,0,.34);
        --cg-nav-user: #214a53;
        --cg-nav-ai: #493565;
        --cg-nav-overlay: rgba(0,0,0,.46);
      }
      html[data-__cg-nav-theme="light"] {
        --cg-nav-bg: rgba(255, 255, 255, 0.88);
        --cg-nav-bg-solid: #ffffff;
        --cg-nav-surface: rgba(18,18,22,.05);
        --cg-nav-surface-2: rgba(18,18,22,.08);
        --cg-nav-surface-3: rgba(18,18,22,.12);
        --cg-nav-border: rgba(18,18,22,.10);
        --cg-nav-text: #111827;
        --cg-nav-text-soft: rgba(17,24,39,.70);
        --cg-nav-primary: #405cf5;
        --cg-nav-primary-soft: rgba(64,92,245,.16);
        --cg-nav-shadow: 0 14px 40px rgba(15,23,42,.16);
        --cg-nav-user: #d9eef5;
        --cg-nav-ai: #ebe3ff;
        --cg-nav-overlay: rgba(15,23,42,.26);
      }
      #__cg_nav_panel {
        all: initial;
        position: fixed;
        top: 18px;
        left: 18px;
        z-index: 2147483647;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        width: auto;
        max-width: min(94vw, 560px);
        padding: 6px;
        border-radius: 14px;
        border: 1px solid var(--cg-nav-border);
        background: var(--cg-nav-bg);
        color: var(--cg-nav-text);
        backdrop-filter: blur(12px);
        box-shadow: var(--cg-nav-shadow);
        font: 13px/1.2 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        box-sizing: border-box;
        user-select: none;
      }
      #__cg_nav_panel, #__cg_nav_panel * { box-sizing: border-box; }
      #__cg_nav_panel.__dragging,
      #__cg_nav_panel.__dragging * {
        cursor: grabbing !important;
      }
      #__cg_nav_panel button,
      #__cg_nav_drag {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 34px;
        height: 34px;
        min-width: 34px;
        padding: 0;
        border: 1px solid var(--cg-nav-border);
        border-radius: 10px;
        background: var(--cg-nav-surface);
        color: var(--cg-nav-text);
        transition: background .14s ease, border-color .14s ease, transform .08s ease, opacity .14s ease;
      }
      #__cg_nav_panel button {
        cursor: pointer;
        font: inherit;
      }
      #__cg_nav_panel button:hover,
      #__cg_nav_drag:hover {
        background: var(--cg-nav-surface-2);
      }
      #__cg_nav_panel button:active { transform: translateY(1px); }
      #__cg_nav_panel button:disabled {
        opacity: .45;
        cursor: default;
        transform: none;
      }
      #__cg_nav_panel button.__cg_nav_primary,
      #__cg_nav_filters button.__active {
        background: var(--cg-nav-primary-soft);
        border-color: rgba(64,92,245,.34);
      }
      #__cg_nav_panel button.__cg_nav_ghost,
      #__cg_nav_modal_header button {
        background: transparent;
      }
      #__cg_nav_panel button svg,
      #__cg_nav_drag svg {
        width: 18px;
        height: 18px;
        display: block;
        pointer-events: none;
      }
      #__cg_nav_drag {
        cursor: grab;
      }
      #__cg_nav_counter {
        min-width: 56px;
        height: 34px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0 8px;
        border-radius: 10px;
        border: 1px solid var(--cg-nav-border);
        background: transparent;
        color: var(--cg-nav-text-soft);
        font-variant-numeric: tabular-nums;
      }
      #__cg_prev_btn,
      #__cg_next_btn {
        font-size: 18px;
        line-height: 1;
      }
      #__cg_nav_modal {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        background: var(--cg-nav-overlay);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
      }
      #__cg_nav_modal_box {
        width: min(920px, 92vw);
        height: min(78vh, 780px);
        background: var(--cg-nav-bg-solid);
        color: var(--cg-nav-text);
        border: 1px solid var(--cg-nav-border);
        border-radius: 18px;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        box-shadow: var(--cg-nav-shadow);
        font: 13px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #__cg_nav_modal_header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        padding: 14px 16px;
        border-bottom: 1px solid var(--cg-nav-border);
      }
      #__cg_nav_modal_header_left,
      #__cg_nav_modal_header_right {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      #__cg_nav_filters {
        display: flex;
        gap: 8px;
        padding: 12px 16px;
        border-bottom: 1px solid var(--cg-nav-border);
        flex-wrap: wrap;
      }
      #__cg_nav_filters button,
      #__cg_nav_modal_header button {
        border: 1px solid var(--cg-nav-border);
        border-radius: 10px;
        padding: 8px 12px;
        background: var(--cg-nav-surface);
        color: var(--cg-nav-text);
        cursor: pointer;
        font: inherit;
      }
      #__cg_nav_list {
        flex: 1;
        overflow: auto;
        padding: 8px 10px 12px;
      }
      .__cg_nav_row {
        display: grid;
        grid-template-columns: 108px 1fr;
        gap: 10px;
        padding: 10px 12px;
        border-radius: 12px;
        cursor: pointer;
        margin-bottom: 8px;
        border: 1px solid transparent;
        background: var(--cg-nav-surface);
      }
      .__cg_nav_row:hover {
        background: var(--cg-nav-surface-2);
      }
      .__cg_nav_row.__active {
        border-color: rgba(64,92,245,.34);
        background: var(--cg-nav-primary-soft);
      }
      .__cg_nav_badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: fit-content;
        min-width: 88px;
        height: 28px;
        border-radius: 999px;
        padding: 0 10px;
        background: var(--cg-nav-surface-3);
      }
      .__cg_nav_badge.__user { background: var(--cg-nav-user); }
      .__cg_nav_badge.__ai { background: var(--cg-nav-ai); }
      .__cg_nav_empty {
        padding: 30px 16px;
        color: var(--cg-nav-text-soft);
      }
      .__cg_nav_flash {
        animation: __cg_nav_pulse 1.2s ease;
      }
      html.__cg_nav_no_select,
      html.__cg_nav_no_select * {
        user-select: none !important;
      }
      @media (max-width: 640px) {
        #__cg_nav_panel {
          max-width: 96vw;
          gap: 4px;
          padding: 5px;
        }
        #__cg_nav_panel button,
        #__cg_nav_drag,
        #__cg_nav_counter {
          width: 32px;
          height: 32px;
          min-width: 32px;
        }
        #__cg_nav_counter {
          min-width: 52px;
          padding: 0 6px;
        }
        #__cg_nav_modal_box {
          width: 96vw;
          height: 82vh;
        }
        .__cg_nav_row {
          grid-template-columns: 1fr;
        }
      }
      @keyframes __cg_nav_pulse {
        0% { box-shadow: 0 0 0 0 rgba(64,92,245,.55); }
        100% { box-shadow: 0 0 0 18px rgba(64,92,245,0); }
      }
    `;

    const style = document.createElement('style');
    style.id = '__cg_nav_styles';
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }


  function getDefaultPanelPosition(panel) {
    const margin = 18;
    const width = panel.offsetWidth || 340;
    const height = panel.offsetHeight || 132;
    const left = Math.max(margin, window.innerWidth - width - margin);
    const top = Math.max(margin, window.innerHeight - height - margin);
    return { left, top };
  }

  function clampPanelPosition(left, top, panel = STATE.panel) {
    if (!panel) return { left: 18, top: 18 };

    const margin = 10;
    const width = panel.offsetWidth || 340;
    const height = panel.offsetHeight || 132;
    const maxLeft = Math.max(margin, window.innerWidth - width - margin);
    const maxTop = Math.max(margin, window.innerHeight - height - margin);

    return {
      left: Math.min(Math.max(margin, left), maxLeft),
      top: Math.min(Math.max(margin, top), maxTop),
    };
  }

  function savePanelPosition(position) {
    STATE.panelPosition = { left: position.left, top: position.top };
    writeStorageJson(STORAGE_KEYS.position, STATE.panelPosition);
  }

  function applyPanelPosition(forceDefault = false) {
    if (!STATE.panel) return;

    let position = !forceDefault && STATE.panelPosition
      ? STATE.panelPosition
      : getDefaultPanelPosition(STATE.panel);

    position = clampPanelPosition(position.left, position.top, STATE.panel);

    STATE.panel.style.left = `${position.left}px`;
    STATE.panel.style.top = `${position.top}px`;
    STATE.panel.style.right = 'auto';
    STATE.panel.style.bottom = 'auto';

    savePanelPosition(position);
  }

  function resetPanelPosition() {
    applyPanelPosition(true);
  }

  function onDragPointerDown(event) {
    if (event.button !== 0) return;
    if (!STATE.panel) return;

    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('button')) return;

    const rect = STATE.panel.getBoundingClientRect();
    STATE.drag.active = true;
    STATE.drag.pointerId = event.pointerId;
    STATE.drag.startX = event.clientX;
    STATE.drag.startY = event.clientY;
    STATE.drag.originLeft = rect.left;
    STATE.drag.originTop = rect.top;

    STATE.panel.classList.add('__dragging');
    document.documentElement.classList.add('__cg_nav_no_select');

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch (_) { }

    event.preventDefault();
  }

  function onDragPointerMove(event) {
    if (!STATE.drag.active || event.pointerId !== STATE.drag.pointerId || !STATE.panel) return;

    const nextLeft = STATE.drag.originLeft + (event.clientX - STATE.drag.startX);
    const nextTop = STATE.drag.originTop + (event.clientY - STATE.drag.startY);
    const position = clampPanelPosition(nextLeft, nextTop, STATE.panel);

    STATE.panel.style.left = `${position.left}px`;
    STATE.panel.style.top = `${position.top}px`;
    STATE.panel.style.right = 'auto';
    STATE.panel.style.bottom = 'auto';
  }

  function finishPanelDrag(event) {
    if (!STATE.drag.active || event.pointerId !== STATE.drag.pointerId || !STATE.panel) return;

    STATE.drag.active = false;
    STATE.panel.classList.remove('__dragging');
    document.documentElement.classList.remove('__cg_nav_no_select');

    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch (_) { }

    savePanelPosition({
      left: parseFloat(STATE.panel.style.left) || 18,
      top: parseFloat(STATE.panel.style.top) || 18,
    });
  }

  function bindPanelDrag(handle) {
    if (!handle) return;
    handle.addEventListener('pointerdown', onDragPointerDown);
    handle.addEventListener('pointermove', onDragPointerMove);
    handle.addEventListener('pointerup', finishPanelDrag);
    handle.addEventListener('pointercancel', finishPanelDrag);
    handle.addEventListener('dblclick', resetPanelPosition);
  }


  function buildPanel() {
    if (document.getElementById('__cg_nav_panel')) {
      STATE.panel = document.getElementById('__cg_nav_panel');
      refreshThemeControls();
      refreshAlarmControls();
      return;
    }

    const panel = document.createElement('div');
    panel.id = '__cg_nav_panel';

    const dragHandle = document.createElement('div');
    dragHandle.id = '__cg_nav_drag';
    dragHandle.title = 'Arrastra para mover. Doble click para restaurar la posición.';
    setSafeInnerHTML(dragHandle, getDragIconSvg());

    const prevBtn = document.createElement('button');
    prevBtn.id = '__cg_prev_btn';
    prevBtn.type = 'button';
    prevBtn.textContent = '←';
    prevBtn.title = 'Anterior';
    prevBtn.setAttribute('aria-label', 'Anterior');

    const counter = document.createElement('div');
    counter.id = '__cg_nav_counter';
    counter.textContent = '0 / 0';

    const nextBtn = document.createElement('button');
    nextBtn.id = '__cg_next_btn';
    nextBtn.type = 'button';
    nextBtn.textContent = '→';
    nextBtn.title = 'Siguiente';
    nextBtn.setAttribute('aria-label', 'Siguiente');

    const listBtn = document.createElement('button');
    listBtn.id = '__cg_list_btn';
    listBtn.type = 'button';
    listBtn.className = '__cg_nav_primary';
    listBtn.title = 'Abrir lista';
    listBtn.setAttribute('aria-label', 'Abrir lista');
    setSafeInnerHTML(listBtn, getListIconSvg());

    const themeBtn = document.createElement('button');
    themeBtn.type = 'button';
    themeBtn.dataset.role = '__cg_nav_theme_toggle';
    themeBtn.className = '__cg_nav_ghost';
    themeBtn.addEventListener('click', cycleThemeMode);

    const alarmBtn = document.createElement('button');
    alarmBtn.type = 'button';
    alarmBtn.dataset.role = '__cg_nav_alarm_toggle';
    alarmBtn.className = STATE.alarmEnabled ? '__cg_nav_primary' : '__cg_nav_ghost';
    alarmBtn.addEventListener('click', toggleAlarmEnabled);

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = '__cg_nav_ghost';
    resetBtn.title = 'Recentrar panel';
    resetBtn.setAttribute('aria-label', 'Recentrar panel');
    resetBtn.addEventListener('click', resetPanelPosition);
    setSafeInnerHTML(resetBtn, getResetIconSvg());

    prevBtn.addEventListener('click', goPrev);
    nextBtn.addEventListener('click', goNext);
    listBtn.addEventListener('click', openListModal);

    panel.appendChild(dragHandle);
    panel.appendChild(prevBtn);
    panel.appendChild(counter);
    panel.appendChild(nextBtn);
    panel.appendChild(listBtn);
    panel.appendChild(themeBtn);
    panel.appendChild(alarmBtn);
    panel.appendChild(resetBtn);

    (document.body || document.documentElement).appendChild(panel);
    STATE.panel = panel;

    bindPanelDrag(dragHandle);
    refreshThemeControls();
    refreshAlarmControls();

    requestAnimationFrame(() => {
      applyPanelPosition();
      refreshPanelState();
    });
  }


  function refreshPanelState() {
    const panel = STATE.panel;
    if (!panel) return;

    const prev = panel.querySelector('#__cg_prev_btn');
    const next = panel.querySelector('#__cg_next_btn');
    const counter = panel.querySelector('#__cg_nav_counter');

    const hasItems = STATE.items.length > 0;
    if (prev) prev.disabled = !hasItems || STATE.currentIndex <= 0;
    if (next) next.disabled = !hasItems || STATE.currentIndex >= STATE.items.length - 1;
    if (counter) counter.textContent = hasItems ? `${STATE.currentIndex + 1} / ${STATE.items.length}` : '0 / 0';
    refreshAlarmControls();
  }

  function openListModal() {
    if (STATE.listModal) {
      STATE.listModal.remove();
      STATE.listModal = null;
      return;
    }

    const overlay = document.createElement('div');
    overlay.id = '__cg_nav_modal';

    const box = document.createElement('div');
    box.id = '__cg_nav_modal_box';

    const header = document.createElement('div');
    header.id = '__cg_nav_modal_header';

    const headerLeft = document.createElement('div');
    headerLeft.id = '__cg_nav_modal_header_left';

    const title = document.createElement('strong');
    title.textContent = 'Conversación';

    headerLeft.appendChild(title);

    const headerRight = document.createElement('div');
    headerRight.id = '__cg_nav_modal_header_right';

    const themeBtn = document.createElement('button');
    themeBtn.type = 'button';
    themeBtn.dataset.role = '__cg_nav_theme_toggle';
    themeBtn.addEventListener('click', cycleThemeMode);

    const closeBtn = document.createElement('button');
    closeBtn.id = '__cg_nav_close';
    closeBtn.type = 'button';
    closeBtn.textContent = 'Cerrar';

    headerRight.appendChild(themeBtn);
    headerRight.appendChild(closeBtn);

    header.appendChild(headerLeft);
    header.appendChild(headerRight);

    const filters = document.createElement('div');
    filters.id = '__cg_nav_filters';

    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.dataset.filter = 'all';
    allBtn.textContent = 'Todos';

    const userBtn = document.createElement('button');
    userBtn.type = 'button';
    userBtn.dataset.filter = 'user';
    userBtn.textContent = 'Prompt de usuario';

    const aiBtn = document.createElement('button');
    aiBtn.type = 'button';
    aiBtn.dataset.filter = 'ai';
    aiBtn.textContent = 'Respuesta de AI';

    filters.appendChild(allBtn);
    filters.appendChild(userBtn);
    filters.appendChild(aiBtn);

    const list = document.createElement('div');
    list.id = '__cg_nav_list';

    box.appendChild(header);
    box.appendChild(filters);
    box.appendChild(list);
    overlay.appendChild(box);

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) closeListModal();
    });
    closeBtn.addEventListener('click', closeListModal);

    overlay.querySelectorAll('[data-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        STATE.filterMode = btn.dataset.filter;
        STATE.navLockUntil = 0;
        STATE.navLockIndex = -1;
        scanMessages();
        markActiveFilter();
      });
    });

    (document.body || document.documentElement).appendChild(overlay);
    STATE.listModal = overlay;
    markActiveFilter();
    renderListBody();
    refreshThemeControls();

    const escHandler = (event) => {
      if (event.key === 'Escape') {
        closeListModal();
        document.removeEventListener('keydown', escHandler, true);
      }
    };
    document.addEventListener('keydown', escHandler, true);
  }

  function closeListModal() {
    if (!STATE.listModal) return;
    STATE.listModal.remove();
    STATE.listModal = null;
  }

  function markActiveFilter() {
    if (!STATE.listModal) return;
    STATE.listModal.querySelectorAll('[data-filter]').forEach((btn) => {
      btn.classList.toggle('__active', btn.dataset.filter === STATE.filterMode);
    });
  }

  function renderListBody() {
    if (!STATE.listModal) return;

    const list = STATE.listModal.querySelector('#__cg_nav_list');
    if (!list) return;

    list.textContent = '';

    if (!STATE.items.length) {
      const empty = document.createElement('div');
      empty.className = '__cg_nav_empty';
      empty.textContent = 'No se encontraron elementos para este filtro.';
      list.appendChild(empty);
      return;
    }

    STATE.items.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = '__cg_nav_row' + (index === STATE.currentIndex ? ' __active' : '');

      const left = document.createElement('div');
      const badge = document.createElement('span');
      badge.className = '__cg_nav_badge ' + (item.type === 'user' ? '__user' : '__ai');
      badge.textContent = FILTER_LABELS[item.type];
      left.appendChild(badge);

      const right = document.createElement('div');
      right.textContent = item.preview;

      row.appendChild(left);
      row.appendChild(right);

      row.addEventListener('click', () => {
        scrollToItem(index);
        closeListModal();
      });

      list.appendChild(row);
    });
  }

  function debounce(fn, wait) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }

  const debouncedScan = debounce(scanMessages, 250);
  const debouncedViewportUpdate = debounce(() => {
    if (!STATE.items.length) {
      STATE.currentIndex = -1;
      refreshPanelState();
      renderListBody();
      return;
    }

    if (hasActiveNavLock()) {
      STATE.currentIndex = STATE.navLockIndex;
      refreshPanelState();
      renderListBody();
      return;
    }

    syncAnchorToViewport(true);
  }, 80);

  const debouncedReposition = debounce(() => {
    if (!STATE.panel) return;
    applyPanelPosition();
  }, 80);

  function isEditableTarget(target) {
    if (!(target instanceof Element)) return false;
    if (target.isContentEditable) return true;
    const tagName = target.tagName ? target.tagName.toUpperCase() : '';
    return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
  }

  function handlePotentialKeyboardScroll(event) {
    if (isEditableTarget(event.target)) return;

    const scrollKeys = new Set(['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' ']);
    if (!scrollKeys.has(event.key)) return;

    handleManualScrollIntent();
  }

  function startObservers() {
    if (STATE.observer) STATE.observer.disconnect();

    STATE.observer = new MutationObserver(() => {
      debouncedScan();
    });

    STATE.observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    window.addEventListener('scroll', debouncedViewportUpdate, { passive: true });
    document.addEventListener('scroll', debouncedViewportUpdate, true);
    document.addEventListener('wheel', handleManualScrollIntent, { passive: true, capture: true });
    document.addEventListener('touchmove', handleManualScrollIntent, { passive: true, capture: true });
    document.addEventListener('keydown', handlePotentialKeyboardScroll, true);
    window.addEventListener('resize', debouncedScan, { passive: true });
    window.addEventListener('resize', debouncedReposition, { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (STATE.alarmEnabled && !document.hidden) {
        initAlarmAudio();
      }
    });

    if (COLOR_SCHEME_QUERY) {
      const onThemeChange = () => {
        if (STATE.themeMode === 'auto') applyTheme();
      };

      if (typeof COLOR_SCHEME_QUERY.addEventListener === 'function') {
        COLOR_SCHEME_QUERY.addEventListener('change', onThemeChange);
      } else if (typeof COLOR_SCHEME_QUERY.addListener === 'function') {
        COLOR_SCHEME_QUERY.addListener(onThemeChange);
      }
    }
  }

  function init() {
    if (STATE.initialized) return;
    STATE.initialized = true;

    try {
      loadUiPreferences();
      ensureStyles();
      applyTheme();
      buildPanel();
      scanMessages();
      if (STATE.alarmEnabled) {
        setAlarmEnabled(true);
      } else {
        refreshAlarmControls();
      }
      startObservers();
    } catch (_) { }
  }

  function boot() {
    if (!document.body) {
      setTimeout(boot, 100);
      return;
    }
    init();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
// ==UserScript==
// @name         ReplyRadar
// @namespace    https://github.com/marcomarca/ReplyRadar
// @version      1.7.0
// @description  Navegador flotante de conversaciones con alarma activable, repetición configurable de 0 a 5 minutos, autoenvío seguro y control de volumen para ChatGPT y Gemini.
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
    alarmVolume: '__cg_nav_alarm_volume_v1',
    alarmTone: '__cg_nav_alarm_tone_v1',
    continuousAlarmInterval: '__cg_nav_alarm_continuous_interval_v1',
    continuousAlarmPending: '__cg_nav_alarm_continuous_pending_v1',
    continuousAlarmMessage: '__cg_nav_alarm_continuous_message_v1',
  };

  const LEGACY_ALARM_MODE_STORAGE_KEY = '__cg_nav_alarm_mode_v1';
  const CONTINUOUS_ALARM_INTERVAL_DEFAULT_MIN = 0;
  const CONTINUOUS_ALARM_INTERVAL_MIN = 0;
  const CONTINUOUS_ALARM_INTERVAL_MAX = 5;

  const ALARM_COOLDOWN_MS = 13500;
  const ALARM_CHIME_REPEAT_COUNT = 2;
  const ALARM_CHIME_REPEAT_INTERVAL_SEC = 2.75;
  const ALARM_VOLUME_DEFAULT = 0.72;
  const ALARM_VOLUME_MIN = 0;

  const ALARM_VOLUME_MAX = 1.35;
  const ALARM_TONE_DEFAULT_ID = 'apple-inspired-chime';
  const ALARM_TONES = [
    {
      id: 'apple-inspired-chime',
      name: 'Apple Inspired Chime',
      shortName: 'Apple',
      label: 'Actual · campana amplia',
      kind: 'apple',
    },
    {
      id: 'soft-digital-ping',
      name: 'Soft Digital Ping',
      shortName: 'Soft Ping',
      label: 'Moderna · limpia',
      waveform: 'sine',
      attack: 0.012,
      hold: 0.025,
      highpass: 180,
      lowpass: 5600,
      reverb: 0.10,
      reverbDuration: 1.00,
      reverbDecay: 3.4,
      delay: 0.035,
      delayFeedback: 0.10,
      delayGain: 0.11,
      partialGain: 0.18,
      notes: [
        { t: 0.00, f: 660.00, g: 0.080, d: 0.48 },
        { t: 0.18, f: 880.00, g: 0.065, d: 0.58 },
      ],
    },
    {
      id: 'glass-tap',
      name: 'Glass Tap',
      shortName: 'Glass Tap',
      label: 'Premium · brillante',
      waveform: 'sine',
      attack: 0.006,
      hold: 0.018,
      highpass: 420,
      lowpass: 7800,
      reverb: 0.18,
      reverbDuration: 1.25,
      reverbDecay: 3.6,
      delay: 0.060,
      delayFeedback: 0.10,
      delayGain: 0.13,
      partialGain: 0.14,
      notes: [
        { t: 0.00, f: 1046.50, g: 0.055, d: 0.48 },
        { t: 0.11, f: 1318.51, g: 0.046, d: 0.42 },
        { t: 0.23, f: 1567.98, g: 0.036, d: 0.38 },
      ],
    },
    {
      id: 'warm-marimba',
      name: 'Warm Marimba',
      shortName: 'Marimba',
      label: 'Cómoda · orgánica',
      waveform: 'triangle',
      attack: 0.008,
      hold: 0.018,
      highpass: 120,
      lowpass: 4200,
      reverb: 0.08,
      reverbDuration: 0.90,
      reverbDecay: 3.8,
      delay: 0.020,
      delayFeedback: 0.08,
      delayGain: 0.08,
      partialGain: 0.08,
      notes: [
        { t: 0.00, f: 523.25, g: 0.090, d: 0.30 },
        { t: 0.15, f: 659.25, g: 0.076, d: 0.28 },
        { t: 0.30, f: 783.99, g: 0.060, d: 0.26 },
      ],
    },
    {
      id: 'minimal-pop',
      name: 'Minimal Pop',
      shortName: 'Minimal',
      label: 'Simple · rápida',
      waveform: 'triangle',
      attack: 0.004,
      hold: 0.010,
      highpass: 160,
      lowpass: 4800,
      reverb: 0.03,
      reverbDuration: 0.70,
      reverbDecay: 4.0,
      delay: 0.000,
      partialGain: 0.05,
      notes: [
        { t: 0.00, f: 440.00, g: 0.070, d: 0.16 },
        { t: 0.09, f: 880.00, g: 0.052, d: 0.24 },
      ],
    },
    {
      id: 'calm-bell',
      name: 'Calm Bell',
      shortName: 'Calm Bell',
      label: 'Tranquila · clara',
      waveform: 'sine',
      attack: 0.018,
      hold: 0.030,
      highpass: 140,
      lowpass: 5000,
      reverb: 0.22,
      reverbDuration: 1.50,
      reverbDecay: 3.2,
      delay: 0.080,
      delayFeedback: 0.12,
      delayGain: 0.14,
      partialGain: 0.18,
      notes: [
        { t: 0.00, f: 587.33, g: 0.070, d: 0.95 },
        { t: 0.22, f: 739.99, g: 0.050, d: 1.05 },
      ],
    },
    {
      id: 'lofi-pluck',
      name: 'Lo-fi Pluck',
      shortName: 'Lo-fi',
      label: 'Cool · apagada',
      waveform: 'triangle',
      attack: 0.010,
      hold: 0.015,
      highpass: 90,
      lowpass: 2800,
      reverb: 0.12,
      reverbDuration: 1.10,
      reverbDecay: 3.9,
      delay: 0.090,
      delayFeedback: 0.15,
      delayGain: 0.13,
      partialGain: 0.06,
      notes: [
        { t: 0.00, f: 392.00, g: 0.088, d: 0.34 },
        { t: 0.20, f: 493.88, g: 0.066, d: 0.40 },
        { t: 0.38, f: 587.33, g: 0.052, d: 0.46 },
      ],
    },
    {
      id: 'futuristic-sweep',
      name: 'Futuristic Sweep',
      shortName: 'Sweep',
      label: 'Tech · ascendente',
      waveform: 'sine',
      attack: 0.020,
      hold: 0.030,
      highpass: 220,
      lowpass: 6500,
      reverb: 0.12,
      reverbDuration: 1.00,
      reverbDecay: 3.5,
      delay: 0.045,
      delayFeedback: 0.11,
      delayGain: 0.12,
      partialGain: 0.00,
      notes: [
        { t: 0.00, f: 420.00, f2: 880.00, g: 0.050, d: 0.46, partial: false },
        { t: 0.18, f: 720.00, f2: 1320.00, g: 0.038, d: 0.42, partial: false },
      ],
    },
    {
      id: 'two-tone-notify',
      name: 'Two-tone Notify',
      shortName: 'Two-tone',
      label: 'Clásica · mínima',
      waveform: 'sine',
      attack: 0.010,
      hold: 0.020,
      highpass: 130,
      lowpass: 5000,
      reverb: 0.06,
      reverbDuration: 0.85,
      reverbDecay: 3.6,
      delay: 0.018,
      delayFeedback: 0.08,
      delayGain: 0.08,
      partialGain: 0.14,
      notes: [
        { t: 0.00, f: 554.37, g: 0.075, d: 0.34 },
        { t: 0.18, f: 830.61, g: 0.060, d: 0.42 },
      ],
    },
    {
      id: 'soft-success-chime',
      name: 'Soft Success Chime',
      shortName: 'Success',
      label: 'Positiva · limpia',
      waveform: 'sine',
      attack: 0.014,
      hold: 0.025,
      highpass: 160,
      lowpass: 5600,
      reverb: 0.16,
      reverbDuration: 1.20,
      reverbDecay: 3.4,
      delay: 0.055,
      delayFeedback: 0.10,
      delayGain: 0.12,
      partialGain: 0.16,
      notes: [
        { t: 0.00, f: 523.25, g: 0.060, d: 0.60 },
        { t: 0.10, f: 659.25, g: 0.052, d: 0.65 },
        { t: 0.20, f: 783.99, g: 0.046, d: 0.72 },
        { t: 0.34, f: 1046.50, g: 0.032, d: 0.78 },
      ],
    },
    {
      id: 'low-velvet-bell',
      name: 'Low Velvet Bell',
      shortName: 'Velvet',
      label: 'Grave · cómoda',
      waveform: 'sine',
      attack: 0.020,
      hold: 0.035,
      highpass: 80,
      lowpass: 3600,
      reverb: 0.24,
      reverbDuration: 1.60,
      reverbDecay: 3.1,
      delay: 0.070,
      delayFeedback: 0.11,
      delayGain: 0.13,
      partialGain: 0.14,
      notes: [
        { t: 0.00, f: 329.63, g: 0.080, d: 1.00 },
        { t: 0.24, f: 415.30, g: 0.055, d: 1.05 },
        { t: 0.48, f: 493.88, g: 0.038, d: 1.00 },
      ],
    },
  ];
  const CHATGPT_LAT_COMPLETION_URL = 'https://chatgpt.com/backend-api/lat/r';
  const CHATGPT_NETWORK_HOOK_RETRY_MS = 2000;

  const GEMINI_NETWORK_TARGET_ENDPOINT = 'batchexecute';
  const GEMINI_NETWORK_BURST_THRESHOLD = 3;
  const GEMINI_NETWORK_PULSE_TIMEOUT_MS = 3500;
  const GEMINI_NETWORK_MONITOR_INTERVAL_MS = 1000;

  const AUTO_SEND_CHECK_EVERY_MS = 400;
  const AUTO_SEND_DEBOUNCE_MS = 90;
  const AUTO_SEND_RE = /(^|\b)(send|submit|enviar|env[ií]a|envoyer|senden|invia)(\b|$)/i;
  const AUTO_SEND_PENDING_RE = /(file\s*upload\s*pending|upload\s*pending|subida\s+de\s+archivo\s+pendiente|archivo\s+pendiente|carga\s+de\s+archivo\s+pendiente|subiendo\s+archivo|uploading\s+file|processing\s+file|procesando\s+archivo)/i;
  const AUTO_SEND_STOP_RE = /(^|\b)(stop|detener|cancelar|interrumpir|parar|stop\s+streaming)(\b|$)/i;
  const AUTO_SEND_FILE_EXT_RE = /\.(?:user\.js|js|txt|md|pdf|docx|doc|xlsx|xls|pptx|ppt|csv|json|zip|rar|7z|png|jpe?g|webp|gif|svg|html|css|py|ipynb|xml|yaml|yml)(?:\b|$|[?#])/i;
  const AUTO_SEND_DOWNLOAD_HINT_RE = /(download|sandbox|files|file|attachment|backend-api|blob:|usercontent)/i;


  const THEME_ORDER = ['auto', 'dark', 'light'];
  const COLOR_SCHEME_QUERY = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  const STATE = {
    filterMode: 'all', // all | user | ai
    items: [],
    currentIndex: -1,
    observer: null,
    panel: null,
    listModal: null,
    optionsMenu: null,
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
    alarmVolume: ALARM_VOLUME_DEFAULT,
    alarmToneId: ALARM_TONE_DEFAULT_ID,
    alarmAudioCtx: null,
    alarmKeepAliveAudio: null,
    lastAlarmAt: 0,
    continuousAlarmIntervalMin: CONTINUOUS_ALARM_INTERVAL_DEFAULT_MIN,
    continuousAlarmTimer: null,
    continuousAlarmPending: false,
    continuousAlarmMessage: '',
    autoSendArmed: false,
    autoSendSent: false,
    autoSendObserver: null,
    autoSendPollTimer: null,
    autoSendDebounceTimer: null,
    autoSendLastStatus: 'Auto enviar al estar listo.',
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

    const storedContinuousAlarmIntervalRaw = localStorage.getItem(STORAGE_KEYS.continuousAlarmInterval);
    if (storedContinuousAlarmIntervalRaw !== null) {
      STATE.continuousAlarmIntervalMin = clampContinuousAlarmInterval(
        Number(storedContinuousAlarmIntervalRaw),
      );
    }

    // Migración única desde 1.6.0: el antiguo tercer estado "Continua" pasa al deslizador.
    // Si antes era Activada/Desactivada, se normaliza a 0 = sin repetir.
    const legacyAlarmMode = localStorage.getItem(LEGACY_ALARM_MODE_STORAGE_KEY);
    if (legacyAlarmMode === 'continuous') {
      STATE.alarmEnabled = true;
      if (STATE.continuousAlarmIntervalMin <= 0) {
        STATE.continuousAlarmIntervalMin = 1;
      }
    } else if (legacyAlarmMode === 'once' || legacyAlarmMode === 'off') {
      STATE.alarmEnabled = legacyAlarmMode === 'once';
      STATE.continuousAlarmIntervalMin = 0;
    }

    try {
      localStorage.setItem(STORAGE_KEYS.alarmEnabled, STATE.alarmEnabled ? '1' : '0');
      localStorage.setItem(
        STORAGE_KEYS.continuousAlarmInterval,
        String(STATE.continuousAlarmIntervalMin),
      );
      if (legacyAlarmMode !== null) localStorage.removeItem(LEGACY_ALARM_MODE_STORAGE_KEY);
    } catch (_) { }

    try {
      STATE.continuousAlarmPending =
        STATE.alarmEnabled
        && STATE.continuousAlarmIntervalMin > 0
        && sessionStorage.getItem(STORAGE_KEYS.continuousAlarmPending) === '1';
      STATE.continuousAlarmMessage = STATE.continuousAlarmPending
        ? (sessionStorage.getItem(STORAGE_KEYS.continuousAlarmMessage) || '')
        : '';
    } catch (_) {
      STATE.continuousAlarmPending = false;
      STATE.continuousAlarmMessage = '';
    }

    const storedAlarmVolume = Number(localStorage.getItem(STORAGE_KEYS.alarmVolume));
    if (Number.isFinite(storedAlarmVolume)) {
      STATE.alarmVolume = clampAlarmVolume(storedAlarmVolume);
    }

    const storedAlarmTone = localStorage.getItem(STORAGE_KEYS.alarmTone);
    if (getAlarmToneById(storedAlarmTone)) {
      STATE.alarmToneId = storedAlarmTone;
    }
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


  function getAlarmToneIconSvg() {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M9 18V6l10-2v12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"></path>
        <circle cx="6.5" cy="18" r="2.5" fill="currentColor"></circle>
        <circle cx="16.5" cy="16" r="2.5" fill="currentColor"></circle>
      </svg>
    `;
  }

  function getAlarmToneById(id) {
    return ALARM_TONES.find((tone) => tone.id === id) || null;
  }

  function getSelectedAlarmTone() {
    return getAlarmToneById(STATE.alarmToneId) || getAlarmToneById(ALARM_TONE_DEFAULT_ID) || ALARM_TONES[0];
  }

  function setAlarmTone(id) {
    const tone = getAlarmToneById(id);
    if (!tone) return;

    STATE.alarmToneId = tone.id;

    try {
      localStorage.setItem(STORAGE_KEYS.alarmTone, tone.id);
    } catch (_) { }

    refreshAlarmToneControls();
  }

  function getAlarmToneOptionHtml(tone, active) {
    return `
      <span class="__cg_nav_tone_check">${active ? '✓' : ''}</span>
      <span class="__cg_nav_tone_text">
        <span class="__cg_nav_tone_name">${tone.name}</span>
        <span class="__cg_nav_tone_hint">${tone.label}</span>
      </span>
    `;
  }

  function refreshAlarmToneControls() {
    const selectedTone = getSelectedAlarmTone();
    if (!selectedTone) return;

    const toggles = document.querySelectorAll('[data-role="__cg_nav_alarm_tone_toggle"]');
    toggles.forEach((button) => {
      setSafeInnerHTML(button, `
        <span class="__cg_nav_menu_label">
          ${getAlarmToneIconSvg()}
          <span>Tono</span>
        </span>
        <span class="__cg_nav_menu_value">${selectedTone.shortName || selectedTone.name}</span>
      `);
      button.setAttribute('aria-label', `Tono de alarma: ${selectedTone.name}`);
      button.title = `Tono de alarma: ${selectedTone.name}. Click para elegir.`;
    });

    const options = document.querySelectorAll('[data-role="__cg_nav_alarm_tone_option"]');
    options.forEach((button) => {
      const tone = getAlarmToneById(button.dataset.toneId);
      if (!tone) return;

      const active = tone.id === selectedTone.id;
      button.classList.toggle('__cg_nav_active_tone', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      button.setAttribute('aria-label', `Seleccionar tono ${tone.name}`);
      setSafeInnerHTML(button, getAlarmToneOptionHtml(tone, active));
    });

    const previewButtons = document.querySelectorAll('[data-role="__cg_nav_alarm_tone_preview"]');
    previewButtons.forEach((button) => {
      button.textContent = `Probar ${selectedTone.shortName || selectedTone.name}`;
      button.title = `Probar tono: ${selectedTone.name}`;
    });
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
      const isMenuControl = button.dataset.display === '__cg_nav_menu';
      if (isMenuControl) {
        setSafeInnerHTML(button, `
          <span class="__cg_nav_menu_label">
            ${getThemeIconSvg(STATE.themeMode)}
            <span>Tema</span>
          </span>
          <span class="__cg_nav_menu_value">${STATE.themeMode}</span>
        `);
      } else {
        setSafeInnerHTML(button, getThemeIconSvg(STATE.themeMode));
      }
      button.setAttribute('aria-label', `Tema: ${STATE.themeMode}`);
      button.setAttribute('data-theme-mode', STATE.themeMode);
      button.title = `Tema: ${STATE.themeMode}. Click para alternar.`;
    });
  }

  function refreshAlarmControls() {
    const alarmLabel = STATE.alarmEnabled ? 'Activada' : 'Desactivada';
    const controls = document.querySelectorAll('[data-role="__cg_nav_alarm_toggle"]');

    controls.forEach((button) => {
      const isMenuControl = button.dataset.display === '__cg_nav_menu';
      if (isMenuControl) {
        setSafeInnerHTML(button, `
          <span class="__cg_nav_menu_label">
            ${getAlarmIconSvg(STATE.alarmEnabled)}
            <span>Alarma</span>
          </span>
          <span class="__cg_nav_menu_value">${alarmLabel}</span>
        `);
      } else {
        setSafeInnerHTML(button, getAlarmIconSvg(STATE.alarmEnabled));
      }

      button.classList.toggle('__cg_nav_primary', STATE.alarmEnabled);
      button.classList.toggle('__cg_nav_ghost', !STATE.alarmEnabled);
      button.setAttribute('aria-pressed', STATE.alarmEnabled ? 'true' : 'false');
      button.setAttribute('aria-label', `Alarma ${alarmLabel.toLowerCase()}`);
      button.title = STATE.alarmEnabled ? 'Alarma activada' : 'Alarma desactivada';
    });

    refreshContinuousAlarmIntervalControls();
    refreshAlarmVolumeControls();
    refreshAlarmToneControls();
  }

  function clampAlarmVolume(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return ALARM_VOLUME_DEFAULT;
    return Math.min(ALARM_VOLUME_MAX, Math.max(ALARM_VOLUME_MIN, numeric));
  }

  function getAlarmVolumePercent() {
    return Math.round((STATE.alarmVolume / ALARM_VOLUME_MAX) * 100);
  }

  function refreshAlarmVolumeControls() {
    const percent = getAlarmVolumePercent();
    const controls = document.querySelectorAll('[data-role="__cg_nav_alarm_volume"]');
    controls.forEach((input) => {
      const value = Math.round(STATE.alarmVolume * 100);
      input.value = String(value);
      input.title = `Volumen: ${percent}%`;
      input.setAttribute('aria-label', `Volumen de alarma: ${percent}%`);
    });

    const valueLabels = document.querySelectorAll('[data-role="__cg_nav_alarm_volume_value"]');
    valueLabels.forEach((label) => {
      label.textContent = `${percent}%`;
    });
  }

  function setAlarmVolume(value) {
    STATE.alarmVolume = clampAlarmVolume(value);

    try {
      localStorage.setItem(STORAGE_KEYS.alarmVolume, String(STATE.alarmVolume));
    } catch (_) { }

    refreshAlarmVolumeControls();
  }

  function clampContinuousAlarmInterval(value) {
    const numeric = Math.round(Number(value));
    if (!Number.isFinite(numeric)) return CONTINUOUS_ALARM_INTERVAL_DEFAULT_MIN;
    return Math.min(CONTINUOUS_ALARM_INTERVAL_MAX, Math.max(CONTINUOUS_ALARM_INTERVAL_MIN, numeric));
  }

  function getContinuousAlarmIntervalLabel() {
    const minutes = STATE.continuousAlarmIntervalMin;
    return minutes === 0 ? 'Sin repetir' : `${minutes} min`;
  }

  function refreshContinuousAlarmIntervalControls() {
    const label = getContinuousAlarmIntervalLabel();
    const controls = document.querySelectorAll('[data-role="__cg_nav_continuous_interval"]');
    controls.forEach((input) => {
      input.value = String(STATE.continuousAlarmIntervalMin);
      input.title = STATE.continuousAlarmIntervalMin === 0
        ? 'Sin repetir: un único aviso por tarea completada.'
        : `Repetir cada ${STATE.continuousAlarmIntervalMin} minuto${STATE.continuousAlarmIntervalMin === 1 ? '' : 's'} hasta visitar esta pestaña.`;
      input.setAttribute('aria-label', `Repetición de alarma: ${label}`);
    });

    const valueLabels = document.querySelectorAll('[data-role="__cg_nav_continuous_interval_value"]');
    valueLabels.forEach((valueLabel) => {
      valueLabel.textContent = label;
    });
  }

  function setContinuousAlarmInterval(value) {
    const previousInterval = STATE.continuousAlarmIntervalMin;
    STATE.continuousAlarmIntervalMin = clampContinuousAlarmInterval(value);

    try {
      localStorage.setItem(
        STORAGE_KEYS.continuousAlarmInterval,
        String(STATE.continuousAlarmIntervalMin),
      );
    } catch (_) { }

    refreshContinuousAlarmIntervalControls();

    if (STATE.continuousAlarmIntervalMin === 0) {
      // 0 significa literalmente "sin repetir": cancela cualquier ciclo pendiente.
      stopContinuousAlarm(true);
      return;
    }

    if (
      STATE.alarmEnabled
      && STATE.continuousAlarmPending
      && STATE.continuousAlarmIntervalMin !== previousInterval
    ) {
      scheduleContinuousAlarmRepeat();
    }
  }

  function persistContinuousAlarmState() {
    try {
      sessionStorage.setItem(
        STORAGE_KEYS.continuousAlarmPending,
        STATE.continuousAlarmPending ? '1' : '0',
      );

      if (STATE.continuousAlarmMessage) {
        sessionStorage.setItem(STORAGE_KEYS.continuousAlarmMessage, STATE.continuousAlarmMessage);
      } else {
        sessionStorage.removeItem(STORAGE_KEYS.continuousAlarmMessage);
      }
    } catch (_) { }
  }

  function clearContinuousAlarmTimer() {
    if (!STATE.continuousAlarmTimer) return;
    window.clearTimeout(STATE.continuousAlarmTimer);
    STATE.continuousAlarmTimer = null;
  }

  function stopContinuousAlarm(clearPending = true) {
    clearContinuousAlarmTimer();

    if (clearPending) {
      STATE.continuousAlarmPending = false;
      STATE.continuousAlarmMessage = '';
      persistContinuousAlarmState();
    }
  }

  function isTabInForeground() {
    return !document.hidden && document.hasFocus();
  }

  function acknowledgeContinuousAlarmIfForeground() {
    if (!STATE.continuousAlarmPending) return false;
    if (!isTabInForeground()) return false;

    stopContinuousAlarm(true);
    return true;
  }

  function scheduleContinuousAlarmRepeat() {
    clearContinuousAlarmTimer();

    if (
      !STATE.alarmEnabled
      || STATE.continuousAlarmIntervalMin <= 0
      || !STATE.continuousAlarmPending
    ) return;

    const delayMs = STATE.continuousAlarmIntervalMin * 60 * 1000;
    STATE.continuousAlarmTimer = window.setTimeout(() => {
      STATE.continuousAlarmTimer = null;

      if (acknowledgeContinuousAlarmIfForeground()) return;
      if (
        !STATE.alarmEnabled
        || STATE.continuousAlarmIntervalMin <= 0
        || !STATE.continuousAlarmPending
      ) return;

      triggerAlarm(STATE.continuousAlarmMessage || 'Hay una tarea completada pendiente de revisar.');
      scheduleContinuousAlarmRepeat();
    }, delayMs);
  }

  function armContinuousAlarm(message) {
    if (!STATE.alarmEnabled || STATE.continuousAlarmIntervalMin <= 0) return false;

    // Si la tarea termina mientras el usuario ya mira esta pestaña, no se crea un ciclo pendiente.
    if (isTabInForeground()) {
      stopContinuousAlarm(true);
      return false;
    }

    STATE.continuousAlarmPending = true;
    STATE.continuousAlarmMessage = message || 'Hay una tarea completada pendiente de revisar.';
    persistContinuousAlarmState();

    const delivered = triggerAlarm(STATE.continuousAlarmMessage);
    scheduleContinuousAlarmRepeat();
    return delivered;
  }

  function handleCompletedTaskAlarm(message) {
    if (!STATE.alarmEnabled) return false;

    // El deslizador define el comportamiento: 0 = un aviso; 1..5 = repetir.
    if (STATE.continuousAlarmIntervalMin > 0) {
      return armContinuousAlarm(message);
    }

    return triggerAlarm(message);
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

      if (STATE.continuousAlarmIntervalMin > 0 && STATE.continuousAlarmPending) {
        if (!acknowledgeContinuousAlarmIfForeground()) {
          scheduleContinuousAlarmRepeat();
        }
      }
    } else {
      stopContinuousAlarm(true);
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
    master.gain.setValueAtTime(STATE.alarmVolume, ctx.currentTime);

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


  function makeConfiguredAlarmOutputChain(ctx, tone) {
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    const master = ctx.createGain();
    const highpass = ctx.createBiquadFilter();
    const lowpass = ctx.createBiquadFilter();
    const compressor = ctx.createDynamicsCompressor();
    const nodes = [dry, wet, master, highpass, lowpass, compressor];

    dry.gain.setValueAtTime(Number.isFinite(tone.dry) ? tone.dry : 0.86, ctx.currentTime);
    wet.gain.setValueAtTime(Number.isFinite(tone.reverb) ? tone.reverb : 0.10, ctx.currentTime);
    master.gain.setValueAtTime(STATE.alarmVolume, ctx.currentTime);

    highpass.type = 'highpass';
    highpass.frequency.setValueAtTime(tone.highpass || 120, ctx.currentTime);
    highpass.Q.setValueAtTime(0.72, ctx.currentTime);

    lowpass.type = 'lowpass';
    lowpass.frequency.setValueAtTime(tone.lowpass || 5600, ctx.currentTime);
    lowpass.Q.setValueAtTime(0.52, ctx.currentTime);

    compressor.threshold.setValueAtTime(-22, ctx.currentTime);
    compressor.knee.setValueAtTime(18, ctx.currentTime);
    compressor.ratio.setValueAtTime(3.0, ctx.currentTime);
    compressor.attack.setValueAtTime(0.006, ctx.currentTime);
    compressor.release.setValueAtTime(0.20, ctx.currentTime);

    dry.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(compressor);
    compressor.connect(master);

    if ((tone.delay || 0) > 0) {
      const delay = ctx.createDelay(1.0);
      const delayFeedback = ctx.createGain();
      const delayGain = ctx.createGain();

      delay.delayTime.setValueAtTime(tone.delay, ctx.currentTime);
      delayFeedback.gain.setValueAtTime(Number.isFinite(tone.delayFeedback) ? tone.delayFeedback : 0.10, ctx.currentTime);
      delayGain.gain.setValueAtTime(Number.isFinite(tone.delayGain) ? tone.delayGain : 0.12, ctx.currentTime);

      compressor.connect(delay);
      delay.connect(delayFeedback);
      delayFeedback.connect(delay);
      delay.connect(delayGain);
      delayGain.connect(master);
      nodes.push(delay, delayFeedback, delayGain);
    }

    if ((tone.reverb || 0) > 0) {
      const convolver = ctx.createConvolver();
      convolver.buffer = createAlarmImpulseResponse(
        ctx,
        tone.reverbDuration || 1.05,
        tone.reverbDecay || 3.4,
      );
      compressor.connect(convolver);
      convolver.connect(wet);
      wet.connect(master);
      nodes.push(convolver);
    }

    master.connect(ctx.destination);

    dry.__cgNavDisconnect = () => {
      nodes.forEach((node) => {
        try { node.disconnect(); } catch (_) { }
      });
    };

    return dry;
  }

  function scheduleConfiguredAlarmNote(ctx, output, tone, note, baseAt, gainScale, scheduledNodes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const startAt = baseAt + (note.t || 0);
    const duration = Number.isFinite(note.d) ? note.d : 0.45;
    const attack = Number.isFinite(tone.attack) ? tone.attack : 0.016;
    const hold = Number.isFinite(tone.hold) ? tone.hold : 0.025;
    const frequency = note.f || 660;
    const peak = (Number.isFinite(note.g) ? note.g : 0.05) * gainScale;

    osc.type = note.type || tone.waveform || 'sine';
    osc.frequency.setValueAtTime(frequency, startAt);

    if (note.f2 && note.f2 > 0) {
      osc.frequency.exponentialRampToValueAtTime(note.f2, startAt + Math.max(0.02, duration));
    }

    if (osc.detune && Number.isFinite(note.detune)) {
      osc.detune.setValueAtTime(note.detune, startAt);
    }

    scheduleGainEnvelope(gain.gain, startAt, peak, attack, hold, duration);

    osc.connect(gain);
    if (panner) {
      const pan = Number.isFinite(note.pan)
        ? note.pan
        : Math.max(-0.28, Math.min(0.28, Math.sin(frequency * 0.017) * 0.18));
      panner.pan.setValueAtTime(pan, startAt);
      gain.connect(panner);
      panner.connect(output);
      scheduledNodes.push(panner);
    } else {
      gain.connect(output);
    }

    osc.start(startAt);
    osc.stop(startAt + attack + hold + duration + 0.12);
    scheduledNodes.push(osc, gain);

    const partialGain = Number.isFinite(tone.partialGain) ? tone.partialGain : 0.14;
    if (note.partial !== false && partialGain > 0 && !note.f2 && frequency < 1500) {
      const partialOsc = ctx.createOscillator();
      const partialGainNode = ctx.createGain();
      const partialStartAt = startAt + 0.006;
      const partialDuration = Math.max(0.12, duration * 0.58);

      partialOsc.type = 'sine';
      partialOsc.frequency.setValueAtTime(frequency * 2.01, partialStartAt);
      scheduleGainEnvelope(
        partialGainNode.gain,
        partialStartAt,
        peak * partialGain,
        attack,
        hold,
        partialDuration,
      );

      partialOsc.connect(partialGainNode);
      partialGainNode.connect(output);
      partialOsc.start(partialStartAt);
      partialOsc.stop(partialStartAt + attack + hold + partialDuration + 0.12);
      scheduledNodes.push(partialOsc, partialGainNode);
    }
  }

  function playConfiguredAlarmTone(tone) {
    initAlarmAudio();
    const ctx = STATE.alarmAudioCtx;
    if (!ctx || !tone || !Array.isArray(tone.notes)) return false;

    const startAt = ctx.currentTime + 0.018;
    const output = makeConfiguredAlarmOutputChain(ctx, tone);
    const scheduledNodes = [];
    const motifDuration = Math.max(...tone.notes.map((note) => (note.t || 0) + (note.d || 0.45)));

    const scheduleToneOnce = (baseAt, gainScale = 1) => {
      tone.notes.forEach((note) => {
        scheduleConfiguredAlarmNote(ctx, output, tone, note, baseAt, gainScale, scheduledNodes);
      });
    };

    for (let i = 0; i < ALARM_CHIME_REPEAT_COUNT; i += 1) {
      const baseAt = startAt + (i * ALARM_CHIME_REPEAT_INTERVAL_SEC);
      const gainScale = Math.max(0.72, 1 - (i * 0.06));
      scheduleToneOnce(baseAt, gainScale);
    }

    const tailSeconds = Math.max(1.2, (tone.reverbDuration || 0.9) + 0.9, (tone.delay || 0) + 0.9);
    const totalMs = Math.ceil(((ALARM_CHIME_REPEAT_COUNT - 1) * ALARM_CHIME_REPEAT_INTERVAL_SEC + motifDuration + tailSeconds) * 1000);
    window.setTimeout(() => {
      scheduledNodes.forEach((node) => {
        try { node.disconnect(); } catch (_) { }
      });

      try {
        if (output && typeof output.__cgNavDisconnect === 'function') output.__cgNavDisconnect();
      } catch (_) { }
    }, totalMs);

    return true;
  }

  function playSelectedAlarmTone() {
    const tone = getSelectedAlarmTone();
    if (!tone) return false;

    if (tone.kind === 'apple') {
      return playAppleInspiredChime();
    }

    return playConfiguredAlarmTone(tone);
  }

  function playAppleInspiredChime() {
    initAlarmAudio();
    const ctx = STATE.alarmAudioCtx;
    if (!ctx) return false;

    const startAt = ctx.currentTime + 0.018;
    const output = makeAlarmOutputChain(ctx);

    // Campana sintética: Dmaj9 ascendente, ataque limpio y cola amplia.
    // El mismo motivo se repite según ALARM_CHIME_REPEAT_COUNT para que no sea fácil de ignorar.
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

      playSelectedAlarmTone();

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
    return handleCompletedTaskAlarm('ChatGPT terminó de responder.');
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
    if (PLATFORM !== 'gemini' || !STATE.alarmEnabled) return false;
    return handleCompletedTaskAlarm('Gemini terminó de responder.');
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
        --cg-nav-auto-send-active: #ff8a00;
        --cg-nav-auto-send-active-soft: rgba(255,138,0,.24);
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
        --cg-nav-auto-send-active: #d97706;
        --cg-nav-auto-send-active-soft: rgba(217,119,6,.18);
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
      #__cg_nav_panel button.__cg_nav_auto_send_active {
        background: var(--cg-nav-auto-send-active-soft);
        border-color: var(--cg-nav-auto-send-active);
        box-shadow: 0 0 0 1px color-mix(in srgb, var(--cg-nav-auto-send-active) 45%, transparent);
      }
      #__cg_nav_panel button.__cg_nav_auto_send_active svg {
        color: var(--cg-nav-auto-send-active);
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
      #__cg_nav_options_menu {
        all: initial;
        position: absolute;
        right: 0;
        bottom: calc(100% + 8px);
        width: 226px;
        display: grid;
        gap: 6px;
        padding: 8px;
        border: 1px solid var(--cg-nav-border);
        border-radius: 14px;
        background: var(--cg-nav-bg);
        color: var(--cg-nav-text);
        backdrop-filter: blur(12px);
        box-shadow: var(--cg-nav-shadow);
        font: 13px/1.2 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        box-sizing: border-box;
        user-select: none;
      }
      #__cg_nav_options_menu,
      #__cg_nav_options_menu * {
        box-sizing: border-box;
      }
      #__cg_nav_options_menu button,
      #__cg_nav_options_menu .__cg_nav_menu_volume {
        width: 100%;
        min-height: 34px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 7px 9px;
        border: 1px solid var(--cg-nav-border);
        border-radius: 10px;
        background: var(--cg-nav-surface);
        color: var(--cg-nav-text);
        font: inherit;
      }
      #__cg_nav_options_menu button {
        cursor: pointer;
      }
      #__cg_nav_options_menu button:hover {
        background: var(--cg-nav-surface-2);
      }
      #__cg_nav_options_menu button.__cg_nav_primary {
        background: var(--cg-nav-primary-soft);
        border-color: rgba(64,92,245,.34);
      }
      .__cg_nav_menu_label {
        min-width: 0;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        color: var(--cg-nav-text);
      }
      .__cg_nav_menu_label svg {
        width: 17px;
        height: 17px;
        display: block;
        flex: 0 0 auto;
      }
      .__cg_nav_menu_value {
        color: var(--cg-nav-text-soft);
        font-size: 12px;
        white-space: nowrap;
      }
      .__cg_nav_menu_volume input {
        width: 94px;
        margin: 0;
        accent-color: var(--cg-nav-primary);
        cursor: pointer;
      }
      .__cg_nav_tone_picker {
        display: grid;
        gap: 6px;
        max-height: 286px;
        overflow: auto;
        padding: 6px;
        border: 1px solid var(--cg-nav-border);
        border-radius: 12px;
        background: var(--cg-nav-surface);
      }
      .__cg_nav_tone_picker[hidden] {
        display: none;
      }
      #__cg_nav_options_menu button.__cg_nav_tone_option {
        min-height: 42px;
        justify-content: flex-start;
        gap: 8px;
        text-align: left;
      }
      #__cg_nav_options_menu button.__cg_nav_tone_option.__cg_nav_active_tone {
        background: var(--cg-nav-primary-soft);
        border-color: rgba(64,92,245,.34);
      }
      .__cg_nav_tone_check {
        width: 14px;
        min-width: 14px;
        color: var(--cg-nav-primary);
        font-weight: 700;
        text-align: center;
      }
      .__cg_nav_tone_text {
        min-width: 0;
        display: grid;
        gap: 2px;
      }
      .__cg_nav_tone_name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--cg-nav-text);
      }
      .__cg_nav_tone_hint {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--cg-nav-text-soft);
        font-size: 11px;
      }
      #__cg_nav_options_menu button.__cg_nav_tone_preview {
        justify-content: center;
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
        #__cg_nav_options_menu {
          width: 218px;
        }
        .__cg_nav_menu_volume input {
          width: 84px;
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
  }


  function autoSendNormalizeText(text) {
    return String(text || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function autoSendIsVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    if (el.closest('#__cg_nav_panel')) return false;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return (
      style.display !== 'none'
      && style.visibility !== 'hidden'
      && style.opacity !== '0'
      && rect.width > 0
      && rect.height > 0
    );
  }

  function autoSendIsDisabled(el) {
    if (!el) return true;
    const style = getComputedStyle(el);
    return (
      el.disabled === true
      || el.hasAttribute('disabled')
      || el.getAttribute('aria-disabled') === 'true'
      || el.getAttribute('data-disabled') === 'true'
      || style.pointerEvents === 'none'
    );
  }

  function autoSendGetShortText(el) {
    const text = autoSendNormalizeText(el.textContent);
    return text.length <= 36 ? text : '';
  }

  function autoSendAriaDescribedText(el) {
    const ids = autoSendNormalizeText(el.getAttribute('aria-describedby'))
      .split(' ')
      .filter(Boolean);

    return ids
      .map((id) => document.getElementById(id)?.textContent || '')
      .join(' ');
  }

  function autoSendElementLabel(el) {
    if (!el) return '';
    return autoSendNormalizeText(
      [
        el.getAttribute('aria-label'),
        el.getAttribute('title'),
        el.getAttribute('data-testid'),
        el.getAttribute('data-state'),
        autoSendAriaDescribedText(el),
        autoSendGetShortText(el),
      ]
        .filter(Boolean)
        .join(' '),
    );
  }

  function autoSendFullElementText(el) {
    if (!el) return '';
    return autoSendNormalizeText(
      [
        el.getAttribute('download'),
        el.getAttribute('aria-label'),
        el.getAttribute('title'),
        el.textContent,
        el.getAttribute('href'),
      ]
        .filter(Boolean)
        .join(' '),
    );
  }

  function autoSendFindPromptInput() {
    const selectors = [
      '#prompt-textarea',
      'textarea#prompt-textarea',
      'textarea[data-testid*="prompt"]',
      'div[data-testid="composer"] textarea',
      '[contenteditable="true"][role="textbox"]',
      '[contenteditable="plaintext-only"][role="textbox"]',
      '[contenteditable="true"][data-testid*="prompt"]',
      'main [role="textbox"][contenteditable="true"]',
      'textarea',
      '[role="textbox"]',
    ];

    const candidates = [
      ...new Set(selectors.flatMap((sel) => [...document.querySelectorAll(sel)])),
    ]
      .filter(autoSendIsVisible)
      .filter((el) => !el.closest('[aria-hidden="true"]'))
      .filter((el) => !el.closest('article, [data-message-author-role]'));

    candidates.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      let as = ar.bottom;
      let bs = br.bottom;
      if ((a.id || '').toLowerCase() === 'prompt-textarea') as += 900;
      if ((b.id || '').toLowerCase() === 'prompt-textarea') bs += 900;
      if ((a.getAttribute('data-testid') || '').toLowerCase().includes('prompt')) as += 300;
      if ((b.getAttribute('data-testid') || '').toLowerCase().includes('prompt')) bs += 300;
      return bs - as;
    });

    return candidates[0] || null;
  }

  function autoSendFindComposerRoot(input) {
    if (!input) return null;

    const direct = input.closest('form, [data-testid="composer"], [data-testid*="composer"]');
    if (direct && autoSendIsVisible(direct)) return direct;

    let node = input.parentElement;
    for (let depth = 0; node && depth < 10; depth += 1, node = node.parentElement) {
      if (node.closest('article, [data-message-author-role]')) break;
      const buttons = node.querySelectorAll('button');
      if (
        buttons.length
        && [...buttons].some((btn) => {
          const testId = (btn.getAttribute('data-testid') || '').toLowerCase();
          const type = (btn.getAttribute('type') || '').toLowerCase();
          const label = autoSendElementLabel(btn);
          return (
            testId.includes('send')
            || type === 'submit'
            || AUTO_SEND_RE.test(label)
            || AUTO_SEND_PENDING_RE.test(label)
          );
        })
      ) {
        return node;
      }
    }

    return input.parentElement || null;
  }

  function autoSendIsDownloadElement(el) {
    if (!el) return false;
    if (el.matches('a[href], a[download]')) return true;
    if (el.closest('a[href], a[download]')) return true;
    const text = autoSendFullElementText(el);
    return (
      AUTO_SEND_FILE_EXT_RE.test(text)
      || (AUTO_SEND_DOWNLOAD_HINT_RE.test(text)
        && /\.(?:js|txt|pdf|docx|xlsx|pptx|zip|csv|json|md)\b/i.test(text))
    );
  }

  function autoSendIsConversationArea(el) {
    return !!el.closest('article, [data-message-author-role], main');
  }

  function autoSendLooksLikeComposerSendButton(btn, composerRoot) {
    if (!btn || btn.tagName !== 'BUTTON') return false;
    if (!composerRoot || !composerRoot.contains(btn)) return false;
    if (btn.closest('#__cg_nav_panel')) return false;
    if (btn.closest('article, [data-message-author-role]')) return false;
    if (autoSendIsDownloadElement(btn)) return false;

    const testId = (btn.getAttribute('data-testid') || '').toLowerCase();
    const type = (btn.getAttribute('type') || '').toLowerCase();
    const aria = autoSendNormalizeText(
      [
        btn.getAttribute('aria-label'),
        btn.getAttribute('title'),
        btn.getAttribute('data-testid'),
        btn.getAttribute('data-state'),
        autoSendAriaDescribedText(btn),
      ]
        .filter(Boolean)
        .join(' '),
    );

    if (AUTO_SEND_STOP_RE.test(aria)) return false;
    if (testId === 'send-button') return true;
    if (testId.includes('send-button')) return true;
    if (testId.includes('composer-submit')) return true;
    if (type === 'submit') return true;
    if (AUTO_SEND_PENDING_RE.test(aria)) return true;
    if (AUTO_SEND_RE.test(aria)) return true;

    return false;
  }

  function autoSendScoreComposerSendButton(btn, input, composerRoot) {
    const rect = btn.getBoundingClientRect();
    const testId = (btn.getAttribute('data-testid') || '').toLowerCase();
    const type = (btn.getAttribute('type') || '').toLowerCase();
    const label = autoSendElementLabel(btn);
    let score = 0;

    if (testId === 'send-button') score += 2000;
    if (testId.includes('send-button')) score += 1500;
    if (testId.includes('composer-submit')) score += 1000;
    if (type === 'submit') score += 700;
    if (AUTO_SEND_PENDING_RE.test(label)) score += 450;
    if (AUTO_SEND_RE.test(label)) score += 350;
    if (input && btn.closest('form') && input.closest('form') === btn.closest('form')) score += 600;
    if (composerRoot && composerRoot.contains(btn)) score += 500;
    if (rect.right > window.innerWidth * 0.5) score += 60;
    if (rect.bottom > window.innerHeight * 0.45) score += 60;
    if (AUTO_SEND_STOP_RE.test(label)) score -= 2000;
    if (autoSendIsDownloadElement(btn)) score -= 5000;
    return score;
  }

  function autoSendFindSendButton() {
    const input = autoSendFindPromptInput();
    if (!input) return null;

    const composerRoot = autoSendFindComposerRoot(input);
    if (!composerRoot) return null;

    const buttons = [...composerRoot.querySelectorAll('button')]
      .filter(autoSendIsVisible)
      .filter((btn) => autoSendLooksLikeComposerSendButton(btn, composerRoot));

    if (!buttons.length) return null;

    buttons.sort(
      (a, b) => autoSendScoreComposerSendButton(b, input, composerRoot)
        - autoSendScoreComposerSendButton(a, input, composerRoot),
    );
    return buttons[0] || null;
  }

  function autoSendGetReadiness() {
    if (PLATFORM !== 'chatgpt') {
      return {
        ready: false,
        button: null,
        message: 'Auto envío disponible solo en ChatGPT.',
      };
    }

    const input = autoSendFindPromptInput();
    if (!input) {
      return {
        ready: false,
        button: null,
        message: 'Esperando: no encontré el cuadro de texto del compositor.',
      };
    }

    const btn = autoSendFindSendButton();
    if (!btn) {
      return {
        ready: false,
        button: null,
        message: 'Esperando: no encontré un botón de envío dentro del compositor.',
      };
    }

    const label = autoSendElementLabel(btn);
    if (AUTO_SEND_PENDING_RE.test(label)) {
      return {
        ready: false,
        button: btn,
        message: 'Esperando: ChatGPT todavía indica File Upload Pending.',
      };
    }

    if (AUTO_SEND_STOP_RE.test(label)) {
      return {
        ready: false,
        button: btn,
        message: 'Esperando: el chat parece estar generando o el botón actual no es de envío.',
      };
    }

    if (
      autoSendIsDownloadElement(btn)
      || (autoSendIsConversationArea(btn)
        && !btn.closest('form, [data-testid="composer"], [data-testid*="composer"]'))
    ) {
      return {
        ready: false,
        button: null,
        message: 'Bloqueado: el candidato detectado no pertenece al compositor.',
      };
    }

    if (autoSendIsDisabled(btn)) {
      return {
        ready: false,
        button: btn,
        message: 'Esperando: el botón de envío existe, pero aún está deshabilitado.',
      };
    }

    return {
      ready: true,
      button: btn,
      message: 'Listo: el botón de envío del compositor está habilitado.',
    };
  }

  function autoSendSetStatus(text) {
    STATE.autoSendLastStatus = text || 'Auto enviar al estar listo.';
    refreshAutoSendControls();
  }

  function stopAutoSendWatching() {
    if (STATE.autoSendObserver) {
      STATE.autoSendObserver.disconnect();
      STATE.autoSendObserver = null;
    }
    if (STATE.autoSendPollTimer) {
      clearInterval(STATE.autoSendPollTimer);
      STATE.autoSendPollTimer = null;
    }
    if (STATE.autoSendDebounceTimer) {
      clearTimeout(STATE.autoSendDebounceTimer);
      STATE.autoSendDebounceTimer = null;
    }
  }

  function scheduleAutoSendCheck() {
    if (!STATE.autoSendArmed || STATE.autoSendSent) return;
    if (STATE.autoSendDebounceTimer) clearTimeout(STATE.autoSendDebounceTimer);
    STATE.autoSendDebounceTimer = setTimeout(checkAutoSend, AUTO_SEND_DEBOUNCE_MS);
  }

  function clickSendOnce() {
    const fresh = autoSendGetReadiness();
    if (!fresh.ready || !fresh.button) {
      STATE.autoSendSent = false;
      autoSendSetStatus(fresh.message);
      return;
    }

    STATE.autoSendSent = true;
    autoSendSetStatus('Enviando solicitud desde el compositor...');

    try {
      fresh.button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    } catch (_) { }

    fresh.button.click();

    STATE.autoSendArmed = false;
    stopAutoSendWatching();
    autoSendSetStatus('Solicitud enviada. Auto envío desactivado.');
  }

  function checkAutoSend() {
    if (!STATE.autoSendArmed || STATE.autoSendSent) return;
    const readiness = autoSendGetReadiness();
    autoSendSetStatus(readiness.message);
    if (readiness.ready) setTimeout(clickSendOnce, 120);
  }

  function startAutoSendWatching() {
    stopAutoSendWatching();
    if (!document.body) return;

    STATE.autoSendObserver = new MutationObserver(scheduleAutoSendCheck);
    STATE.autoSendObserver.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        'disabled',
        'aria-disabled',
        'aria-label',
        'title',
        'data-testid',
        'data-state',
        'class',
        'href',
        'download',
      ],
    });

    STATE.autoSendPollTimer = setInterval(checkAutoSend, AUTO_SEND_CHECK_EVERY_MS);
    checkAutoSend();
  }

  function armAutoSend() {
    if (PLATFORM !== 'chatgpt') {
      autoSendSetStatus('Auto envío disponible solo en ChatGPT.');
      return;
    }

    STATE.autoSendArmed = true;
    STATE.autoSendSent = false;
    autoSendSetStatus('Auto envío armado. Solo se aceptará el botón de envío dentro del compositor.');
    startAutoSendWatching();
  }

  function cancelAutoSend() {
    STATE.autoSendArmed = false;
    STATE.autoSendSent = false;
    stopAutoSendWatching();
    autoSendSetStatus('Auto envío cancelado.');
  }

  function toggleAutoSend() {
    if (STATE.autoSendArmed) cancelAutoSend();
    else armAutoSend();
  }

  function getAutoSendIconSvg() {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M3 7h6M2 12h7M3 17h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"></path>
        <path d="M10 4.5 21 12l-11 7.5 2.15-6.05L18 12l-5.85-1.45L10 4.5Z" fill="currentColor"></path>
      </svg>
    `;
  }

  function createAutoSendButton() {
    const autoSendBtn = document.createElement('button');
    autoSendBtn.id = '__cg_auto_send_btn';
    autoSendBtn.type = 'button';
    autoSendBtn.dataset.role = '__cg_nav_auto_send_toggle';
    setSafeInnerHTML(autoSendBtn, getAutoSendIconSvg());
    autoSendBtn.addEventListener('click', toggleAutoSend);
    return autoSendBtn;
  }

  function ensureAutoSendPanelButton() {
    if (!STATE.panel) return;
    if (STATE.panel.querySelector('#__cg_auto_send_btn')) return;

    const autoSendBtn = createAutoSendButton();
    const listBtn = STATE.panel.querySelector('#__cg_list_btn');
    STATE.panel.insertBefore(autoSendBtn, listBtn || null);
    refreshAutoSendControls();
  }

  function refreshAutoSendControls() {
    const controls = document.querySelectorAll('[data-role="__cg_nav_auto_send_toggle"]');
    controls.forEach((button) => {
      const active = STATE.autoSendArmed;
      const unsupported = PLATFORM !== 'chatgpt';
      button.classList.toggle('__cg_nav_auto_send_active', active && !unsupported);
      button.setAttribute('aria-pressed', active && !unsupported ? 'true' : 'false');
      button.disabled = unsupported;

      if (unsupported) {
        button.setAttribute('aria-label', 'Auto enviar disponible solo en ChatGPT');
        button.title = 'Auto enviar disponible solo en ChatGPT';
        return;
      }

      button.setAttribute(
        'aria-label',
        active ? 'Auto enviar al estar listo activado' : 'Auto enviar al estar listo desactivado',
      );
      button.title = active
        ? `Auto enviar activado. Click para cancelar. ${STATE.autoSendLastStatus}`
        : 'Auto enviar al estar listo. Click para activar.';
    });
  }


  function buildPanel() {
    if (document.getElementById('__cg_nav_panel')) {
      STATE.panel = document.getElementById('__cg_nav_panel');
      ensureAutoSendPanelButton();
      refreshThemeControls();
      refreshAlarmControls();
      refreshAutoSendControls();
      return;
    }

    const panel = document.createElement('div');
    panel.id = '__cg_nav_panel';

    const dragHandle = document.createElement('div');
    dragHandle.id = '__cg_nav_drag';
    dragHandle.title = 'Arrastra para mover.';
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

    const autoSendBtn = createAutoSendButton();

    const listBtn = document.createElement('button');
    listBtn.id = '__cg_list_btn';
    listBtn.type = 'button';
    listBtn.className = '__cg_nav_primary';
    listBtn.title = 'Abrir menú';
    listBtn.setAttribute('aria-label', 'Abrir menú');
    setSafeInnerHTML(listBtn, getListIconSvg());

    prevBtn.addEventListener('click', goPrev);
    nextBtn.addEventListener('click', goNext);
    listBtn.addEventListener('click', toggleOptionsMenu);

    panel.appendChild(dragHandle);
    panel.appendChild(prevBtn);
    panel.appendChild(counter);
    panel.appendChild(nextBtn);
    panel.appendChild(autoSendBtn);
    panel.appendChild(listBtn);

    (document.body || document.documentElement).appendChild(panel);
    STATE.panel = panel;

    bindPanelDrag(dragHandle);
    refreshThemeControls();
    refreshAlarmControls();
    refreshAutoSendControls();

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
    refreshAutoSendControls();
  }

  function closeOptionsMenu() {
    if (!STATE.optionsMenu) return;
    STATE.optionsMenu.remove();
    STATE.optionsMenu = null;
    document.removeEventListener('click', handleOptionsMenuOutsideClick, true);
    document.removeEventListener('keydown', handleOptionsMenuKeydown, true);
  }

  function handleOptionsMenuOutsideClick(event) {
    if (!STATE.optionsMenu) return;
    if (STATE.optionsMenu.contains(event.target)) return;
    if (STATE.panel && STATE.panel.querySelector('#__cg_list_btn')?.contains(event.target)) return;
    closeOptionsMenu();
  }

  function handleOptionsMenuKeydown(event) {
    if (event.key === 'Escape') closeOptionsMenu();
  }

  function toggleOptionsMenu(event) {
    if (event) event.stopPropagation();

    if (STATE.optionsMenu) {
      closeOptionsMenu();
      return;
    }

    if (!STATE.panel) return;

    const menu = document.createElement('div');
    menu.id = '__cg_nav_options_menu';
    menu.setAttribute('role', 'menu');
    menu.addEventListener('click', (menuEvent) => menuEvent.stopPropagation());

    const openListBtn = document.createElement('button');
    openListBtn.type = 'button';
    openListBtn.className = '__cg_nav_menu_row';
    openListBtn.setAttribute('role', 'menuitem');
    setSafeInnerHTML(openListBtn, `
      <span class="__cg_nav_menu_label">
        ${getListIconSvg()}
        <span>Abrir lista</span>
      </span>
      <span class="__cg_nav_menu_value">↗</span>
    `);
    openListBtn.addEventListener('click', () => {
      closeOptionsMenu();
      openListModal();
    });

    const themeBtn = document.createElement('button');
    themeBtn.type = 'button';
    themeBtn.dataset.role = '__cg_nav_theme_toggle';
    themeBtn.dataset.display = '__cg_nav_menu';
    themeBtn.className = '__cg_nav_menu_row';
    themeBtn.setAttribute('role', 'menuitem');
    themeBtn.addEventListener('click', cycleThemeMode);

    const alarmBtn = document.createElement('button');
    alarmBtn.type = 'button';
    alarmBtn.dataset.role = '__cg_nav_alarm_toggle';
    alarmBtn.dataset.display = '__cg_nav_menu';
    alarmBtn.className = STATE.alarmEnabled ? '__cg_nav_menu_row __cg_nav_primary' : '__cg_nav_menu_row';
    alarmBtn.setAttribute('role', 'menuitem');
    alarmBtn.addEventListener('click', toggleAlarmEnabled);

    const intervalRow = document.createElement('div');
    intervalRow.className = '__cg_nav_menu_volume';
    intervalRow.title = '0 = sin repetir. De 1 a 5 = repetir hasta visitar esta pestaña.';

    const intervalLabel = document.createElement('span');
    intervalLabel.className = '__cg_nav_menu_label';
    intervalLabel.textContent = 'Repetir';

    const intervalInput = document.createElement('input');
    intervalInput.type = 'range';
    intervalInput.min = String(CONTINUOUS_ALARM_INTERVAL_MIN);
    intervalInput.max = String(CONTINUOUS_ALARM_INTERVAL_MAX);
    intervalInput.step = '1';
    intervalInput.value = String(STATE.continuousAlarmIntervalMin);
    intervalInput.dataset.role = '__cg_nav_continuous_interval';
    intervalInput.addEventListener('input', () => {
      setContinuousAlarmInterval(Number(intervalInput.value));
    });

    const intervalValue = document.createElement('span');
    intervalValue.className = '__cg_nav_menu_value';
    intervalValue.dataset.role = '__cg_nav_continuous_interval_value';
    intervalValue.textContent = getContinuousAlarmIntervalLabel();

    const intervalControl = document.createElement('span');
    intervalControl.className = '__cg_nav_menu_label';
    intervalControl.appendChild(intervalInput);
    intervalControl.appendChild(intervalValue);

    intervalRow.appendChild(intervalLabel);
    intervalRow.appendChild(intervalControl);

    const alarmToneBtn = document.createElement('button');
    alarmToneBtn.type = 'button';
    alarmToneBtn.dataset.role = '__cg_nav_alarm_tone_toggle';
    alarmToneBtn.dataset.display = '__cg_nav_menu';
    alarmToneBtn.className = '__cg_nav_menu_row';
    alarmToneBtn.setAttribute('role', 'menuitem');

    const tonePicker = document.createElement('div');
    tonePicker.id = '__cg_nav_alarm_tone_picker';
    tonePicker.className = '__cg_nav_tone_picker';
    tonePicker.hidden = true;

    alarmToneBtn.addEventListener('click', () => {
      tonePicker.hidden = !tonePicker.hidden;
      refreshAlarmToneControls();
    });

    ALARM_TONES.forEach((tone) => {
      const toneOption = document.createElement('button');
      toneOption.type = 'button';
      toneOption.className = '__cg_nav_tone_option';
      toneOption.dataset.role = '__cg_nav_alarm_tone_option';
      toneOption.dataset.toneId = tone.id;
      toneOption.setAttribute('role', 'menuitemradio');
      toneOption.addEventListener('click', () => {
        setAlarmTone(tone.id);
      });
      tonePicker.appendChild(toneOption);
    });

    const tonePreviewBtn = document.createElement('button');
    tonePreviewBtn.type = 'button';
    tonePreviewBtn.className = '__cg_nav_tone_preview';
    tonePreviewBtn.dataset.role = '__cg_nav_alarm_tone_preview';
    tonePreviewBtn.setAttribute('role', 'menuitem');
    tonePreviewBtn.addEventListener('click', () => {
      playSelectedAlarmTone();
    });
    tonePicker.appendChild(tonePreviewBtn);

    const volumeRow = document.createElement('div');
    volumeRow.className = '__cg_nav_menu_volume';

    const volumeLabel = document.createElement('span');
    volumeLabel.className = '__cg_nav_menu_label';
    volumeLabel.textContent = 'Volumen';

    const volumeInput = document.createElement('input');
    volumeInput.type = 'range';
    volumeInput.min = String(Math.round(ALARM_VOLUME_MIN * 100));
    volumeInput.max = String(Math.round(ALARM_VOLUME_MAX * 100));
    volumeInput.step = '1';
    volumeInput.value = String(Math.round(STATE.alarmVolume * 100));
    volumeInput.dataset.role = '__cg_nav_alarm_volume';
    volumeInput.addEventListener('input', () => {
      setAlarmVolume(Number(volumeInput.value) / 100);
    });

    const volumeValue = document.createElement('span');
    volumeValue.className = '__cg_nav_menu_value';
    volumeValue.dataset.role = '__cg_nav_alarm_volume_value';
    volumeValue.textContent = `${getAlarmVolumePercent()}%`;

    const volumeControl = document.createElement('span');
    volumeControl.className = '__cg_nav_menu_label';
    volumeControl.appendChild(volumeInput);
    volumeControl.appendChild(volumeValue);

    volumeRow.appendChild(volumeLabel);
    volumeRow.appendChild(volumeControl);

    menu.appendChild(openListBtn);
    menu.appendChild(themeBtn);
    menu.appendChild(alarmBtn);
    menu.appendChild(intervalRow);
    menu.appendChild(alarmToneBtn);
    menu.appendChild(tonePicker);
    menu.appendChild(volumeRow);

    STATE.panel.appendChild(menu);
    STATE.optionsMenu = menu;

    refreshThemeControls();
    refreshAlarmControls();
    refreshContinuousAlarmIntervalControls();
    refreshAlarmVolumeControls();
    refreshAlarmToneControls();

    setTimeout(() => {
      document.addEventListener('click', handleOptionsMenuOutsideClick, true);
      document.addEventListener('keydown', handleOptionsMenuKeydown, true);
    }, 0);
  }

  function openListModal() {
    closeOptionsMenu();

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

    const closeBtn = document.createElement('button');
    closeBtn.id = '__cg_nav_close';
    closeBtn.type = 'button';
    closeBtn.textContent = 'Cerrar';

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
      acknowledgeContinuousAlarmIfForeground();
    });

    window.addEventListener('focus', () => {
      if (STATE.alarmEnabled) initAlarmAudio();
      acknowledgeContinuousAlarmIfForeground();
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
// ==UserScript==
// @name         ChatGPT - Auto enviar cuando termine la subida
// @namespace    local.chatgpt.auto-send-after-upload
// @version      1.1.0
// @description  Activa un envío automático único: espera a que desaparezca "File Upload Pending" y hace clic en Enviar cuando el botón queda habilitado. Incluye tema automático, oscuro y claro.
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  "use strict";

  try {
    if (window.top !== window.self) return;
  } catch (_) {
    return;
  }

  let __asu_policy = null;
  if (window.trustedTypes && window.trustedTypes.createPolicy) {
    for (const name of [
      "MyPromptPolicy",
      "dompurify",
      "default",
      "cwm-policy",
      "__asu_policy",
    ]) {
      try {
        __asu_policy = window.trustedTypes.createPolicy(name, {
          createHTML: (s) => s,
        });
        break;
      } catch (_) {}
    }
  }

  function setSafeInnerHTML(el, html) {
    if (!el) return;
    el.innerHTML = __asu_policy ? __asu_policy.createHTML(html) : html;
  }

  const CONFIG = {
    panelId: "cgpt-auto-send-upload-panel",
    styleId: "cgpt-auto-send-upload-style",
    zIndex: 2147483647,
    checkEveryMs: 400,
    debounceMs: 80,
  };

  const STORAGE_KEYS = {
    theme: "__cgpt_auto_send_upload_theme_v1",
  };

  const THEME_ORDER = ["auto", "dark", "light"];
  const THEME_LABELS = {
    auto: "Tema automático",
    dark: "Tema oscuro",
    light: "Tema claro",
  };
  const COLOR_SCHEME_QUERY = window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

  const SEND_RE =
    /(^|\b)(send|submit|enviar|env[ií]a|envoyer|senden|invia)(\b|$)/i;
  const PENDING_RE =
    /(file\s*upload\s*pending|upload\s*pending|subida\s+de\s+archivo\s+pendiente|archivo\s+pendiente|carga\s+de\s+archivo\s+pendiente|subiendo\s+archivo|uploading\s+file|processing\s+file|procesando\s+archivo)/i;
  const STOP_RE =
    /(^|\b)(stop|detener|cancelar|interrumpir|parar|stop\s+streaming)(\b|$)/i;

  const state = {
    armed: false,
    sent: false,
    observer: null,
    pollTimer: null,
    debounceTimer: null,
    themeMode: "auto",
    resolvedTheme: "dark",
  };

  function normalizeText(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    if (el.closest(`#${CONFIG.panelId}`)) return false;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0" &&
      rect.width > 0 &&
      rect.height > 0
    );
  }

  function isDisabled(el) {
    if (!el) return true;
    const style = getComputedStyle(el);
    return (
      el.disabled === true ||
      el.hasAttribute("disabled") ||
      el.getAttribute("aria-disabled") === "true" ||
      el.getAttribute("data-disabled") === "true" ||
      style.pointerEvents === "none"
    );
  }

  function ariaDescribedText(el) {
    const ids = normalizeText(el.getAttribute("aria-describedby"))
      .split(" ")
      .filter(Boolean);
    return ids
      .map((id) => document.getElementById(id)?.textContent || "")
      .join(" ");
  }

  function elementLabel(el) {
    if (!el) return "";
    return normalizeText(
      [
        el.getAttribute("aria-label"),
        el.getAttribute("title"),
        el.getAttribute("data-testid"),
        el.getAttribute("data-state"),
        el.textContent,
        ariaDescribedText(el),
      ]
        .filter(Boolean)
        .join(" "),
    );
  }

  function findPromptInput() {
    const selectors = [
      "#prompt-textarea",
      "textarea#prompt-textarea",
      'textarea[data-testid*="prompt"]',
      'div[data-testid="composer"] textarea',
      '[contenteditable="true"][role="textbox"]',
      '[contenteditable="plaintext-only"][role="textbox"]',
      '[contenteditable="true"][data-testid*="prompt"]',
      'main [role="textbox"][contenteditable="true"]',
      "textarea",
      '[role="textbox"]',
    ];

    const candidates = [
      ...new Set(
        selectors.flatMap((sel) => [...document.querySelectorAll(sel)]),
      ),
    ]
      .filter(isVisible)
      .filter((el) => !el.closest('[aria-hidden="true"]'));

    candidates.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      let as = ar.bottom;
      let bs = br.bottom;
      if ((a.id || "").toLowerCase() === "prompt-textarea") as += 500;
      if ((b.id || "").toLowerCase() === "prompt-textarea") bs += 500;
      if (
        (a.getAttribute("data-testid") || "").toLowerCase().includes("prompt")
      )
        as += 200;
      if (
        (b.getAttribute("data-testid") || "").toLowerCase().includes("prompt")
      )
        bs += 200;
      return bs - as;
    });

    return candidates[0] || null;
  }

  function looksLikeSendButton(el, label) {
    const type = (el.getAttribute("type") || "").toLowerCase();
    const testId = (el.getAttribute("data-testid") || "").toLowerCase();
    return (
      testId === "send-button" ||
      testId.includes("send") ||
      SEND_RE.test(label) ||
      PENDING_RE.test(label) ||
      (type === "submit" && !!el.closest("form"))
    );
  }

  function scoreSendButton(el, input) {
    const label = elementLabel(el);
    const rect = el.getBoundingClientRect();
    const testId = (el.getAttribute("data-testid") || "").toLowerCase();
    let score = 0;

    if (testId === "send-button") score += 1000;
    if (testId.includes("send")) score += 300;
    if (SEND_RE.test(label)) score += 200;
    if (PENDING_RE.test(label)) score += 200;
    if ((el.getAttribute("type") || "").toLowerCase() === "submit")
      score += 120;
    if (
      input &&
      el.closest("form") &&
      input.closest("form") === el.closest("form")
    )
      score += 500;
    if (rect.bottom > window.innerHeight * 0.45) score += 80;
    score += Math.round(rect.bottom / 10);

    if (STOP_RE.test(label)) score -= 1000;
    if (el.closest("header, nav, aside")) score -= 150;

    return score;
  }

  function findSendButton() {
    const input = findPromptInput();
    const allButtons = [...document.querySelectorAll('button, [role="button"]')]
      .filter(isVisible)
      .filter((el) => !el.closest(`#${CONFIG.panelId}`));

    const candidates = allButtons
      .map((el) => ({ el, label: elementLabel(el) }))
      .filter(({ el, label }) => looksLikeSendButton(el, label));

    if (!candidates.length) return null;

    candidates.sort(
      (a, b) => scoreSendButton(b.el, input) - scoreSendButton(a.el, input),
    );
    return candidates[0].el;
  }

  function getReadiness() {
    const btn = findSendButton();

    if (!btn) {
      return {
        ready: false,
        button: null,
        message: "Esperando: no encontré el botón de envío de ChatGPT.",
      };
    }

    const label = elementLabel(btn);

    if (PENDING_RE.test(label)) {
      return {
        ready: false,
        button: btn,
        message: "Esperando: ChatGPT todavía indica File Upload Pending.",
      };
    }

    if (STOP_RE.test(label)) {
      return {
        ready: false,
        button: btn,
        message:
          "Esperando: el chat parece estar generando o el botón actual no es de envío.",
      };
    }

    if (isDisabled(btn)) {
      return {
        ready: false,
        button: btn,
        message:
          "Esperando: el botón de envío existe, pero aún está deshabilitado.",
      };
    }

    return {
      ready: true,
      button: btn,
      message: "Listo: el botón de envío está habilitado.",
    };
  }

  function getResolvedTheme() {
    if (state.themeMode === "dark") return "dark";
    if (state.themeMode === "light") return "light";
    return COLOR_SCHEME_QUERY && COLOR_SCHEME_QUERY.matches ? "dark" : "light";
  }

  function loadUiPreferences() {
    const storedTheme = localStorage.getItem(STORAGE_KEYS.theme);
    if (THEME_ORDER.includes(storedTheme)) {
      state.themeMode = storedTheme;
    }
  }

  function getThemeIconSvg(mode) {
    if (mode === "dark") {
      return `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M20 15.31A8 8 0 0 1 8.69 4 9 9 0 1 0 20 15.31z" fill="currentColor"></path>
        </svg>
      `;
    }

    if (mode === "light") {
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

  function refreshThemeControls() {
    const panel = document.getElementById(CONFIG.panelId);
    if (!panel) return;

    panel.setAttribute("data-theme-mode", state.themeMode);
    panel.setAttribute("data-resolved-theme", state.resolvedTheme);

    const themeBtn = panel.querySelector(".asu-theme");
    if (themeBtn) {
      const label = THEME_LABELS[state.themeMode] || "Tema";
      themeBtn.setAttribute("aria-label", `${label}. Clic para cambiar tema.`);
      themeBtn.setAttribute("title", `${label}. Clic: auto → oscuro → claro.`);
      setSafeInnerHTML(
        themeBtn,
        `${getThemeIconSvg(state.themeMode)}<span class="asu-sr">${label}</span>`,
      );
    }
  }

  function applyTheme() {
    state.resolvedTheme = getResolvedTheme();
    document.documentElement.setAttribute(
      "data-__asu-theme",
      state.resolvedTheme,
    );
    document.documentElement.setAttribute(
      "data-__asu-theme-mode",
      state.themeMode,
    );
    refreshThemeControls();
  }

  function cycleThemeMode() {
    const currentIndex = THEME_ORDER.indexOf(state.themeMode);
    const nextIndex = (currentIndex + 1) % THEME_ORDER.length;
    state.themeMode = THEME_ORDER[nextIndex];

    try {
      localStorage.setItem(STORAGE_KEYS.theme, state.themeMode);
    } catch (_) {}

    applyTheme();
  }

  function setStatus(text) {
    const panel = document.getElementById(CONFIG.panelId);
    if (!panel) return;
    const status = panel.querySelector(".asu-status");
    if (status && status.textContent !== text) status.textContent = text;
  }

  function updateButtons() {
    const panel = document.getElementById(CONFIG.panelId);
    if (!panel) return;
    const armBtn = panel.querySelector(".asu-arm");
    const cancelBtn = panel.querySelector(".asu-cancel");

    if (armBtn) {
      armBtn.textContent = state.armed
        ? "Armado: enviará al estar listo"
        : "Auto enviar al estar listo";
      armBtn.classList.toggle("is-armed", state.armed);
      armBtn.disabled = state.armed;
    }

    if (cancelBtn) {
      cancelBtn.disabled = !state.armed;
    }
  }

  function stopWatching() {
    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
      state.debounceTimer = null;
    }
  }

  function scheduleCheck() {
    if (!state.armed || state.sent) return;
    if (state.debounceTimer) clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(checkAutoSend, CONFIG.debounceMs);
  }

  function clickSendOnce() {
    const fresh = getReadiness();

    if (!fresh.ready || !fresh.button) {
      state.sent = false;
      setStatus(fresh.message);
      return;
    }

    state.sent = true;
    setStatus("Enviando solicitud...");

    try {
      fresh.button.scrollIntoView({ block: "nearest", inline: "nearest" });
    } catch (_) {}

    fresh.button.click();

    state.armed = false;
    stopWatching();
    updateButtons();
    setStatus("Solicitud enviada. Auto envío desactivado.");
  }

  function checkAutoSend() {
    if (!state.armed || state.sent) return;

    const readiness = getReadiness();
    setStatus(readiness.message);

    if (readiness.ready) {
      setTimeout(clickSendOnce, 120);
    }
  }

  function startWatching() {
    stopWatching();

    if (!document.body) return;

    state.observer = new MutationObserver(scheduleCheck);
    state.observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        "disabled",
        "aria-disabled",
        "aria-label",
        "title",
        "data-testid",
        "data-state",
        "class",
      ],
    });

    state.pollTimer = setInterval(checkAutoSend, CONFIG.checkEveryMs);
    checkAutoSend();
  }

  function armAutoSend() {
    state.armed = true;
    state.sent = false;
    updateButtons();
    setStatus(
      "Auto envío armado. Esperando a que termine la subida y se habilite Enviar...",
    );
    startWatching();
  }

  function cancelAutoSend() {
    state.armed = false;
    state.sent = false;
    stopWatching();
    updateButtons();
    setStatus("Auto envío cancelado.");
  }

  function ensureStyle() {
    if (document.getElementById(CONFIG.styleId)) return;

    const style = document.createElement("style");
    style.id = CONFIG.styleId;
    style.textContent = `
      html[data-__asu-theme="dark"] #${CONFIG.panelId} {
        --asu-bg: rgba(17, 24, 39, 0.94);
        --asu-bg-solid: #111827;
        --asu-surface: rgba(31, 41, 55, 0.86);
        --asu-surface-2: rgba(55, 65, 81, 0.88);
        --asu-surface-3: rgba(2, 6, 23, 0.88);
        --asu-border: rgba(75, 85, 99, 0.74);
        --asu-border-strong: rgba(96, 165, 250, 0.92);
        --asu-text: #f9fafb;
        --asu-text-soft: #cbd5e1;
        --asu-text-muted: #94a3b8;
        --asu-primary: #60a5fa;
        --asu-primary-soft: rgba(96, 165, 250, 0.15);
        --asu-shadow: 0 18px 38px rgba(0, 0, 0, 0.34);
      }

      html[data-__asu-theme="light"] #${CONFIG.panelId} {
        --asu-bg: rgba(255, 255, 255, 0.94);
        --asu-bg-solid: #ffffff;
        --asu-surface: rgba(248, 250, 252, 0.92);
        --asu-surface-2: rgba(241, 245, 249, 0.96);
        --asu-surface-3: rgba(255, 255, 255, 0.96);
        --asu-border: rgba(203, 213, 225, 0.95);
        --asu-border-strong: rgba(37, 99, 235, 0.9);
        --asu-text: #0f172a;
        --asu-text-soft: #334155;
        --asu-text-muted: #64748b;
        --asu-primary: #2563eb;
        --asu-primary-soft: rgba(37, 99, 235, 0.1);
        --asu-shadow: 0 18px 38px rgba(15, 23, 42, 0.16);
      }

      #${CONFIG.panelId} {
        position: fixed;
        left: 18px;
        bottom: 18px;
        width: 352px;
        max-width: calc(100vw - 36px);
        background: var(--asu-bg);
        color: var(--asu-text);
        border: 1px solid var(--asu-border);
        border-radius: 18px;
        box-shadow: var(--asu-shadow);
        z-index: ${CONFIG.zIndex};
        overflow: hidden;
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
        font: 13px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      #${CONFIG.panelId},
      #${CONFIG.panelId} * {
        box-sizing: border-box;
      }

      #${CONFIG.panelId} .asu-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 10px 12px;
        background: var(--asu-bg-solid);
        border-bottom: 1px solid var(--asu-border);
      }

      #${CONFIG.panelId} .asu-title-wrap {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      #${CONFIG.panelId} .asu-title {
        color: var(--asu-text);
        font-size: 13px;
        font-weight: 750;
        letter-spacing: -0.01em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      #${CONFIG.panelId} .asu-subtitle {
        color: var(--asu-text-muted);
        font-size: 11px;
        font-weight: 500;
        white-space: nowrap;
      }

      #${CONFIG.panelId} .asu-theme {
        width: 34px;
        height: 34px;
        min-width: 34px;
        padding: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 12px;
        border: 1px solid var(--asu-border);
        background: var(--asu-surface);
        color: var(--asu-text-soft);
        cursor: pointer;
      }

      #${CONFIG.panelId} .asu-theme:hover {
        background: var(--asu-surface-2);
        color: var(--asu-text);
      }

      #${CONFIG.panelId} .asu-theme svg {
        width: 19px;
        height: 19px;
        display: block;
        pointer-events: none;
      }

      #${CONFIG.panelId} .asu-body {
        padding: 12px;
      }

      #${CONFIG.panelId} .asu-status {
        min-height: 44px;
        margin-bottom: 10px;
        padding: 10px 11px;
        border: 1px solid var(--asu-border);
        border-radius: 13px;
        background: var(--asu-surface-3);
        color: var(--asu-text-soft);
        font-size: 12px;
        line-height: 1.38;
      }

      #${CONFIG.panelId} .asu-actions {
        display: flex;
        gap: 8px;
      }

      #${CONFIG.panelId} .asu-btn {
        appearance: none;
        border: 1px solid var(--asu-border);
        background: var(--asu-surface);
        color: var(--asu-text);
        border-radius: 12px;
        padding: 8px 10px;
        min-height: 34px;
        cursor: pointer;
        font: inherit;
        font-weight: 650;
        letter-spacing: -0.005em;
      }

      #${CONFIG.panelId} .asu-btn:hover:not(:disabled) {
        background: var(--asu-surface-2);
      }

      #${CONFIG.panelId} .asu-btn:disabled {
        opacity: .55;
        cursor: not-allowed;
      }

      #${CONFIG.panelId} .asu-arm {
        flex: 1;
      }

      #${CONFIG.panelId} .asu-arm.is-armed {
        border-color: var(--asu-border-strong);
        background: var(--asu-primary-soft);
        color: var(--asu-text);
      }

      #${CONFIG.panelId} .asu-cancel {
        min-width: 82px;
        color: var(--asu-text-soft);
      }

      #${CONFIG.panelId} .asu-sr {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }

      @media (max-width: 640px) {
        #${CONFIG.panelId} {
          left: 8px;
          right: 8px;
          bottom: 8px;
          width: auto;
          max-width: none;
        }
      }
    `;
    document.documentElement.appendChild(style);
  }

  function ensurePanel() {
    if (document.getElementById(CONFIG.panelId)) return;
    if (!document.body) return;

    ensureStyle();

    const panel = document.createElement("div");
    panel.id = CONFIG.panelId;
    setSafeInnerHTML(
      panel,
      `
      <div class="asu-head">
        <div class="asu-title-wrap">
          <div class="asu-title">ChatGPT · Auto envío tras subir archivos</div>
          <div class="asu-subtitle">Espera File Upload Pending y envía una sola vez</div>
        </div>
        <button class="asu-theme" type="button"></button>
      </div>
      <div class="asu-body">
        <div class="asu-status">Desactivado. Sube archivos, escribe tu prompt y pulsa “Auto enviar al estar listo”.</div>
        <div class="asu-actions">
          <button class="asu-btn asu-arm" type="button">Auto enviar al estar listo</button>
          <button class="asu-btn asu-cancel" type="button" disabled>Cancelar</button>
        </div>
      </div>
    `,
    );

    document.body.appendChild(panel);

    panel.querySelector(".asu-arm").addEventListener("click", armAutoSend);
    panel
      .querySelector(".asu-cancel")
      .addEventListener("click", cancelAutoSend);
    panel.querySelector(".asu-theme").addEventListener("click", cycleThemeMode);

    applyTheme();
    updateButtons();
  }

  function boot() {
    loadUiPreferences();
    applyTheme();
    ensurePanel();

    const panelKeeper = setInterval(ensurePanel, 1000);

    if (COLOR_SCHEME_QUERY) {
      const handler = () => {
        if (state.themeMode === "auto") applyTheme();
      };

      try {
        COLOR_SCHEME_QUERY.addEventListener("change", handler);
      } catch (_) {
        try {
          COLOR_SCHEME_QUERY.addListener(handler);
        } catch (_) {}
      }
    }

    window.addEventListener("beforeunload", () => {
      clearInterval(panelKeeper);
      stopWatching();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();

// ==UserScript==
// @name         ChatGPT - Auto enviar seguro + descargas aisladas
// @namespace    local.chatgpt.auto-send-after-upload
// @version      1.3.0
// @description  Autoenvío seguro cuando termina la subida. Aísla la lógica de descargas de archivos de la conversación en controles separados.
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @grant        none
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

  const CONFIG = {
    panelId: 'cgpt-auto-send-upload-panel',
    styleId: 'cgpt-auto-send-upload-style',
    zIndex: 2147483647,
    checkEveryMs: 400,
    debounceMs: 90,
    version: '1.2.0',
  };

  const STORAGE_KEYS = {
    theme: '__cgpt_auto_send_upload_theme_v1',
    minimized: '__cgpt_auto_send_upload_minimized_v1',
  };

  const THEME_ORDER = ['auto', 'dark', 'light'];
  const THEME_LABELS = {
    auto: 'Tema automático',
    dark: 'Tema oscuro',
    light: 'Tema claro',
  };

  const COLOR_SCHEME_QUERY = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  const SEND_RE = /(^|\b)(send|submit|enviar|env[ií]a|envoyer|senden|invia)(\b|$)/i;
  const PENDING_RE = /(file\s*upload\s*pending|upload\s*pending|subida\s+de\s+archivo\s+pendiente|archivo\s+pendiente|carga\s+de\s+archivo\s+pendiente|subiendo\s+archivo|uploading\s+file|processing\s+file|procesando\s+archivo)/i;
  const STOP_RE = /(^|\b)(stop|detener|cancelar|interrumpir|parar|stop\s+streaming)(\b|$)/i;
  const FILE_EXT_RE = /\.(?:user\.js|js|txt|md|pdf|docx|doc|xlsx|xls|pptx|ppt|csv|json|zip|rar|7z|png|jpe?g|webp|gif|svg|html|css|py|ipynb|xml|yaml|yml)(?:\b|$|[?#])/i;
  const DOWNLOAD_HINT_RE = /(download|sandbox|files|file|attachment|backend-api|blob:|usercontent)/i;

  const state = {
    armed: false,
    sent: false,
    observer: null,
    pollTimer: null,
    debounceTimer: null,
    themeMode: 'auto',
    resolvedTheme: 'dark',
    downloads: [],
    downloadsExpanded: false,
    downloadsScanned: false,
  };

  function normalizeText(text) {
    return String(text || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function isVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    if (el.closest(`#${CONFIG.panelId}`)) return false;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0' &&
      rect.width > 0 &&
      rect.height > 0
    );
  }

  function isDisabled(el) {
    if (!el) return true;
    const style = getComputedStyle(el);
    return (
      el.disabled === true ||
      el.hasAttribute('disabled') ||
      el.getAttribute('aria-disabled') === 'true' ||
      el.getAttribute('data-disabled') === 'true' ||
      style.pointerEvents === 'none'
    );
  }

  function getShortText(el) {
    const text = normalizeText(el.textContent);
    return text.length <= 36 ? text : '';
  }

  function ariaDescribedText(el) {
    const ids = normalizeText(el.getAttribute('aria-describedby')).split(' ').filter(Boolean);
    return ids.map((id) => document.getElementById(id)?.textContent || '').join(' ');
  }

  function elementLabel(el) {
    if (!el) return '';
    return normalizeText([
      el.getAttribute('aria-label'),
      el.getAttribute('title'),
      el.getAttribute('data-testid'),
      el.getAttribute('data-state'),
      ariaDescribedText(el),
      getShortText(el),
    ].filter(Boolean).join(' '));
  }

  function fullElementText(el) {
    if (!el) return '';
    return normalizeText([
      el.getAttribute('download'),
      el.getAttribute('aria-label'),
      el.getAttribute('title'),
      el.textContent,
      el.getAttribute('href'),
    ].filter(Boolean).join(' '));
  }

  function getInputValue(el) {
    if (!el) return '';
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return el.value || '';
    if (el.isContentEditable || el.getAttribute('role') === 'textbox') return el.innerText || el.textContent || '';
    return '';
  }

  function findPromptInput() {
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

    const candidates = [...new Set(selectors.flatMap((sel) => [...document.querySelectorAll(sel)]))]
      .filter(isVisible)
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

  function findComposerRoot(input) {
    if (!input) return null;

    const direct = input.closest('form, [data-testid="composer"], [data-testid*="composer"]');
    if (direct && isVisible(direct)) return direct;

    let node = input.parentElement;
    for (let depth = 0; node && depth < 10; depth += 1, node = node.parentElement) {
      if (node.closest('article, [data-message-author-role]')) break;
      const buttons = node.querySelectorAll('button');
      if (buttons.length && [...buttons].some((btn) => {
        const testId = (btn.getAttribute('data-testid') || '').toLowerCase();
        const type = (btn.getAttribute('type') || '').toLowerCase();
        const label = elementLabel(btn);
        return testId.includes('send') || type === 'submit' || SEND_RE.test(label) || PENDING_RE.test(label);
      })) {
        return node;
      }
    }

    return input.parentElement || null;
  }

  function isDownloadElement(el) {
    if (!el) return false;
    if (el.matches('a[href], a[download]')) return true;
    if (el.closest('a[href], a[download]')) return true;
    const text = fullElementText(el);
    return FILE_EXT_RE.test(text) || (DOWNLOAD_HINT_RE.test(text) && /\.(?:js|txt|pdf|docx|xlsx|pptx|zip|csv|json|md)\b/i.test(text));
  }

  function isConversationArea(el) {
    return !!el.closest('article, [data-message-author-role], main');
  }

  function looksLikeComposerSendButton(btn, composerRoot) {
    if (!btn || btn.tagName !== 'BUTTON') return false;
    if (!composerRoot || !composerRoot.contains(btn)) return false;
    if (btn.closest(`#${CONFIG.panelId}`)) return false;
    if (btn.closest('article, [data-message-author-role]')) return false;
    if (isDownloadElement(btn)) return false;

    const testId = (btn.getAttribute('data-testid') || '').toLowerCase();
    const type = (btn.getAttribute('type') || '').toLowerCase();
    const aria = normalizeText([
      btn.getAttribute('aria-label'),
      btn.getAttribute('title'),
      btn.getAttribute('data-testid'),
      btn.getAttribute('data-state'),
      ariaDescribedText(btn),
    ].filter(Boolean).join(' '));

    if (STOP_RE.test(aria)) return false;
    if (testId === 'send-button') return true;
    if (testId.includes('send-button')) return true;
    if (testId.includes('composer-submit')) return true;
    if (type === 'submit') return true;
    if (PENDING_RE.test(aria)) return true;
    if (SEND_RE.test(aria)) return true;

    return false;
  }

  function scoreComposerSendButton(btn, input, composerRoot) {
    const rect = btn.getBoundingClientRect();
    const testId = (btn.getAttribute('data-testid') || '').toLowerCase();
    const type = (btn.getAttribute('type') || '').toLowerCase();
    const label = elementLabel(btn);
    let score = 0;

    if (testId === 'send-button') score += 2000;
    if (testId.includes('send-button')) score += 1500;
    if (testId.includes('composer-submit')) score += 1000;
    if (type === 'submit') score += 700;
    if (PENDING_RE.test(label)) score += 450;
    if (SEND_RE.test(label)) score += 350;
    if (input && btn.closest('form') && input.closest('form') === btn.closest('form')) score += 600;
    if (composerRoot && composerRoot.contains(btn)) score += 500;
    if (rect.right > window.innerWidth * 0.50) score += 60;
    if (rect.bottom > window.innerHeight * 0.45) score += 60;
    if (STOP_RE.test(label)) score -= 2000;
    if (isDownloadElement(btn)) score -= 5000;
    return score;
  }

  function findSendButton() {
    const input = findPromptInput();
    if (!input) return null;

    const composerRoot = findComposerRoot(input);
    if (!composerRoot) return null;

    const buttons = [...composerRoot.querySelectorAll('button')]
      .filter(isVisible)
      .filter((btn) => looksLikeComposerSendButton(btn, composerRoot));

    if (!buttons.length) return null;

    buttons.sort((a, b) => scoreComposerSendButton(b, input, composerRoot) - scoreComposerSendButton(a, input, composerRoot));
    return buttons[0] || null;
  }

  function getReadiness() {
    const input = findPromptInput();
    if (!input) {
      return {
        ready: false,
        button: null,
        message: 'Esperando: no encontré el cuadro de texto del compositor.',
      };
    }

    const btn = findSendButton();
    if (!btn) {
      return {
        ready: false,
        button: null,
        message: 'Esperando: no encontré un botón de envío dentro del compositor.',
      };
    }

    const label = elementLabel(btn);
    if (PENDING_RE.test(label)) {
      return {
        ready: false,
        button: btn,
        message: 'Esperando: ChatGPT todavía indica File Upload Pending.',
      };
    }

    if (STOP_RE.test(label)) {
      return {
        ready: false,
        button: btn,
        message: 'Esperando: el chat parece estar generando o el botón actual no es de envío.',
      };
    }

    if (isDownloadElement(btn) || isConversationArea(btn) && !btn.closest('form, [data-testid="composer"], [data-testid*="composer"]')) {
      return {
        ready: false,
        button: null,
        message: 'Bloqueado: el candidato detectado no pertenece al compositor.',
      };
    }

    if (isDisabled(btn)) {
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

  function getResolvedTheme() {
    if (state.themeMode === 'dark') return 'dark';
    if (state.themeMode === 'light') return 'light';
    return COLOR_SCHEME_QUERY && COLOR_SCHEME_QUERY.matches ? 'dark' : 'light';
  }

  function loadUiPreferences() {
    try {
      const storedTheme = localStorage.getItem(STORAGE_KEYS.theme);
      if (THEME_ORDER.includes(storedTheme)) state.themeMode = storedTheme;
    } catch (_) {}
  }

  function getThemeIconSvg(mode) {
    if (mode === 'dark') {
      return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 15.31A8 8 0 0 1 8.69 4 9 9 0 1 0 20 15.31z" fill="currentColor"></path></svg>';
    }
    if (mode === 'light') {
      return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="4" fill="currentColor"></circle><path d="M12 2v3M12 19v3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M2 12h3M19 12h3M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"></path></svg>';
    }
    return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3" y="5" width="18" height="12" rx="2.5" ry="2.5" stroke="currentColor" stroke-width="1.8" fill="none"></rect><path d="M8 20h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"></path></svg>';
  }

  function refreshThemeControls() {
    const panel = document.getElementById(CONFIG.panelId);
    if (!panel) return;

    panel.setAttribute('data-theme-mode', state.themeMode);
    panel.setAttribute('data-resolved-theme', state.resolvedTheme);

    const themeBtn = panel.querySelector('.asu-theme');
    if (themeBtn) {
      const label = THEME_LABELS[state.themeMode] || 'Tema';
      themeBtn.setAttribute('aria-label', `${label}. Clic para cambiar tema.`);
      themeBtn.setAttribute('title', `${label}. Clic: auto → oscuro → claro.`);
      themeBtn.innerHTML = `${getThemeIconSvg(state.themeMode)}<span class="asu-sr">${escapeHtml(label)}</span>`;
    }
  }

  function applyTheme() {
    state.resolvedTheme = getResolvedTheme();
    document.documentElement.setAttribute('data-__asu-theme', state.resolvedTheme);
    document.documentElement.setAttribute('data-__asu-theme-mode', state.themeMode);
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
    const status = panel.querySelector('.asu-status');
    if (status && status.textContent !== text) status.textContent = text;
  }

  function updateButtons() {
    const panel = document.getElementById(CONFIG.panelId);
    if (!panel) return;
    const armBtn = panel.querySelector('.asu-arm');
    const cancelBtn = panel.querySelector('.asu-cancel');
    if (armBtn) {
      armBtn.textContent = state.armed ? 'Armado: enviará al estar listo' : 'Auto enviar al estar listo';
      armBtn.classList.toggle('is-armed', state.armed);
      armBtn.disabled = state.armed;
    }
    if (cancelBtn) cancelBtn.disabled = !state.armed;
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
    setStatus('Enviando solicitud desde el compositor...');

    try {
      fresh.button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    } catch (_) {}

    fresh.button.click();

    state.armed = false;
    stopWatching();
    updateButtons();
    setStatus('Solicitud enviada. Auto envío desactivado.');
  }

  function checkAutoSend() {
    if (!state.armed || state.sent) return;
    const readiness = getReadiness();
    setStatus(readiness.message);
    if (readiness.ready) setTimeout(clickSendOnce, 120);
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
      attributeFilter: ['disabled', 'aria-disabled', 'aria-label', 'title', 'data-testid', 'data-state', 'class', 'href', 'download'],
    });

    state.pollTimer = setInterval(checkAutoSend, CONFIG.checkEveryMs);
    checkAutoSend();
  }

  function armAutoSend() {
    state.armed = true;
    state.sent = false;
    updateButtons();
    setStatus('Auto envío armado. Solo se aceptará el botón de envío dentro del compositor.');
    startWatching();
  }

  function cancelAutoSend() {
    state.armed = false;
    state.sent = false;
    stopWatching();
    updateButtons();
    setStatus('Auto envío cancelado.');
  }

  function nameFromUrl(url) {
    try {
      const clean = String(url || '').split('#')[0].split('?')[0];
      const last = decodeURIComponent(clean.split('/').pop() || '');
      return last || '';
    } catch (_) {
      return '';
    }
  }

  function extractDownloadName(el) {
    const direct = normalizeText(el.getAttribute('download'));
    if (direct && FILE_EXT_RE.test(direct)) return direct;

    const text = normalizeText(el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || '');
    const textMatch = text.match(/[^\s/\\]+\.(?:user\.js|js|txt|md|pdf|docx|doc|xlsx|xls|pptx|ppt|csv|json|zip|rar|7z|png|jpe?g|webp|gif|svg|html|css|py|ipynb|xml|yaml|yml)\b/i);
    if (textMatch) return textMatch[0];

    const href = el.getAttribute('href') || el.closest('a[href]')?.getAttribute('href') || '';
    const fromUrl = nameFromUrl(href);
    if (fromUrl && FILE_EXT_RE.test(fromUrl)) return fromUrl;

    return text || fromUrl || 'archivo descargable';
  }

  function findDownloadableArtifacts() {
    const roots = [...document.querySelectorAll('main, [role="main"]')];
    const root = roots[0] || document.body;

    const raw = [...root.querySelectorAll('a[href], a[download], button, [role="button"]')]
      .filter((el) => !el.closest(`#${CONFIG.panelId}`))
      .filter((el) => !el.closest('form, [data-testid="composer"], [data-testid*="composer"]'))
      .filter(isVisible);

    const results = [];
    const seen = new Set();

    raw.forEach((el) => {
      const link = el.matches('a[href], a[download]') ? el : el.closest('a[href], a[download]') || el;
      const text = fullElementText(link);
      const href = link.getAttribute('href') || '';
      const likely =
        link.matches('a[download]') ||
        FILE_EXT_RE.test(text) ||
        (href && DOWNLOAD_HINT_RE.test(href) && !href.startsWith('#'));

      if (!likely) return;

      const key = `${href}|${normalizeText(link.textContent)}|${link.getAttribute('download') || ''}`;
      if (seen.has(key)) return;
      seen.add(key);

      const rect = link.getBoundingClientRect();
      results.push({
        el: link,
        name: extractDownloadName(link),
        href,
        top: rect.top + window.scrollY,
        left: rect.left + window.scrollX,
      });
    });

    results.sort((a, b) => a.top - b.top || a.left - b.left);
    return results;
  }

  function clickDownloadItem(item) {
    if (!item || !item.el) {
      setStatus('No hay archivo descargable seleccionado.');
      return false;
    }
    try {
      item.el.scrollIntoView({ block: 'center', inline: 'nearest' });
    } catch (_) {}
    item.el.click();
    setStatus(`Descarga activada: ${item.name}`);
    return true;
  }

  function downloadLatestArtifact() {
    const items = findDownloadableArtifacts();
    state.downloads = items;
    state.downloadsScanned = true;
    if (!items.length) state.downloadsExpanded = false;
    renderDownloadList();
    if (!items.length) {
      setStatus('No encontré enlaces descargables visibles en la conversación.');
      return;
    }
    clickDownloadItem(items[items.length - 1]);
  }

  function scanDownloads() {
    const firstScan = !state.downloadsScanned;
    state.downloads = findDownloadableArtifacts();
    state.downloadsScanned = true;
    state.downloadsExpanded = state.downloads.length > 0 && (firstScan ? true : !state.downloadsExpanded);
    renderDownloadList();

    if (!state.downloads.length) {
      setStatus('No encontré enlaces descargables visibles. Si están más arriba, desplázate y vuelve a escanear.');
      return;
    }

    setStatus(state.downloadsExpanded
      ? `Encontré ${state.downloads.length} archivo(s) descargable(s) visible(s). Lista desplegada.`
      : `Encontré ${state.downloads.length} archivo(s) descargable(s) visible(s). Lista resumida.`);
  }

  function updateDownloadToggleButton() {
    const panel = document.getElementById(CONFIG.panelId);
    if (!panel) return;
    const scanBtn = panel.querySelector('.asu-scan');
    if (!scanBtn) return;

    if (!state.downloadsScanned) {
      scanBtn.textContent = 'Listar archivos';
      scanBtn.setAttribute('aria-expanded', 'false');
      scanBtn.setAttribute('title', 'Escanear archivos descargables visibles');
      return;
    }

    scanBtn.textContent = state.downloadsExpanded ? 'Ocultar lista' : 'Mostrar lista';
    scanBtn.setAttribute('aria-expanded', state.downloadsExpanded ? 'true' : 'false');
    scanBtn.setAttribute('title', state.downloadsExpanded
      ? 'Resumir y ocultar la lista de archivos'
      : 'Actualizar y desplegar la lista de archivos');
  }

  function renderDownloadList() {
    const panel = document.getElementById(CONFIG.panelId);
    if (!panel) return;
    const summary = panel.querySelector('.asu-download-summary');
    const box = panel.querySelector('.asu-download-list');
    if (!summary || !box) return;

    box.textContent = '';

    const count = state.downloads.length;
    const hasDownloads = count > 0;
    const latestName = hasDownloads ? state.downloads[count - 1].name : '';

    if (!state.downloadsScanned) {
      summary.textContent = 'Pulsa “Listar archivos”.';
      box.hidden = true;
      updateDownloadToggleButton();
      return;
    }

    if (!hasDownloads) {
      summary.textContent = 'Sin archivos detectados en el DOM visible.';
      box.hidden = true;
      updateDownloadToggleButton();
      return;
    }

    summary.textContent = state.downloadsExpanded
      ? `Mostrando ${count} archivo(s) detectado(s).`
      : `${count} archivo(s) detectado(s). Último: ${latestName}`;

    box.hidden = !state.downloadsExpanded;

    state.downloads.forEach((item, absoluteIndex) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'asu-download-row';
      row.dataset.index = String(absoluteIndex);
      row.title = item.href || item.name;
      row.textContent = item.name;
      row.addEventListener('click', () => clickDownloadItem(state.downloads[absoluteIndex]));
      box.appendChild(row);
    });

    updateDownloadToggleButton();
  }

  function ensureStyle() {
    if (document.getElementById(CONFIG.styleId)) return;

    const style = document.createElement('style');
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
        --asu-danger: #fca5a5;
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
        --asu-danger: #b91c1c;
        --asu-shadow: 0 18px 38px rgba(15, 23, 42, 0.16);
      }

      #${CONFIG.panelId} {
        position: fixed;
        left: 18px;
        bottom: 18px;
        width: 376px;
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
        font: 13px/1.35 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      #${CONFIG.panelId}, #${CONFIG.panelId} * { box-sizing: border-box; }

      #${CONFIG.panelId}.is-minimized .asu-body { display: none; }

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
        font-weight: 760;
        letter-spacing: -0.01em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      #${CONFIG.panelId} .asu-subtitle {
        color: var(--asu-text-muted);
        font-size: 11px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      #${CONFIG.panelId} .asu-head-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        flex: 0 0 auto;
      }

      #${CONFIG.panelId} .asu-icon-btn {
        width: 31px;
        height: 31px;
        display: inline-grid;
        place-items: center;
        appearance: none;
        border: 1px solid var(--asu-border);
        border-radius: 11px;
        background: var(--asu-surface);
        color: var(--asu-text-soft);
        cursor: pointer;
      }

      #${CONFIG.panelId} .asu-icon-btn:hover {
        background: var(--asu-surface-2);
        color: var(--asu-text);
      }

      #${CONFIG.panelId} .asu-icon-btn svg {
        width: 17px;
        height: 17px;
      }

      #${CONFIG.panelId} .asu-body {
        padding: 12px;
        display: grid;
        gap: 10px;
      }

      #${CONFIG.panelId} .asu-status {
        min-height: 38px;
        padding: 10px 11px;
        border-radius: 13px;
        border: 1px solid var(--asu-border);
        background: var(--asu-surface-3);
        color: var(--asu-text-soft);
        font-size: 12px;
        white-space: pre-wrap;
      }

      #${CONFIG.panelId} .asu-actions {
        display: grid;
        grid-template-columns: 1fr 0.72fr;
        gap: 8px;
      }

      #${CONFIG.panelId} .asu-download-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }

      #${CONFIG.panelId} .asu-btn {
        appearance: none;
        border: 1px solid var(--asu-border);
        border-radius: 12px;
        background: var(--asu-surface);
        color: var(--asu-text);
        padding: 9px 10px;
        font-size: 12.5px;
        font-weight: 650;
        cursor: pointer;
      }

      #${CONFIG.panelId} .asu-btn:hover:not(:disabled) {
        background: var(--asu-surface-2);
        border-color: var(--asu-border-strong);
      }

      #${CONFIG.panelId} .asu-btn:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }

      #${CONFIG.panelId} .asu-arm.is-armed {
        background: var(--asu-primary-soft);
        border-color: var(--asu-border-strong);
        color: var(--asu-primary);
      }

      #${CONFIG.panelId} .asu-divider {
        height: 1px;
        background: var(--asu-border);
        margin: 2px 0;
      }

      #${CONFIG.panelId} .asu-download-summary {
        min-height: 35px;
        padding: 9px 10px;
        border-radius: 11px;
        border: 1px solid var(--asu-border);
        background: var(--asu-surface-3);
        color: var(--asu-text-soft);
        font-size: 12px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      #${CONFIG.panelId} .asu-download-list {
        max-height: 220px;
        overflow-y: auto;
        overflow-x: hidden;
        overscroll-behavior: contain;
        display: grid;
        gap: 6px;
        padding-right: 2px;
      }

      #${CONFIG.panelId} .asu-download-list[hidden] {
        display: none !important;
      }

      #${CONFIG.panelId} .asu-download-row {
        width: 100%;
        text-align: left;
        appearance: none;
        border: 1px solid var(--asu-border);
        border-radius: 11px;
        background: var(--asu-surface-3);
        color: var(--asu-text-soft);
        padding: 8px 9px;
        cursor: pointer;
        font-size: 12px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      #${CONFIG.panelId} .asu-download-row:hover {
        border-color: var(--asu-border-strong);
        color: var(--asu-text);
      }

      #${CONFIG.panelId} .asu-download-empty {
        color: var(--asu-text-muted);
        border: 1px dashed var(--asu-border);
        border-radius: 11px;
        padding: 9px;
        font-size: 12px;
      }

      #${CONFIG.panelId} .asu-note {
        color: var(--asu-text-muted);
        font-size: 11.5px;
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
          bottom: 8px;
          width: calc(100vw - 16px);
          max-width: calc(100vw - 16px);
        }
      }
    `;
    document.documentElement.appendChild(style);
  }

  function ensurePanel() {
    let panel = document.getElementById(CONFIG.panelId);
    if (panel) return panel;

    ensureStyle();

    panel = document.createElement('div');
    panel.id = CONFIG.panelId;
    panel.innerHTML = `
      <div class="asu-head">
        <div class="asu-title-wrap">
          <div class="asu-title">Auto enviar seguro</div>
          <div class="asu-subtitle">Envío y descargas aislados · v${escapeHtml(CONFIG.version)}</div>
        </div>
        <div class="asu-head-actions">
          <button class="asu-icon-btn asu-theme" type="button" aria-label="Tema"></button>
          <button class="asu-icon-btn asu-min" type="button" aria-label="Minimizar" title="Minimizar">−</button>
        </div>
      </div>
      <div class="asu-body">
        <div class="asu-status">Listo. El autoenvío solo buscará botones dentro del compositor.</div>
        <div class="asu-actions">
          <button class="asu-btn asu-arm" type="button">Auto enviar al estar listo</button>
          <button class="asu-btn asu-cancel" type="button" disabled>Cancelar</button>
        </div>
        <div class="asu-divider"></div>
        <div class="asu-download-actions">
          <button class="asu-btn asu-scan" type="button">Listar archivos</button>
          <button class="asu-btn asu-download-last" type="button">Descargar último</button>
        </div>
        <div class="asu-download-summary">Pulsa “Listar archivos”.</div>
        <div class="asu-download-list" hidden></div>
        <div class="asu-note">Las descargas se detectan solo en mensajes visibles/cargados en el DOM. Para archivos antiguos, desplázate hasta esa zona y vuelve a listar.</div>
      </div>
    `;

    document.body.appendChild(panel);

    try {
      if (localStorage.getItem(STORAGE_KEYS.minimized) === '1') {
        panel.classList.add('is-minimized');
        panel.querySelector('.asu-min').textContent = '+';
      }
    } catch (_) {}

    panel.querySelector('.asu-theme')?.addEventListener('click', cycleThemeMode);
    panel.querySelector('.asu-min')?.addEventListener('click', () => {
      panel.classList.toggle('is-minimized');
      const minimized = panel.classList.contains('is-minimized');
      panel.querySelector('.asu-min').textContent = minimized ? '+' : '−';
      try {
        localStorage.setItem(STORAGE_KEYS.minimized, minimized ? '1' : '0');
      } catch (_) {}
    });
    panel.querySelector('.asu-arm')?.addEventListener('click', armAutoSend);
    panel.querySelector('.asu-cancel')?.addEventListener('click', cancelAutoSend);
    panel.querySelector('.asu-scan')?.addEventListener('click', scanDownloads);
    panel.querySelector('.asu-download-last')?.addEventListener('click', downloadLatestArtifact);

    refreshThemeControls();
    updateButtons();
    renderDownloadList();
    return panel;
  }

  function boot() {
    loadUiPreferences();
    applyTheme();

    if (COLOR_SCHEME_QUERY) {
      const onSchemeChange = () => {
        if (state.themeMode === 'auto') applyTheme();
      };
      if (COLOR_SCHEME_QUERY.addEventListener) COLOR_SCHEME_QUERY.addEventListener('change', onSchemeChange);
      else if (COLOR_SCHEME_QUERY.addListener) COLOR_SCHEME_QUERY.addListener(onSchemeChange);
    }

    const timer = setInterval(() => {
      if (!document.body) return;
      ensurePanel();
      clearInterval(timer);
    }, 200);
  }

  boot();
})();

(() => {
  'use strict';

  const VERSION = '1.1.0';
  const LOG = '[Calebe Helper Core]';
  if (window.CalebeCore?.version === VERSION) return;

  const listeners = new Set();
  const knownFrames = new Set();
  const originalGetElementById = Document.prototype.getElementById;
  let activeFrame = null;
  let activeDocument = null;
  let scheduled = false;
  let compatibilityInstalled = false;

  function originalById(id) {
    return originalGetElementById.call(document, id);
  }

  function isVisible(frame) {
    if (!frame?.isConnected) return false;
    let node = frame;
    while (node && node !== document.documentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      node = node.parentElement;
    }
    const rect = frame.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function hasActiveAncestor(frame) {
    let node = frame;
    while (node && node !== document.body) {
      if (node.classList?.contains('active') || node.classList?.contains('show') ||
          node.getAttribute?.('aria-selected') === 'true' ||
          node.getAttribute?.('aria-hidden') === 'false') return true;
      node = node.parentElement;
    }
    return false;
  }

  function getCandidateFrames() {
    const frames = [...document.querySelectorAll('iframe[data-aba], iframe.aba-frame')];
    const main = originalById('mainIframe');
    if (main && !frames.includes(main)) frames.push(main);
    for (const frame of frames) knownFrames.add(frame);
    return frames.filter(frame => {
      if (!frame.isConnected) return false;
      try { return !!frame.contentDocument; } catch (_) { return false; }
    });
  }

  function getActiveFrame() {
    const candidates = getCandidateFrames();
    if (candidates.length) {
      const visible = candidates.filter(isVisible);
      if (visible.length) {
        visible.sort((a, b) => Number(hasActiveAncestor(b)) - Number(hasActiveAncestor(a)));
        return visible[0];
      }
      const marked = candidates.filter(frame => frame.classList.contains('active') ||
        frame.closest('.active, .show, [aria-selected="true"]') ||
        frame.getAttribute('aria-hidden') === 'false');
      if (marked.length) return marked[marked.length - 1];
    }
    return originalById('mainIframe');
  }

  function dispatchCompatibilityRefresh() {
    // Legacy modules listen for load on the iframe they found at startup.
    // Notify known frames so their existing handlers re-read the active iframe.
    for (const frame of [...knownFrames]) {
      if (!frame.isConnected) { knownFrames.delete(frame); continue; }
      try { frame.dispatchEvent(new Event('load')); } catch (_) {}
    }
  }

  function notify(force = false) {
    scheduled = false;
    const frame = getActiveFrame();
    let doc = null;
    try { doc = frame?.contentDocument || null; } catch (_) {}
    if (!force && frame === activeFrame && doc === activeDocument) return;

    const changed = activeFrame !== null || activeDocument !== null;
    activeFrame = frame || null;
    activeDocument = doc;
    const detail = { frame: activeFrame, document: activeDocument, url: activeDocument?.location?.href || '' };

    for (const callback of [...listeners]) {
      try { callback(detail); }
      catch (error) { console.error(LOG, 'Erro em um observador de página:', error); }
    }
    if (changed) dispatchCompatibilityRefresh();
  }

  function scheduleNotify() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => notify());
  }

  function onActiveFrameChange(callback, options = {}) {
    if (typeof callback !== 'function') throw new TypeError('callback precisa ser uma função.');
    listeners.add(callback);
    if (options.immediate !== false) {
      try {
        const frame = getActiveFrame();
        let doc = null;
        try { doc = frame?.contentDocument || null; } catch (_) {}
        callback({ frame: frame || null, document: doc, url: doc?.location?.href || '' });
      } catch (error) {
        console.error(LOG, 'Erro ao iniciar observador de página:', error);
      }
    }
    return () => listeners.delete(callback);
  }

  function installLegacyCompatibility() {
    if (compatibilityInstalled) return;
    compatibilityInstalled = true;
    // Content scripts run in an isolated world, so this compatibility shim
    // affects extension modules without replacing the site's page-world API.
    const original = Document.prototype.getElementById;
    Document.prototype.getElementById = function(id) {
      if (id === 'mainIframe' && this === document) {
        const active = getActiveFrame();
        if (active) return active;
      }
      return original.call(this, id);
    };
  }

  const api = {
    version: VERSION,
    getActiveFrame,
    getActiveDocument() {
      const frame = getActiveFrame();
      try { return frame?.contentDocument || null; } catch (_) { return null; }
    },
    onActiveFrameChange,
    refresh: () => notify(true)
  };

  Object.defineProperty(window, 'CalebeCore', {
    value: api, configurable: false, enumerable: false, writable: false
  });
  installLegacyCompatibility();

  const observer = new MutationObserver(scheduleNotify);
  observer.observe(document.documentElement, {
    childList: true, subtree: true, attributes: true,
    attributeFilter: ['class', 'style', 'src', 'data-aba', 'aria-selected', 'aria-hidden']
  });
  document.addEventListener('load', event => {
    if (event.target instanceof HTMLIFrameElement) scheduleNotify();
  }, true);
  window.addEventListener('pageshow', scheduleNotify);
  window.addEventListener('focus', scheduleNotify);
  scheduleNotify();
  console.info(LOG, `Centralizador ativo (v${VERSION}), compatibilidade legada habilitada.`);
})();

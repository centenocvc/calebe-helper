(() => {
  'use strict';
  if (window.top !== window.self) return;

  const PENDING_KEY = 'calebeHelperCaixaCarregarMaisV1';
  const MAX_LOAD_MORE_CLICKS = 4;
  const RETRY_DELAY_MS = 2000;
  const observedDocuments = new WeakSet();
  let observedFrame = null;
  let observedDocument = null;
  let documentObserver = null;
  let pendingLoad = null;

  function readPending() {
    try {
      const pending = JSON.parse(window.sessionStorage.getItem(PENDING_KEY) || 'null');
      return pending && Number.isInteger(Number(pending.davId)) ? pending : null;
    } catch {
      return null;
    }
  }

  function writePending(pending) {
    try {
      window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
      return true;
    } catch {
      return false;
    }
  }

  function clearPending() {
    try { window.sessionStorage.removeItem(PENDING_KEY); } catch { }
    if (pendingLoad?.timer) window.clearTimeout(pendingLoad.timer);
    pendingLoad = null;
  }

  function extractDavId(row) {
    const formatted = String(row?.textContent || '').match(/\b\d{3}-(\d{5,})\b/);
    if (formatted) return Number(formatted[1]) || null;

    const onclicks = [
      row?.getAttribute?.('onclick'),
      ...[...(row?.querySelectorAll?.('[onclick]') || [])]
        .map(element => element.getAttribute('onclick'))
    ];

    for (const onclick of onclicks) {
      const match = String(onclick || '').match(
        /(?:duplicarDav|abrirDav|selecionarLinha)\s*\(\s*(?:this\s*,\s*)?(\d+)/
      );
      if (match) return Number(match[1]) || null;
    }

    return null;
  }

  function onListClick(doc, event) {
    const ElementCtor = doc.defaultView?.Element;
    const target = ElementCtor && event.target instanceof ElementCtor ? event.target : null;
    const button = target?.closest('.calebe-helper-caixa-dav');
    if (!button) return;

    const davId = extractDavId(button.closest('tr'));
    if (!davId) return;

    if (pendingLoad?.timer) window.clearTimeout(pendingLoad.timer);
    pendingLoad = null;
    writePending({ davId, clicks: 0 });
  }

  function findDavLink(doc, davId) {
    return [...doc.querySelectorAll('a[onclick*="abrirCaixaDav("]')].find(link => {
      const match = String(link.getAttribute('onclick') || '').match(/abrirCaixaDav\s*\(\s*(\d+)\s*,\s*1/);
      return match && Number(match[1]) === davId;
    });
  }

  function countDavLinks(doc) {
    return doc.querySelectorAll('a[onclick*="abrirCaixaDav("]').length;
  }

  function tryLoadOlderDav(doc) {
    const pending = readPending();
    if (!pending || !/\/modulos\/nfe001\/nfe001\.php$/i.test(doc.location.pathname)) return;

    const davId = Number(pending.davId);
    if (findDavLink(doc, davId)) {
      clearPending();
      return;
    }

    if (pendingLoad?.doc === doc) {
      if (countDavLinks(doc) <= pendingLoad.linksBefore) return;
      window.clearTimeout(pendingLoad.timer);
      pendingLoad = null;
    }

    if (Number(pending.clicks) >= MAX_LOAD_MORE_CLICKS) {
      console.warn(`[Calebe Helper] DAV ${davId} não apareceu após ${MAX_LOAD_MORE_CLICKS} cliques em Carregar mais.`);
      clearPending();
      return;
    }

    const loadMoreButton = doc.getElementById('btnCarregarMais');
    if (!loadMoreButton || loadMoreButton.disabled) return;

    const nextPending = { davId, clicks: Number(pending.clicks) + 1 };
    if (!writePending(nextPending)) return;

    pendingLoad = {
      doc,
      linksBefore: countDavLinks(doc),
      timer: window.setTimeout(() => {
        pendingLoad = null;
        tryLoadOlderDav(doc);
      }, RETRY_DELAY_MS)
    };
    loadMoreButton.click();
  }

  function attachDocument(doc) {
    if (!doc?.documentElement || observedDocuments.has(doc)) return;
    observedDocuments.add(doc);
    doc.addEventListener('click', event => onListClick(doc, event), true);
  }

  function observeFrame() {
    const frame = document.getElementById('mainIframe');
    if (frame && frame !== observedFrame) {
      observedFrame = frame;
      frame.addEventListener('load', observeFrame);
    }

    let doc;
    try { doc = frame?.contentDocument || null; } catch { doc = null; }
    if (!doc?.documentElement) return;

    attachDocument(doc);
    if (doc !== observedDocument) {
      documentObserver?.disconnect();
      observedDocument = doc;
      documentObserver = new MutationObserver(() => tryLoadOlderDav(doc));
      documentObserver.observe(doc.documentElement, { childList: true, subtree: true });
    }
    tryLoadOlderDav(doc);
  }

  observeFrame();
  new MutationObserver(observeFrame).observe(document.documentElement, { childList: true, subtree: true });
})();

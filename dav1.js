(() => {
  'use strict';
  if (window.top !== window.self) return;

  const davClients = new Map();
  const clientDetails = new Map();
  const failedClientDetails = new Map();
  const CLIENT_DETAIL_RETRY_MS = 60000;
  const WAIT_SEARCH_RESULT_MS = 2000;
  const SEARCH_RETRY_MS = 2500;
  const SEARCH_PAGE_TIMEOUT_MS = 30000;
  const WAIT_EMIT_FILTER_MS = 400;
  const detailRequests = new Map();
  let observedFrame = null;
  let observedDocument = null;
  let documentObserver = null;
  let pendingCaixaDavId = null;
  let pendingCaixaSearch = null;
  let pendingCaixaTimer = 0;

  const getFrame = () => document.getElementById('mainIframe');
  const getFrameDocument = () => {
    try { return getFrame()?.contentDocument || null; } catch { return null; }
  };

  function command(doc, action, payload = {}, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const id = `dav1-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      let timer;
      const handler = event => {
        if (event.detail?.id !== id) return;
        clearTimeout(timer);
        doc.removeEventListener('calebe-helper:command-result', handler);
        event.detail.ok ? resolve(event.detail) : reject(new Error(event.detail.error || 'Falha no comando.'));
      };
      doc.addEventListener('calebe-helper:command-result', handler);
      doc.dispatchEvent(new CustomEvent('calebe-helper:command', { detail: { id, action, ...payload } }));
      timer = setTimeout(() => {
        doc.removeEventListener('calebe-helper:command-result', handler);
        reject(new Error(`Timeout: ${action}`));
      }, timeout);
    });
  }

  function isDavList(doc) {
    return [...doc.querySelectorAll('h6')].some(element => /DAV01\s*[—-]\s*Documento Auxiliar de Venda/i.test(element.textContent || ''));
  }

  function isDavListRobust(doc) {
    return [...doc.querySelectorAll('h6')].some(element =>
      /DAV01[\s\S]{0,40}Documento Auxiliar de Venda/i.test(element.textContent || '')
    );
  }

  function installClientHintStyles(doc) {
    if (doc.getElementById('calebe-helper-client-hint-style')) return;
    const style = doc.createElement('style');
    style.id = 'calebe-helper-client-hint-style';
    style.textContent = `
      .calebe-helper-client-cell{display:flex;align-items:center;gap:7px;min-width:0}
      .calebe-helper-client-code{flex:0 0 auto;padding:2px 6px;border-radius:4px;background:#0d6efd;color:#fff;font-size:.68rem;font-weight:700;white-space:nowrap}
      .calebe-helper-client-info{min-width:0;line-height:1.15}
      .calebe-helper-client-name{font-weight:600}
      .calebe-helper-client-details{margin-top:2px;font-size:.66rem;color:#6c757d;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    `;
    (doc.head || doc.documentElement).appendChild(style);
  }

  /*   function extractDavId(row) {
      const formatted = String(row?.textContent || '').match(/\b\d{3}-(\d{5})\b/);
      if (formatted) return Number(formatted[1]) || null;
      const selected = String(row?.getAttribute?.('onclick') || '').match(/selecionarLinha\s*\(\s*this\s*,\s*(\d+)/);
      return selected ? Number(selected[1]) || null : null;
    } */


  function extractDavId(row) {
    const formatted = String(row?.textContent || '')
      .match(/\b\d{3}-(\d{5,})\b/);

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



  function applyDavMap(rows = []) {
    for (const item of rows) {
      const davId = Number(item?.davId);
      const clientCode = String(item?.clientCode || '').trim();
      if (davId > 0 && clientCode) davClients.set(davId, { clientCode, clientName: String(item.clientName || '').trim() });
    }
  }

  function readDavMap(doc) {
    try {
      const rows = JSON.parse(doc.documentElement?.dataset?.calebeHelperDavClients || '[]');
      if (Array.isArray(rows)) applyDavMap(rows);
    } catch { }
  }

  async function getClientDetails(doc, code) {
    if (clientDetails.has(code)) return clientDetails.get(code);
    if (detailRequests.has(code)) return detailRequests.get(code);
    const request = command(doc, 'get-client-details', { code }).then(result => {
      if (result.row?.ClienteCodigo) clientDetails.set(code, result.row);
      return result.row || null;
    }).finally(() => detailRequests.delete(code));
    detailRequests.set(code, request);
    return request;
  }

  function recentlyFailedClientDetails(code) {
    const failedAt = failedClientDetails.get(String(code));
    return Number.isFinite(failedAt) && Date.now() - failedAt < CLIENT_DETAIL_RETRY_MS;
  }

  function buildDetails(row) {
    const address = [row.ClienteLogradouro, Number(row.ClienteNumero) > 0 ? row.ClienteNumero : '', row.ClienteComplemento, row.ClienteBairro]
      .filter(value => String(value || '').trim()).join(', ');
    const city = [row.ClienteMunicipio, row.ClienteUf].filter(Boolean).join(' / ');
    const documentLabel = row.ClienteCGC ? `${row.ClienteTipoPessoa === 'PJ' ? 'CNPJ' : 'CPF'} ${row.ClienteCGC}` : '';
    return [[address, city].filter(Boolean).join(' — '), documentLabel].filter(Boolean).join(' — ');
  }

  function renderClientCell(cell, row, fallbackName) {
    const code = String(row.ClienteCodigo || '').trim();
    const name = String(row.ClienteRazaoSocial || fallbackName || '').trim();
    const details = buildDetails(row);
    const key = `${code}\n${name}\n${details}`;
    if (cell.dataset.calebeHelperClientHintKey === key) return;
    cell.dataset.calebeHelperClientHintKey = key;
    cell.textContent = '';
    const wrapper = cell.ownerDocument.createElement('div');
    wrapper.className = 'calebe-helper-client-cell';
    const badge = cell.ownerDocument.createElement('span');
    badge.className = 'calebe-helper-client-code';
    badge.textContent = `CÓD. ${code}`;
    const info = cell.ownerDocument.createElement('div');
    info.className = 'calebe-helper-client-info';
    const nameElement = cell.ownerDocument.createElement('div');
    nameElement.className = 'calebe-helper-client-name';
    nameElement.textContent = name;
    info.appendChild(nameElement);
    if (details) {
      const detailElement = cell.ownerDocument.createElement('div');
      detailElement.className = 'calebe-helper-client-details';
      detailElement.textContent = details;
      info.appendChild(detailElement);
    }
    wrapper.append(badge, info);
    cell.appendChild(wrapper);
  }

  function installClientHints(doc) {
    if (!isDavListRobust(doc)) return;
    installClientHintStyles(doc);
    readDavMap(doc);
    const rows = [...doc.querySelectorAll('tr')].filter(row => row.querySelector('button[onclick*="duplicarDav("]'));
    for (const row of rows) {
      const davId = extractDavId(row);
      const mapped = davClients.get(davId);
      const cells = [...row.children].filter(element => element.tagName === 'TD');
      const cell = cells[0]?.querySelector('button[onclick*="duplicarDav("]') ? cells[1] : row.querySelector('.td-razao');
      if (!mapped || !cell || cell.dataset.calebeHelperClientLoading === mapped.clientCode) continue;
      if (recentlyFailedClientDetails(mapped.clientCode)) continue;
      cell.dataset.calebeHelperClientLoading = mapped.clientCode;
      getClientDetails(doc, mapped.clientCode)
        .then(details => {
          failedClientDetails.delete(mapped.clientCode);
          if (details) renderClientCell(cell, details, mapped.clientName);
        })
        .catch(() => {
          // Os detalhes adicionais são apenas um aprimoramento visual.
          // Se a consulta falhar, mantemos a célula nativa intacta e
          // aguardamos CLIENT_DETAIL_RETRY_MS antes de tentar novamente.
          failedClientDetails.set(mapped.clientCode, Date.now());
        })
        .finally(() => {
          // Libera sempre o marcador de carregamento. O bloqueio temporário
          // de novas tentativas é controlado por failedClientDetails.
          delete cell.dataset.calebeHelperClientLoading;
        });
    }
  }

  function isNfeCaixaDoc(doc) {
    return /\/modulos\/nfe001\/nfe001\.php$/i.test(String(doc?.location?.pathname || ''));
  }

  function findEmitCaixaLink(doc, davId) {
    return [...doc.querySelectorAll('a[onclick*="abrirCaixaDav("]')].find(link => {
      const match = String(link.getAttribute('onclick') || '').match(/abrirCaixaDav\s*\(\s*(\d+)\s*,\s*1/);
      return match && Number(match[1]) === davId;
    }) || null;
  }

  function davPresentInListing(doc, davId) {
    const id = Number(davId);
    if (!Number.isFinite(id)) return false;

    for (const link of doc.querySelectorAll('a[onclick*="abrirCaixaDav("]')) {
      const match = String(link.getAttribute('onclick') || '').match(/abrirCaixaDav\s*\(\s*(\d+)/);
      if (match && Number(match[1]) === id) return true;
    }

    for (const row of doc.querySelectorAll('tr')) {
      const actions = [
        row.getAttribute('onclick'),
        ...[...row.querySelectorAll('[onclick]')].map(element => element.getAttribute('onclick'))
      ];
      for (const action of actions) {
        const match = String(action || '').match(
          /(?:abrirCaixaDav|duplicarDav|abrirDav|selecionarLinha)\s*\(\s*(?:this\s*,\s*)?(\d+)/
        );
        if (match && Number(match[1]) === id) return true;
      }

      const formatted = String(row.textContent || '').match(/\b\d{3}-(\d{5,})\b/);
      if (formatted && Number(formatted[1]) === id) return true;
    }

    return false;
  }

  function selectEmitMode(doc) {
    const mode = doc.getElementById('filtAcao');
    if (!mode) return false;
    if (String(mode.value || '').toLowerCase() === 'emitir') return false;

    const option = [...mode.options].find(item => String(item.value || '').toLowerCase() === 'emitir')
      || [...mode.options].find(item => /^\s*emitir\s*$/i.test(String(item.textContent || '')));
    if (!option) return false;

    mode.value = option.value;
    mode.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
    return true;
  }

  function schedulePendingCaixaCheck(delay = 500) {
    if (pendingCaixaTimer) window.clearTimeout(pendingCaixaTimer);
    pendingCaixaTimer = window.setTimeout(() => {
      pendingCaixaTimer = 0;
      if (pendingCaixaDavId) observeFrame();
    }, Math.max(0, Number(delay) || 0));
  }

  function clearPendingCaixaCheck() {
    if (pendingCaixaTimer) window.clearTimeout(pendingCaixaTimer);
    pendingCaixaTimer = 0;
  }

  function openCaixaDav(davId) {
    const id = Number(davId);
    const link = document.querySelector('a[href*="modulos/nfe001/nfe001.php"]');
    if (!Number.isFinite(id) || id <= 0 || !link) {
      throw new Error('DAV ou link do Emissor NF-e não encontrado.');
    }
    pendingCaixaDavId = id;
    clearPendingCaixaCheck();
    pendingCaixaSearch = {
      createdAt: Date.now(),
      searchedAt: 0,
      lastRetryAt: 0,
      confirmedAt: 0,
      emitSelectedAt: 0,
      emitDoc: null,
      emitSearchedAt: 0,
      reemitAt: 0,
    };
    link.click();
    return true;
  }

  function requestCaixa(row) {
    const davId = extractDavId(row);
    if (!davId) throw new Error('DAV não encontrado na listagem.');
    openCaixaDav(davId);
  }



  function installCaixaButtons(doc) {
    if (!isDavListRobust(doc)) return;
    for (const duplicateButton of doc.querySelectorAll('button[onclick*="duplicarDav("]')) {
      if (duplicateButton.parentElement?.querySelector('.calebe-helper-caixa-dav')) continue;
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'ms-1 btn btn-success btn-sm calebe-helper-caixa-dav';
      button.title = 'Caixa DAV';
      button.innerHTML = '<i class="bi bi-cash-coin"></i>';
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        try { requestCaixa(duplicateButton.closest('tr')); }
        catch (error) { /* console.error('[Calebe Helper] Falha ao abrir caixa da DAV.', error) */ void 0; }
      });
      duplicateButton.insertAdjacentElement('afterend', button);
    }
  }

  function openPendingCaixa(doc) {
    if (!pendingCaixaDavId || !isNfeCaixaDoc(doc)) return;

    const search = pendingCaixaSearch;
    if (!search) {
      const link = findEmitCaixaLink(doc, pendingCaixaDavId);
      if (!link) return;
      pendingCaixaDavId = null;
      clearPendingCaixaCheck();
      link.click();
      return;
    }

    const now = Date.now();
    if (now - search.createdAt > SEARCH_PAGE_TIMEOUT_MS) {
      pendingCaixaDavId = null;
      pendingCaixaSearch = null;
      clearPendingCaixaCheck();
      return;
    }

    if (!search.searchedAt) {
      const searchButton = doc.getElementById('btnPesquisar');
      if (!searchButton || searchButton.disabled) {
        schedulePendingCaixaCheck(400);
        return;
      }
      search.searchedAt = now;
      search.lastRetryAt = now;
      searchButton.click();
      schedulePendingCaixaCheck(WAIT_SEARCH_RESULT_MS);
      return;
    }

    if (!search.confirmedAt) {
      const remaining = WAIT_SEARCH_RESULT_MS - (now - search.searchedAt);
      if (remaining > 0) {
        schedulePendingCaixaCheck(remaining);
        return;
      }

      if (davPresentInListing(doc, pendingCaixaDavId)) {
        search.confirmedAt = now;
      } else {
        if (now - search.lastRetryAt >= SEARCH_RETRY_MS) {
          const searchButton = doc.getElementById('btnPesquisar');
          if (searchButton && !searchButton.disabled) {
            search.searchedAt = now;
            search.lastRetryAt = now;
            searchButton.click();
            schedulePendingCaixaCheck(WAIT_SEARCH_RESULT_MS);
            return;
          }
        }
        schedulePendingCaixaCheck(500);
        return;
      }
    }

    if (!search.emitSelectedAt) {
      selectEmitMode(doc);
      search.emitSelectedAt = Date.now();
      search.emitDoc = doc;
      schedulePendingCaixaCheck(WAIT_EMIT_FILTER_MS);
      return;
    }

    if (search.emitDoc && search.emitDoc !== doc) {
      search.emitDoc = doc;
      search.emitSelectedAt = Date.now();
    }

    const waitEmit = WAIT_EMIT_FILTER_MS - (now - search.emitSelectedAt);
    if (waitEmit > 0) {
      schedulePendingCaixaCheck(waitEmit);
      return;
    }

    const nativeLink = findEmitCaixaLink(doc, pendingCaixaDavId);
    if (nativeLink) {
      pendingCaixaDavId = null;
      pendingCaixaSearch = null;
      clearPendingCaixaCheck();
      nativeLink.click();
      return;
    }

    if (!search.reemitAt && selectEmitMode(doc)) {
      search.reemitAt = Date.now();
      search.emitSelectedAt = Date.now();
      schedulePendingCaixaCheck(WAIT_EMIT_FILTER_MS);
      return;
    }

    if (!search.emitSearchedAt && Date.now() - search.emitSelectedAt >= WAIT_SEARCH_RESULT_MS) {
      const searchButton = doc.getElementById('btnPesquisar');
      if (searchButton && !searchButton.disabled) {
        search.emitSearchedAt = Date.now();
        searchButton.click();
        schedulePendingCaixaCheck(WAIT_SEARCH_RESULT_MS);
        return;
      }
    }

    schedulePendingCaixaCheck(500);
  }

  function install(doc) {
    if (!doc?.documentElement) return;
    installCaixaButtons(doc);
    installClientHints(doc);
    openPendingCaixa(doc);
  }

  function observeFrame() {
    const frame = getFrame();
    if (frame && frame !== observedFrame) {
      observedFrame = frame;
      frame.addEventListener('load', observeFrame);
    }
    const doc = getFrameDocument();
    if (!doc) return;
    if (doc !== observedDocument) {
      documentObserver?.disconnect();
      observedDocument = doc;
      doc.addEventListener('calebe-helper:dav-clientes', event => {
        applyDavMap(Array.isArray(event.detail) ? event.detail : []);
        installClientHints(doc);
      });
      const root = doc.documentElement;
      if (!root) return;
      documentObserver = new MutationObserver(() => install(doc));
      documentObserver.observe(root, { childList: true, subtree: true });
    }
    install(doc);
  }

  observeFrame();
  new MutationObserver(observeFrame).observe(document.documentElement, { childList: true, subtree: true });

  // Permite que outros módulos abram a Caixa DAV com o ID já confirmado pelo servidor.
  window.calebeHelperOpenCaixaDav = openCaixaDav;
})();

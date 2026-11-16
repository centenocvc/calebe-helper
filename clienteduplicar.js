// clienteduplicar.js
(() => {
  'use strict';

  const STYLE_ID = 'calebe-helper-cliente-duplicar-style';
  const BUTTON_SELECTOR = 'button.btn.btn-sm.btn-outline-primary[onclick^="duplicarRegistro("]';
  const EDIT_GROUP_CLASS = 'calebe-helper-edicao-duplicar-grupo';
  const FLOW_KEY = 'calebeHelperDuplicateClientFlowV1';
  const DUPLICATED_EDIT_KEY = 'calebeHelperDuplicatedClientEditV1';
  const PENDING_DELETE_KEY = 'calebeHelperPendingClientDeleteV1';
  const PENDING_DAV_AFTER_SAVE_KEY = 'calebeHelperPendingDavAfterClientSaveV1';
  const SAVE_DAV_GROUP_CLASS = 'calebe-helper-salvar-dav-grupo';
  const LOG = '[Calebe Duplicar]';
  const PENDING_DUPLICATE_KEY = 'calebeHelperPendingDuplicateV2';
  const FLOW_MAX_AGE_MS = 2 * 60 * 1000;
  const SAVE_CONFIRM_TIMEOUT_MS = 30 * 1000;
  let duplicateRequestBusy = false;

  let observedFrame = null;
  let observedFrameDocument = null;
  let frameObserver = null;
  let flowBusy = false;
  let overlaySuppressionActive = false;
  let overlaySuppressionReason = '';
  let overlayObserver = null;
  let deleteConfirmationDocument = null;
  let flowTimer = null;
  let saveWatchTimer = null;
  let loadHandledDocument = null;
  let flowFinishing = false;

  /* =========================================================
     ARMAZENAMENTO
     ========================================================= */

  function getStorage() {
    try {
      return window.top.sessionStorage;
    } catch {
      return window.sessionStorage;
    }
  }

  function readFlow() {
    try {
      return JSON.parse(getStorage().getItem(FLOW_KEY) || 'null');
    } catch {
      return null;
    }
  }

  function writeFlow(flow) {
    getStorage().setItem(FLOW_KEY, JSON.stringify(flow));
    return flow;
  }

  function clearFlow() {
    try {
      getStorage().removeItem(FLOW_KEY);
    } catch (_) { }
    if (flowTimer) {
      clearTimeout(flowTimer);
      flowTimer = null;
    }
    if (saveWatchTimer) {
      clearTimeout(saveWatchTimer);
      saveWatchTimer = null;
    }
    flowBusy = false;
    flowFinishing = false;
  }

  function patchFlow(patch) {
    const current = readFlow();
    if (!current) return null;
    return writeFlow({ ...current, ...patch, createdAt: Date.now() });
  }

  function releaseFlowUi(doc) {
    endOverlaySuppression();

    const target = doc?.documentElement ? doc : getFrameDocument();
    if (!target?.documentElement) return;

    installEditActions(target);
    setEditGroupsBusy(target, false);
  }

  function readActiveFlow() {
    const flow = readFlow();
    if (!flow) return null;

    const createdAt = Number(flow.createdAt) || 0;
    if (!createdAt || Date.now() - createdAt > FLOW_MAX_AGE_MS) {
//       console.warn(LOG, 'Fluxo de duplicação antigo descartado.');
      clearFlow();
      releaseFlowUi(getFrameDocument());
      return null;
    }

    return flow;
  }

  function scheduleFlowExpiry() {
    if (flowTimer) return;

    const flow = readFlow();
    if (!flow) return;

    const createdAt = Number(flow.createdAt) || 0;
    const age = createdAt ? Date.now() - createdAt : FLOW_MAX_AGE_MS;
    const delay = Math.max(0, FLOW_MAX_AGE_MS - age) + 100;

    flowTimer = setTimeout(() => {
      flowTimer = null;

      const current = readFlow();
      if (!current) return;

      if (readActiveFlow()) {
        scheduleFlowExpiry();
        return;
      }

      releaseFlowUi(getFrameDocument());
//       console.warn(LOG, 'Duplicação não confirmada a tempo. Botões reabilitados.');
    }, delay);
  }

  function failFlow(doc, error) {
    const message = String(error?.message || error || 'Falha na duplicação.');
    patchFlow({ stage: 'error', error: message });
    flowBusy = false;
    endOverlaySuppression();
    if (doc?.documentElement) {
      installEditActions(doc);
      setEditGroupsBusy(doc, false);
    }
//     console.error(LOG, message);
  }

  function flowMatchesClient(flow, clientId) {
    if (!/^\d+$/.test(String(clientId || ''))) return true;

    return [flow?.originalId, flow?.newId]
      .map(value => String(value || ''))
      .some(value => value === String(clientId));
  }

  function visibleSaveSuccessElements(doc) {
    const elements = doc?.querySelectorAll?.(
      '.alert-success, .alert.alert-success, .text-success.alert, .toast, .swal2-popup'
    ) || [];

    return [...elements].filter(element => {
      if (!element.getClientRects().length) return false;
      if (element.classList.contains('swal2-popup') &&
        !element.querySelector('.swal2-icon-success')) {
        return false;
      }

      return /sucesso|salv[oa]|cadastrad[oa]|altera[cç][aã]o/i.test(
        String(element.textContent || '')
      );
    });
  }

  function captureSaveSuccessSnapshot(doc) {
    return new Map(
      visibleSaveSuccessElements(doc).map(element => [
        element,
        String(element.textContent || '').trim()
      ])
    );
  }

  function hasNewSaveSuccess(doc, known) {
    return visibleSaveSuccessElements(doc).some(element => {
      const previous = known.get(element);
      if (previous === undefined) return true;
      return previous !== String(element.textContent || '').trim();
    });
  }


  function readJsonStorage(key) {
    try {
      return JSON.parse(getStorage().getItem(key) || 'null');
    } catch {
      return null;
    }
  }

  function writeJsonStorage(key, value) {
    getStorage().setItem(key, JSON.stringify(value));
    return value;
  }

  function removeStorageKey(key) {
    try {
      getStorage().removeItem(key);
    } catch (_) { }
  }

  function rememberDuplicatedClient(id, editUrl = '') {
    return writeJsonStorage(DUPLICATED_EDIT_KEY, {
      id: String(id || '').trim(),
      editUrl: String(editUrl || ''),
      createdAt: Date.now()
    });
  }

  function getRememberedDuplicatedClient() {
    const value = readJsonStorage(DUPLICATED_EDIT_KEY);
    if (!value || !/^\d+$/.test(String(value.id || ''))) return null;

    /* Evita deixar um cadastro antigo marcado indefinidamente. */
    if (Date.now() - Number(value.createdAt || 0) > 6 * 60 * 60 * 1000) {
      removeStorageKey(DUPLICATED_EDIT_KEY);
      return null;
    }

    return value;
  }

  function readPendingDavAfterSave() {
    const pending = readJsonStorage(PENDING_DAV_AFTER_SAVE_KEY);
    if (!pending || !/^\d+$/.test(String(pending.id || ''))) return null;

    if (Date.now() - Number(pending.createdAt || 0) > 2 * 60 * 1000) {
      removeStorageKey(PENDING_DAV_AFTER_SAVE_KEY);
      return null;
    }

    return pending;
  }

  /* =========================================================
     BLOQUEIO NATIVO DO SATGO
     ========================================================= */

  function getHostDocument() {
    try {
      return window.top.document;
    } catch {
      return document;
    }
  }

  function hideBlockingOverlay() {
    const docs = new Set([getHostDocument(), document, getFrameDocument()].filter(Boolean));

    for (const doc of docs) {
      const overlay = doc.getElementById?.('bloqueioOverlay');
      if (!overlay) continue;

      /* Pedido explícito: não deixar o bloqueio cobrir duplicação/exclusão. */
      if (overlay.style.display !== 'none') {
        overlay.style.display = 'none';
      }
    }
  }

  function ensureOverlayObserver() {
    if (overlayObserver) return;

    const hostDoc = getHostDocument();
    if (!hostDoc?.documentElement) return;

    const Observer = hostDoc.defaultView?.MutationObserver || MutationObserver;
    overlayObserver = new Observer(() => {
      if (overlaySuppressionActive) hideBlockingOverlay();
    });

    overlayObserver.observe(hostDoc.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style']
    });
  }

  function beginOverlaySuppression(reason) {
    overlaySuppressionActive = true;
    overlaySuppressionReason = reason || '';
    ensureOverlayObserver();
    hideBlockingOverlay();
  }

  function endOverlaySuppression(reason = '') {
    if (reason && overlaySuppressionReason && reason !== overlaySuppressionReason) return;
    overlaySuppressionActive = false;
    overlaySuppressionReason = '';
    hideBlockingOverlay();
  }

  /* =========================================================
     CSS
     ========================================================= */

  function installStyle(doc) {
    if (!doc?.documentElement || doc.getElementById(STYLE_ID)) return;

    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      /* Mantém o estilo já existente do botão nativo na listagem */
      ${BUTTON_SELECTOR} {
        border: 1px solid #0d6efd !important;
        background-color: #d6f0f7 !important;
        border-color: #0d6efd !important;
        color: #0d6efd !important;
      }
      ${BUTTON_SELECTOR}:hover,
      ${BUTTON_SELECTOR}:active {
        background-color: #9AE3F0 !important;
        border-color: #072757 !important;
        color: #072757 !important;
      }
      ${BUTTON_SELECTOR}:focus,
      ${BUTTON_SELECTOR}:focus-visible {
        border-color: #0d6efd !important;
        box-shadow: 0 0 0 0.2rem rgba(13, 110, 253, 0.25) !important;
      }
      ${BUTTON_SELECTOR} > i,
      ${BUTTON_SELECTOR} .bi {
        color: inherit !important;
      }

      /* =====================================================
         EDIÇÃO: [ Duplicar | + DAV ]
         Mesmo padrão visual dos grupos do dashboard
         ===================================================== */
      .${EDIT_GROUP_CLASS} {
        display: inline-flex;
        align-items: stretch;
        height: 38px;
        background: #fff;
        border: 1px solid #d8dde3;
        border-radius: 9px;
        overflow: hidden;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
        vertical-align: middle;
      }

      .${EDIT_GROUP_CLASS} .calebe-duplicar-principal {
        box-sizing: border-box;
        height: 100%;
        padding: 0 13px;
        display: inline-flex;
        flex-direction: row;
        align-items: center;
        justify-content: center;
        gap: 7px;
        color: #495057;
        background: #fff;
        border: 0;
        text-decoration: none;
        white-space: nowrap;
        font-size: 12px;
        font-weight: 500;
        line-height: 1;
        cursor: pointer;
        transition: color 0.15s ease, background-color 0.15s ease;
      }

      .${EDIT_GROUP_CLASS} .calebe-duplicar-principal i {
        color: #0d6efd;
        font-size: 18px;
        line-height: 1;
        flex: 0 0 auto;
      }

      .${EDIT_GROUP_CLASS} .calebe-duplicar-principal:hover {
        color: #0d6efd;
        background: #f5f9ff;
      }

      .${EDIT_GROUP_CLASS} .calebe-duplicar-dav {
        box-sizing: border-box;
        height: 100%;
        padding: 0 10px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        color: #fff;
        background: #198754;
        border: 0;
        border-left: 1px solid rgba(255, 255, 255, 0.25);
        white-space: nowrap;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        transition: background-color 0.15s ease, color 0.15s ease;
      }

      .${EDIT_GROUP_CLASS} .calebe-duplicar-dav i {
        color: inherit;
        font-size: 13px;
        line-height: 1;
      }

      .${EDIT_GROUP_CLASS} .calebe-duplicar-dav:hover {
        color: #fff;
        background: #157347;
      }

      .${EDIT_GROUP_CLASS} button:focus {
        position: relative;
        z-index: 3;
        outline: 0;
        box-shadow: inset 0 0 0 2px rgba(13, 110, 253, 0.35);
      }

      .${EDIT_GROUP_CLASS} button:active {
        filter: brightness(0.96);
      }

      .${EDIT_GROUP_CLASS}.calebe-flow-busy {
        opacity: 0.65;
      }

      .${EDIT_GROUP_CLASS}.calebe-flow-busy button {
        cursor: wait;
      }


      .calebe-helper-excluir-duplicado {
        box-sizing: border-box;
        height: 38px;
        padding: 0 12px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        color: #dc3545;
        background: #fff;
        border: 1px solid #dc3545;
        border-radius: 9px;
        white-space: nowrap;
        font-size: 12px;
        font-weight: 600;
        line-height: 1;
        cursor: pointer;
        transition: color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease;
      }

      .calebe-helper-excluir-duplicado:hover {
        color: #fff;
        background: #dc3545;
      }

      .calebe-helper-excluir-duplicado:focus {
        outline: 0;
        box-shadow: 0 0 0 0.2rem rgba(220, 53, 69, 0.22);
      }



      /* =====================================================
         RECÉM-DUPLICADO: [ Excluir ] [ Sair ] [ Salvar | + DAV ]
         ===================================================== */
      .${SAVE_DAV_GROUP_CLASS} {
        display: inline-flex;
        align-items: stretch;
        height: 38px;
        border-radius: 0.375rem;
        overflow: hidden;
        vertical-align: middle;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
      }

      .${SAVE_DAV_GROUP_CLASS} > button.btn.btn-primary {
        height: 100%;
        margin: 0 !important;
        border-radius: 0 !important;
        border-top-left-radius: 0.375rem !important;
        border-bottom-left-radius: 0.375rem !important;
        border-right: 0 !important;
        white-space: nowrap;
      }

      .${SAVE_DAV_GROUP_CLASS} .calebe-salvar-dav {
        box-sizing: border-box;
        height: 100%;
        padding: 0 11px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        color: #fff;
        background: #198754;
        border: 1px solid #198754;
        border-left: 1px solid rgba(255, 255, 255, 0.25);
        border-top-right-radius: 0.375rem;
        border-bottom-right-radius: 0.375rem;
        white-space: nowrap;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
      }

      .${SAVE_DAV_GROUP_CLASS} .calebe-salvar-dav:hover {
        color: #fff;
        background: #157347;
        border-color: #146c43;
      }

      .${SAVE_DAV_GROUP_CLASS} .calebe-salvar-dav:focus {
        position: relative;
        z-index: 3;
        outline: 0;
        box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.32);
      }

      .${SAVE_DAV_GROUP_CLASS}.calebe-flow-busy {
        opacity: 0.65;
      }

      ${BUTTON_SELECTOR}.calebe-helper-duplicando {
        opacity: 0.6;
        cursor: wait !important;
        pointer-events: none;
      }
    `;
    (doc.head || doc.documentElement).appendChild(style);
  }

  /* =========================================================
     HELPERS DE DOCUMENTO / NAVEGAÇÃO
     ========================================================= */

  function getMainFrame() {
    return document.getElementById('mainIframe');
  }

  function getFrameDocument() {
    const frame = getMainFrame();
    try {
      return frame?.contentDocument || null;
    } catch {
      return null;
    }
  }

  function getFrameWindow() {
    const frame = getMainFrame();
    try {
      return frame?.contentWindow || null;
    } catch {
      return null;
    }
  }

  function getCurrentClientId(doc) {
    return String(
      doc?.getElementById('formClifor')
        ?.querySelector('input[name="id"]')
        ?.value || ''
    ).trim();
  }

  function parseHtml(win, html) {
    const Parser = win?.DOMParser || DOMParser;
    return new Parser().parseFromString(html, 'text/html');
  }

  function findClientListUrl(doc) {
    const exit = [...doc.querySelectorAll('a[href*="clca01.php"]')]
      .find(a => /Sair/i.test(a.textContent || ''));

    if (exit?.href) return exit.href;

    const chave = doc.querySelector('#formClifor input[name="chave"]')?.value;
    if (!chave) return null;

    const url = new URL('clca01.php', doc.location.href);
    url.searchParams.set('chave', chave);
    return url.href;
  }

  function navigateFrame(url) {
    const frame = getMainFrame();
    if (!frame) throw new Error('mainIframe não encontrado.');
    frame.src = url;
  }

  /* =========================================================
     DUPLICAR DIRETO PELA LISTAGEM E ABRIR EDIÇÃO
     ========================================================= */

  function parseNativeDuplicateButton(button) {
    const onclick = String(button?.getAttribute('onclick') || '');
    const match = onclick.match(
      /duplicarRegistro\s*\(\s*(\d+)\s*,\s*(['"])((?:\\.|(?!\2).)*)\2\s*\)/i
    );
    if (!match) return null;

    const quote = match[2];
    const escapedName = match[3];
    const name = escapedName
      .replace(new RegExp(`\\${quote}`, 'g'), quote)
      .replace(/\\\\/g, '\\');

    return { id: match[1], name };
  }

  function buildDuplicateFormDataFromList(doc, clientId) {
    const win = doc.defaultView || window;
    const FormDataCtor = win.FormData || FormData;
    const nativeForm = doc.querySelector('#modalDuplicar form[method="POST"], #modalDuplicar form');
    const data = nativeForm ? new FormDataCtor(nativeForm) : new FormDataCtor();

    data.set('acao', 'duplicar');
    data.set('id', String(clientId));

    if (!data.get('chave')) {
      const chave = doc.querySelector('input[name="chave"]')?.value
        || new URL(doc.location.href).searchParams.get('chave')
        || '';
      if (chave) data.set('chave', chave);
    }

    for (const name of ['q', 'campo', 'cred', 'pessoa', 'tipo', 'uni', 'p']) {
      if (data.has(name)) continue;
      const control = doc.querySelector(`[name="${name}"]`);
      if (control) data.set(name, String(control.value ?? ''));
    }

    return data;
  }

  const DUPLICATE_ADDRESS_FIELDS = [
    'ClienteCep', 'ClienteLogradouro', 'ClienteNumero', 'ClienteComplemento',
    'ClienteBairro', 'ClienteMunicipio', 'ClienteUf'
  ];

  function normalizeDuplicateText(value) {
    return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ').trim().toUpperCase();
  }

  function duplicateIdentity(row) {
    return {
      document: String(row.ClienteCGC || '').replace(/\D/g, ''),
      address: DUPLICATE_ADDRESS_FIELDS.map(key => normalizeDuplicateText(row[key]))
    };
  }

  function sameDuplicateIdentity(row, identity) {
    const candidate = duplicateIdentity(row);
    return Boolean(identity.document) && candidate.document === identity.document &&
      candidate.address.every((value, index) => value === identity.address[index]);
  }

  function duplicateEndpoint(doc) {
    const url = new URL('clca01.php', doc.location.href);
    const chave = doc.querySelector('input[name="chave"]')?.value ||
      new URL(doc.location.href).searchParams.get('chave');
    if (!chave) throw new Error('Chave da sessão não encontrada.');
    url.searchParams.set('chave', chave);
    return url;
  }

  function fetchWithTimeout(win, url, options = {}, timeoutMs = 20000) {
    const Controller = win?.AbortController || AbortController;
    const controller = Controller ? new Controller() : null;
    const timer = controller
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;

    const request = (win?.fetch || fetch)(url, {
      ...options,
      ...(controller ? { signal: controller.signal } : {})
    });

    return request.finally(() => {
      if (timer) clearTimeout(timer);
    });
  }

  async function queryDuplicateClients(doc, field, term, page = 1) {
    const url = duplicateEndpoint(doc);
    url.searchParams.set('campo', field);
    url.searchParams.set('q', term);
    url.searchParams.set('p', String(page));
    url.searchParams.set('fmt', 'json');
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const win = doc.defaultView || window;
        const response = await fetchWithTimeout(win, url.href, {
          credentials: 'same-origin', cache: 'no-store'
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (!Array.isArray(data.rows) || !Number.isFinite(Number(data.total))) {
          throw new Error('O SATGO não retornou a lista JSON de clientes esperada.');
        }
        return data;
      } catch (error) {
        if (attempt === 3) throw new Error(`Falha na consulta do código ${term}: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, attempt * 400));
      }
    }
  }

  /* =========================================================
     BUSCA SUPREMA POR SALTO EXPONENCIAL + BUSCA BINÁRIA (COM STORAGE)
     ========================================================= */
  async function findHighestAvailableClient(doc) {
    // 1. LER DO STORAGE: Tenta buscar o último recorde salvo na memória.
    // Se não houver nada gravado ainda, usa o 708 como ponto de partida inicial seguro.
    const storedHighest = readJsonStorage('calebeHelperMaiorCodigoAbsoluto');
    const knownHighest = storedHighest && !isNaN(storedHighest) ? Number(storedHighest) : 708;
    
    const emptyLimit = 30;    // Limite de segurança contra buracos falsos
    
//     console.info(LOG, `Iniciando Busca Exponencial Suprema a partir do Storage: ${knownHighest}.`);

    let step = 1;
    let lastFoundOcupado = knownHighest;
    let highestRow = null;
    let currentCheck = knownHighest + step;

    // FASE 1: Salto Exponencial (Multiplica o passo por 2 a cada acerto)
    while (true) {
      const result = await queryDuplicateClients(doc, 'ClienteCodigo', String(currentCheck));
      const row = result.rows.find(item => Number(item.ClienteCodigo) === currentCheck);

      if (row) {
        lastFoundOcupado = currentCheck;
        highestRow = row;
        
//         console.info(LOG, `ID ${currentCheck} ocupado. Dobrando o passo de ${step} para ${step * 2}.`);
        step *= 2; // Dobra o tamanho do salto
        currentCheck = lastFoundOcupado + step;
      } else {
        // Encontramos um código vago! O teto está entre o último ocupado e este chute atual
//         console.info(LOG, `ID ${currentCheck} está vago. Teto encontrado! Refinando intervalo.`);
        break;
      }
    }

    // FASE 2: Busca Binária no intervalo delimitado (Corta pela metade a cada tentativa)
    let low = lastFoundOcupado;
    let high = currentCheck;

//     console.info(LOG, `Iniciando Busca Binária entre os IDs ${low} e ${high}.`);

    while (low <= high) {
      let mid = Math.floor((low + high) / 2);
      
      // Evita testar novamente os extremos já conhecidos para economizar requisições
      if (mid === low || mid === high) {
        break;
      }

      const resultMid = await queryDuplicateClients(doc, 'ClienteCodigo', String(mid));
      const rowMid = resultMid.rows.find(item => Number(item.ClienteCodigo) === mid);

      if (rowMid) {
        // Se o meio está ocupado, o maior absoluto está na metade superior
        highestRow = rowMid;
        lastFoundOcupado = mid;
        low = mid; 
      } else {
        // Se o meio está vago, o maior absoluto está na metade inferior
        high = mid;
      }
    }

    // FASE 3: Varredura de segurança contra pequenos buracos falsos no fim da linha
//     console.info(LOG, `Aplicando margem de segurança linear a partir de ${lastFoundOcupado}.`);
    let linearCheck = lastFoundOcupado + 1;
    let consecutiveEmpty = 0;

    while (consecutiveEmpty < emptyLimit) {
      const resultLinear = await queryDuplicateClients(doc, 'ClienteCodigo', String(linearCheck));
      const rowLinear = resultLinear.rows.find(item => Number(item.ClienteCodigo) === linearCheck);

      if (rowLinear) {
        highestRow = rowLinear;
        lastFoundOcupado = linearCheck;
        consecutiveEmpty = 0; // Zera se achar um ID isolado mais alto
      } else {
        consecutiveEmpty++;
      }
      linearCheck++;
    }

    if (highestRow) {
//       console.info(LOG, `[SUCESSO] Maior código absoluto cravado: ${highestRow.ClienteCodigo}`);
      
      // 2. SALVAR NO STORAGE: Grava o novo maior ID absoluto encontrado.
      // Na próxima vez que você duplicar um cliente, ele não começará do 708, mas sim deste novo número!
      writeJsonStorage('calebeHelperMaiorCodigoAbsoluto', Number(highestRow.ClienteCodigo));
      
      return highestRow;
    }

    throw new Error('Falha crítica no algoritmo exponencial ao determinar o teto do cadastro.');
  }



  async function duplicateAndResolve(doc, originalId, data) {
    if (duplicateRequestBusy) throw new Error('Já existe uma duplicação em andamento.');
    duplicateRequestBusy = true;
    try {
      const pendingKey = `${PENDING_DUPLICATE_KEY}:${String(originalId)}`;
      // Cada novo clique do usuário inicia outra operação, descartando
      // a pendência local da tentativa anterior. O bloqueio em memória acima
      // continua impedindo dois pedidos simultâneos por clique duplo.
      removeStorageKey(pendingKey);
      removeStorageKey(PENDING_DUPLICATE_KEY);
      const pending = { originalId: String(originalId), confirmed: false, startedAt: Date.now(), mode: 'highest-code' };
      writeJsonStorage(pendingKey, pending);
//       console.info(LOG, `Solicitando ao SATGO a duplicação do cliente ${originalId}.`);
      const response = await fetchWithTimeout(doc.defaultView || window, duplicateEndpoint(doc).href, {
        method: 'POST', body: data, credentials: 'same-origin'
      }, 45000);
      const text = await response.text();
      let payload = null;
      try { payload = JSON.parse(text); } catch (_) { }
      const afterDoc = payload ? null : parseHtml(doc.defaultView, text);
      pending.confirmed = response.ok && (
        /Registro duplicado com sucesso/i.test(afterDoc?.body?.textContent || '') ||
        payload?.success === true || payload?.sucesso === true
      );
      // Guarda o diagnóstico desta tentativa. Um novo clique explícito
      // descarta esse registro e envia uma nova solicitação.
      pending.diagnostic = {
        status: response.status,
        tipo: payload ? 'json' : 'html',
        camposJSON: payload ? Object.keys(payload) : [],
        caminhoFinal: new URL(response.url || duplicateEndpoint(doc).href).pathname,
        alertas: [...(afterDoc?.querySelectorAll('.alert') || [])]
          .map(el => String(el.textContent || '').trim().replace(/(chave|token)=[^\s&]+/gi, '$1=[OCULTO]').slice(0, 500)),
        formularioEdicao: Boolean(afterDoc?.querySelector('#formClifor'))
      };
      writeJsonStorage(pendingKey, pending);
      if (!pending.confirmed) {
        throw new Error('O SATGO não confirmou a operação na resposta recebida. O pedido foi guardado e não será reenviado automaticamente.');
      }
//       console.info(LOG, 'Duplicação confirmada. Buscando o maior código disponível.');
      const created = await findHighestAvailableClient(doc);
      const newId = String(created.ClienteCodigo);
//       console.info(LOG, `Maior código localizado: ${newId}. Conferindo CPF/CNPJ e endereço.`);
      const originalResult = await queryDuplicateClients(doc, 'ClienteCodigo', String(originalId));
      const original = originalResult.rows.find(row => String(row.ClienteCodigo) === String(originalId));
      if (newId === String(originalId) || !original || !normalizeDuplicateText(original.ClienteLogradouro) ||
        !sameDuplicateIdentity(created, duplicateIdentity(original))) {
        throw new Error(`O maior código (${newId}) não corresponde ao CPF/CNPJ e endereço do cliente ${originalId}. A edição não foi aberta e a duplicação não foi repetida.`);
      }
      pending.newId = newId;

      const editUrl = new URL('clca01_form.php', duplicateEndpoint(doc));
      editUrl.searchParams.set('acao', 'editar');
      editUrl.searchParams.set('id', pending.newId);
      editUrl.searchParams.set('chave', duplicateEndpoint(doc).searchParams.get('chave'));
      rememberDuplicatedClient(pending.newId, editUrl.href);
      removeStorageKey(pendingKey);
      return { newId: pending.newId, editUrl: editUrl.href };
    } finally {
      duplicateRequestBusy = false;
    }
  }

  async function duplicateFromListAndOpen(button) {
    if (button.classList.contains('calebe-helper-duplicando')) return;

    const doc = button.ownerDocument;
    const client = parseNativeDuplicateButton(button);
    if (!client) throw new Error('Não foi possível identificar o cliente do botão Duplicar.');

    button.classList.add('calebe-helper-duplicando');
    button.disabled = true;
    beginOverlaySuppression('duplicate');

    try {
      const data = buildDuplicateFormDataFromList(doc, client.id);
      const { newId, editUrl } = await duplicateAndResolve(doc, client.id, data);
//       console.info(LOG, `Cliente ${client.id} duplicado como ${newId}; abrindo edição.`);
      navigateFrame(editUrl);
      endOverlaySuppression('duplicate');
    } catch (error) {
      endOverlaySuppression('duplicate');
      button.classList.remove('calebe-helper-duplicando');
      button.disabled = false;
      throw error;
    }
  }

  function installListDuplicateBehavior(doc) {
    if (!doc?.documentElement) return;

    for (const button of doc.querySelectorAll(BUTTON_SELECTOR)) {
      if (button.dataset.calebeDuplicateOpenEdit === '1') continue;
      button.dataset.calebeDuplicateOpenEdit = '1';

      /* Captura antes do onclick nativo para impedir a abertura do modal antigo. */
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        duplicateFromListAndOpen(button).catch(error => {
//           console.error(LOG, 'Falha ao concluir a duplicação pela listagem. Consulte a etapa informada abaixo.', error);
        });
      }, true);
    }
  }

  /* =========================================================
     EXCLUIR O DUPLICADO A PARTIR DA EDIÇÃO
     ========================================================= */

  function createDeleteDuplicateButton(doc, clientId) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'calebe-helper-excluir-duplicado';
    button.title = 'Excluir este cliente duplicado';
    button.innerHTML = '<i class="bi bi-trash" aria-hidden="true"></i><span>Excluir</span>';

    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();

      const listUrl = findClientListUrl(doc);
      if (!listUrl) {
//         console.error(LOG, 'Não foi possível localizar a listagem para excluir o duplicado.');
        return;
      }

      writeJsonStorage(PENDING_DELETE_KEY, {
        id: String(clientId),
        createdAt: Date.now()
      });

      beginOverlaySuppression('delete');
//       console.info(LOG, `Abrindo exclusão nativa do cliente duplicado ${clientId}.`);
      navigateFrame(listUrl);
    });

    return button;
  }

  function setSaveDavBusy(doc, busy) {
    for (const group of doc.querySelectorAll(`.${SAVE_DAV_GROUP_CLASS}`)) {
      group.classList.toggle('calebe-flow-busy', busy);
      const dav = group.querySelector('.calebe-salvar-dav');
      if (dav) dav.disabled = busy;
    }
  }

  function saveDuplicatedAndOpenDav(doc, clientId) {
    const form = doc.getElementById('formClifor');
    if (!form) throw new Error('#formClifor não encontrado.');

    writeJsonStorage(PENDING_DAV_AFTER_SAVE_KEY, {
      id: String(clientId),
      createdAt: Date.now()
    });

    setSaveDavBusy(doc, true);

//     console.info(LOG, `Salvando cliente ${clientId} antes de abrir o DAV.`);

    try {
      dispatchNativeSave(doc);
    } catch (error) {
      removeStorageKey(PENDING_DAV_AFTER_SAVE_KEY);
      setSaveDavBusy(doc, false);
      throw error;
    }

    schedulePendingDavWatch(doc);
  }

  function schedulePendingDavWatch(doc) {
    const pending = readJsonStorage(PENDING_DAV_AFTER_SAVE_KEY);
    if (!pending) return;

    const knownSuccess = captureSaveSuccessSnapshot(doc);
    const startedAt = Date.now();

    if (saveWatchTimer) {
      clearTimeout(saveWatchTimer);
      saveWatchTimer = null;
    }

    const check = () => {
      saveWatchTimer = null;

      if (getFrameDocument() !== doc) {
        if (Date.now() - startedAt < SAVE_CONFIRM_TIMEOUT_MS) {
          saveWatchTimer = setTimeout(check, 300);
        } else {
          removeStorageKey(PENDING_DAV_AFTER_SAVE_KEY);
          setSaveDavBusy(doc, false);
        }
        return;
      }

      const current = readJsonStorage(PENDING_DAV_AFTER_SAVE_KEY);
      if (!current) return;

      if (Date.now() - Number(current.createdAt || 0) > 2 * 60 * 1000) {
        removeStorageKey(PENDING_DAV_AFTER_SAVE_KEY);
        setSaveDavBusy(doc, false);
        return;
      }

      if (hasVisibleSaveError(doc)) {
        removeStorageKey(PENDING_DAV_AFTER_SAVE_KEY);
        setSaveDavBusy(doc, false);
//         console.error(LOG, 'O SATGO exibiu erro ao salvar; o DAV não foi aberto.');
        return;
      }

      const succeeded = hasNewSaveSuccess(doc, knownSuccess);
      if (succeeded) {
        executePendingDavAfterSave(doc, { fromLoad: true }).catch(handleFlowError);
        return;
      }

      if (Date.now() - startedAt < SAVE_CONFIRM_TIMEOUT_MS) {
        saveWatchTimer = setTimeout(check, 300);
        return;
      }

      removeStorageKey(PENDING_DAV_AFTER_SAVE_KEY);
      setSaveDavBusy(doc, false);
//       console.error(LOG, 'O salvamento não foi confirmado a tempo; o DAV não foi aberto.');
    };

    saveWatchTimer = setTimeout(check, 300);
  }

  function createSaveDavButton(doc, clientId) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'calebe-salvar-dav';
    button.title = 'Salvar alterações e abrir um novo DAV para este cliente';
    button.innerHTML = '<i class="bi bi-plus-lg" aria-hidden="true"></i><span>DAV</span>';

    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();

      try {
        saveDuplicatedAndOpenDav(doc, clientId);
      } catch (error) {
        removeStorageKey(PENDING_DAV_AFTER_SAVE_KEY);
        setSaveDavBusy(doc, false);
//         console.error(LOG, 'Falha ao salvar e abrir DAV.', error);
      }
    });

    return button;
  }

  function installDuplicatedEditActions(doc, currentId) {
    const saveButtons = [...doc.querySelectorAll('button.btn.btn-primary')]
      .filter(button => isNativeSaveButton(doc, button));

    /* Nesta tela especial não oferecemos Duplicar novamente. */
    doc.querySelectorAll(`.${EDIT_GROUP_CLASS}`).forEach(group => group.remove());

    for (const saveButton of saveButtons) {
      if (saveButton.closest(`.${SAVE_DAV_GROUP_CLASS}`)) continue;

      const container = saveButton.parentElement;
      if (!container) continue;

      const exitButton = [...container.querySelectorAll('a.btn')]
        .find(a => /Sair/i.test(a.textContent || ''));
      if (!exitButton) continue;

      if (!container.querySelector('.calebe-helper-excluir-duplicado')) {
        container.insertBefore(createDeleteDuplicateButton(doc, currentId), exitButton);
      }

      const group = doc.createElement('div');
      group.className = SAVE_DAV_GROUP_CLASS;
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', 'Salvar alterações ou salvar e abrir DAV');

      container.insertBefore(group, saveButton);
      group.append(saveButton, createSaveDavButton(doc, currentId));
    }
  }

  async function executePendingDavAfterSave(doc, { fromLoad = false } = {}) {
    if (!fromLoad) return false;

    const pending = readJsonStorage(PENDING_DAV_AFTER_SAVE_KEY);
    if (!pending || !/^\d+$/.test(String(pending.id || ''))) return false;

    if (Date.now() - Number(pending.createdAt || 0) > 2 * 60 * 1000) {
      removeStorageKey(PENDING_DAV_AFTER_SAVE_KEY);
      setSaveDavBusy(doc, false);
      return false;
    }

    /* O salvamento só pode terminar em uma tela de cliente (edição ou listagem). */
    if (!doc.getElementById('formClifor') && !isClientListPage(doc)) {
//       console.info(LOG, 'DAV pendente ignorado: o iframe não está em uma tela de cliente.');
      return false;
    }

    if (!isClientListPage(doc) && hasVisibleSaveError(doc)) {
      removeStorageKey(PENDING_DAV_AFTER_SAVE_KEY);
      setEditGroupsBusy(doc, false);
//       console.error(LOG, 'O SATGO exibiu erro ao salvar; o DAV não foi aberto.');
      return false;
    }

    const api = window.calebeHelperClientDav;
    if (!api?.createDavForClient) {
      removeStorageKey(PENDING_DAV_AFTER_SAVE_KEY);
      setEditGroupsBusy(doc, false);
//       console.error(LOG, 'clientedav.js não disponibilizou createDavForClient().');
      return false;
    }

    removeStorageKey(PENDING_DAV_AFTER_SAVE_KEY);
//     console.info(LOG, `Cliente ${pending.id} salvo; abrindo novo DAV.`);

    try {
      await api.createDavForClient({ code: String(pending.id), name: '' });
      removeStorageKey(DUPLICATED_EDIT_KEY);
      return true;
    } catch (error) {
      setSaveDavBusy(doc, false);
//       console.error(LOG, 'Falha ao abrir DAV após salvar o cliente duplicado.', error);
      return false;
    }
  }

  function parseNativeDeleteId(button) {
    const onclick = String(button?.getAttribute('onclick') || '');
    return onclick.match(/confirmarExclusao\s*\(\s*(\d+)/i)?.[1] || '';
  }

  function executePendingNativeDelete(doc) {
    const pending = readJsonStorage(PENDING_DELETE_KEY);
    if (!pending || !/^\d+$/.test(String(pending.id || ''))) return false;

    if (Date.now() - Number(pending.createdAt || 0) > 2 * 60 * 1000) {
      removeStorageKey(PENDING_DELETE_KEY);
      return false;
    }

    const deleteButton = [...doc.querySelectorAll('button[onclick*="confirmarExclusao("]')]
      .find(button => parseNativeDeleteId(button) === String(pending.id));

    if (!deleteButton) return false;

    removeStorageKey(PENDING_DELETE_KEY);
    beginOverlaySuppression('delete');
    hideBlockingOverlay();
    deleteConfirmationDocument = doc;
//     console.info(LOG, `Abrindo confirmação nativa de exclusão do cliente ${pending.id}.`);
    deleteButton.click();
    hideBlockingOverlay();
    return true;
  }

  /* =========================================================
     SNAPSHOT DO FORMULÁRIO
     ========================================================= */

  function captureClientSnapshot(form) {
    const entries = [];
    const nameIndexes = new Map();

    for (const el of Array.from(form.elements || [])) {
      const name = String(el.name || '').trim();
      if (!name) continue;
      if (['acao', 'id', 'chave', 'ClienteCodigo'].includes(name)) continue;

      const type = String(el.type || '').toLowerCase();
      if (['button', 'submit', 'reset', 'file'].includes(type)) continue;

      const sameNameIndex = nameIndexes.get(name) || 0;
      nameIndexes.set(name, sameNameIndex + 1);

      const entry = {
        name,
        sameNameIndex,
        type,
        tag: String(el.tagName || '').toLowerCase(),
        value: String(el.value ?? '')
      };

      if (type === 'checkbox' || type === 'radio') {
        entry.checked = Boolean(el.checked);
      }

      entries.push(entry);
    }

    const doc = form.ownerDocument;
    const municipioAC = String(doc.getElementById('ClienteMunicipioAC')?.value || '');

    return { entries, municipioAC };
  }

  function fireFieldEvents(el) {
    const win = el.ownerDocument.defaultView;
    el.dispatchEvent(new win.Event('input', { bubbles: true }));
    el.dispatchEvent(new win.Event('change', { bubbles: true }));
  }

  function restoreClientSnapshot(form, snapshot) {
    if (!snapshot?.entries) return;

    const elements = Array.from(form.elements || []);

    for (const entry of snapshot.entries) {
      const matches = elements.filter(el => String(el.name || '') === entry.name);
      const el = matches[entry.sameNameIndex];
      if (!el) continue;

      const type = String(el.type || '').toLowerCase();

      if (type === 'checkbox' || type === 'radio') {
        el.checked = Boolean(entry.checked);
      } else {
        el.value = entry.value;
      }

      fireFieldEvents(el);
    }

    const municipioAC = form.ownerDocument.getElementById('ClienteMunicipioAC');
    if (municipioAC && snapshot.municipioAC !== undefined) {
      municipioAC.value = snapshot.municipioAC;
      fireFieldEvents(municipioAC);
    }
  }

  /* =========================================================
     BOTÕES DA TELA DE EDIÇÃO
     ========================================================= */

  function setEditGroupsBusy(doc, busy) {
    for (const group of doc.querySelectorAll(`.${EDIT_GROUP_CLASS}, .${SAVE_DAV_GROUP_CLASS}`)) {
      group.classList.toggle('calebe-flow-busy', busy);
      for (const button of group.querySelectorAll('button')) {
        if (group.classList.contains(SAVE_DAV_GROUP_CLASS) && button.classList.contains('btn-primary')) continue;
        button.disabled = busy;
      }
    }
  }

  function createEditGroup(doc) {
    const group = doc.createElement('div');
    group.className = EDIT_GROUP_CLASS;
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Ações de duplicação do cliente');

    const duplicate = doc.createElement('button');
    duplicate.type = 'button';
    duplicate.className = 'calebe-duplicar-principal';
    duplicate.title = 'Duplicar cliente preservando as alterações atuais';
    duplicate.innerHTML = '<i class="bi bi-copy" aria-hidden="true"></i><span>Duplicar</span>';

    const dav = doc.createElement('button');
    dav.type = 'button';
    dav.className = 'calebe-duplicar-dav';
    dav.title = 'Duplicar cliente e abrir um novo DAV';
    dav.innerHTML = '<i class="bi bi-plus-lg" aria-hidden="true"></i><span>DAV</span>';

    duplicate.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      startDuplicateFlow('duplicate', doc).catch(handleFlowError);
    });

    dav.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      startDuplicateFlow('duplicate-and-dav', doc).catch(handleFlowError);
    });

    group.append(duplicate, dav);
    return group;
  }

  function installEditActions(doc) {
    if (!doc?.documentElement) return;

    const form = doc.getElementById('formClifor');
    const clientId = getCurrentClientId(doc);
    if (!form || !/^\d+$/.test(clientId)) return;

    const remembered = getRememberedDuplicatedClient();
    const isFreshDuplicate = Boolean(remembered && String(remembered.id) === clientId);

    if (isFreshDuplicate) {
      installDuplicatedEditActions(doc, clientId);
    } else {
      const saveButtons = [...doc.querySelectorAll('button.btn.btn-primary')]
        .filter(button => isNativeSaveButton(doc, button));

      for (const saveButton of saveButtons) {
        const container = saveButton.parentElement;
        if (!container || container.querySelector(`.${EDIT_GROUP_CLASS}`)) continue;

        const exitButton = [...container.querySelectorAll('a.btn')]
          .find(a => /Sair/i.test(a.textContent || ''));

        if (!exitButton) continue;
        container.insertBefore(createEditGroup(doc), exitButton);
      }
    }

    let flow = readActiveFlow();
    if (
      flow &&
      !['opening-dav', 'reopening-duplicate'].includes(flow.stage) &&
      !flowMatchesClient(flow, clientId)
    ) {
//       console.warn(LOG, 'Cliente aberto não pertence ao fluxo de duplicação; estado descartado.');
      clearFlow();
      endOverlaySuppression();
      flow = null;
    }

    setEditGroupsBusy(doc, Boolean(flow && flow.stage !== 'error'));
    setSaveDavBusy(doc, Boolean(readPendingDavAfterSave()));
  }

  /* =========================================================
     DUPLICAÇÃO NO SERVIDOR
     ========================================================= */

  function copyFilterValue(sourceDoc, data, name) {
    const el = sourceDoc.querySelector(`[name="${name}"]`);
    if (!el) return;
    data.set(name, String(el.value ?? ''));
  }

  async function duplicateOriginalClient(doc, flow) {
    const win = doc.defaultView || getFrameWindow() || window;
    const form = doc.getElementById('formClifor');
    const chave = String(form?.querySelector('input[name="chave"]')?.value || '').trim();
    if (!chave) throw new Error('Chave da sessão não encontrada no formulário do cliente.');

    const FormDataCtor = win.FormData || FormData;
    const data = new FormDataCtor();
    data.set('acao', 'duplicar');
    data.set('id', flow.originalId);
    data.set('chave', chave);

    for (const name of ['q', 'campo', 'cred', 'pessoa', 'tipo', 'uni', 'p']) {
      copyFilterValue(doc, data, name);
    }

    return duplicateAndResolve(doc, flow.originalId, data);
  }

  /* =========================================================
     FLUXO PRINCIPAL
     ========================================================= */

  async function startDuplicateFlow(mode, doc) {
    const existingFlow = readActiveFlow();

    if (flowBusy || (existingFlow && existingFlow.stage !== 'error')) {
//       console.warn(LOG, 'Já existe um fluxo de duplicação em andamento.');
      return;
    }

    /* Um erro anterior não deve impedir uma nova tentativa manual. */
    if (existingFlow?.stage === 'error') {
      clearFlow();
    }

    const form = doc.getElementById('formClifor');
    if (!form) throw new Error('#formClifor não encontrado.');

    const originalId = getCurrentClientId(doc);
    if (!/^\d+$/.test(originalId)) throw new Error('ID do cliente original inválido.');

    flowBusy = true;
    setEditGroupsBusy(doc, true);
    beginOverlaySuppression('duplicate');

    try {
      const snapshot = captureClientSnapshot(form);
      const flow = writeFlow({
        version: 1,
        mode,
        originalId,
        newId: null,
        editUrl: null,
        snapshot,
        stage: 'duplicating',
        createdAt: Date.now()
      });

      scheduleFlowExpiry();

      const duplicated = await duplicateOriginalClient(doc, flow);
      const nextFlow = patchFlow({
        newId: duplicated.newId,
        editUrl: duplicated.editUrl,
        stage: 'opening-duplicate'
      });

      if (!nextFlow) throw new Error('Estado da duplicação foi perdido após criar o novo cliente.');
      endOverlaySuppression('duplicate');
      navigateFrame(duplicated.editUrl);
    } catch (error) {
      endOverlaySuppression('duplicate');
      patchFlow({ stage: 'error', error: String(error?.message || error) });
      flowBusy = false;
      setEditGroupsBusy(doc, false);
      throw error;
    }
  }

  function hasVisibleSaveError(doc) {
    const elements = doc.querySelectorAll(
      '.alert-danger, .alert-error, .alert.alert-danger, .text-danger.alert, ' +
      '.invalid-feedback, .is-invalid'
    );

    for (const element of elements) {
      if (!element.getClientRects || !element.getClientRects().length) continue;
      if (element.classList.contains('is-invalid')) return true;
      if (String(element.textContent || '').trim()) return true;
    }

    return false;
  }

  function isClientListPage(doc) {
    if (!doc?.documentElement) return false;

    try {
      if (/\/clca01\.php$/i.test(new URL(doc.location.href).pathname)) return true;
    } catch (_) {}

    return Boolean(
      doc.getElementById('formFiltro') &&
      doc.querySelector('input[name="q"]')
    );
  }

  function normalizeButtonText(button) {
    return String(button?.textContent || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isNativeSaveButton(doc, button) {
    if (!button || !button.getClientRects().length) return false;
    if (!/^Salvar(?:\s+Alterac(?:ao|oes))?$/i.test(normalizeButtonText(button))) return false;

    const form = doc.getElementById('formClifor');
    if (!form) return false;

    const onclick = String(button.getAttribute('onclick') || '');
    return form.contains(button) || onclick.includes('formClifor');
  }

  function findNativeSaveButton(doc) {
    return [...doc.querySelectorAll('button.btn.btn-primary')]
      .find(button => isNativeSaveButton(doc, button)) || null;
  }

  function dispatchNativeSave(doc) {
    const form = doc.getElementById('formClifor');
    if (!form) throw new Error('#formClifor não encontrado no cliente duplicado.');

    const nativeSave = findNativeSaveButton(doc);
    if (!nativeSave) {
      throw new Error('O botão nativo "Salvar Alterações" não está disponível.');
    }

    nativeSave.click();
  }

  function waitForDuplicateForm(doc, flow, timeout = 10000) {
    const expectedId = String(flow.newId || '');
    const startedAt = Date.now();

    return new Promise((resolve, reject) => {
      const check = () => {
        if (getFrameDocument() !== doc) {
          reject(new Error('A página do cliente duplicado foi substituída antes do salvamento.'));
          return;
        }

        const form = doc.getElementById('formClifor');
        const currentId = getCurrentClientId(doc);
        const saveButton = findNativeSaveButton(doc);

        if (doc.readyState === 'complete' && form && currentId === expectedId && saveButton) {
          resolve({ form, saveButton });
          return;
        }

        if (Date.now() - startedAt >= timeout) {
          reject(new Error('A tela do cliente duplicado não ficou pronta para salvar.'));
          return;
        }

        setTimeout(check, 100);
      };

      check();
    });
  }

  function scheduleSaveWatch(doc, flow, knownSuccess) {
    if (saveWatchTimer) {
      clearTimeout(saveWatchTimer);
      saveWatchTimer = null;
    }

    const startedAt = Date.now();

    const check = () => {
      saveWatchTimer = null;

      if (getFrameDocument() !== doc) return;

      const currentFlow = readFlow();
      if (!currentFlow || currentFlow.stage !== 'saving-duplicate') return;

      if (hasVisibleSaveError(doc)) {
        failFlow(doc, new Error('O SATGO exibiu erro ao salvar o cliente duplicado.'));
        return;
      }

      const succeeded = hasNewSaveSuccess(doc, knownSuccess);
      if (succeeded) {
        finishAfterSave(doc, currentFlow).catch(handleFlowError);
        return;
      }

      if (Date.now() - startedAt < SAVE_CONFIRM_TIMEOUT_MS) {
        saveWatchTimer = setTimeout(check, 300);
        return;
      }

      failFlow(doc, new Error('O salvamento do cliente duplicado não foi confirmado a tempo.'));
    };

    saveWatchTimer = setTimeout(check, 300);
  }

  async function handleOpenedDuplicate(doc, flow) {
    const currentId = getCurrentClientId(doc);
    if (currentId !== String(flow.newId || '')) return false;

    const form = doc.getElementById('formClifor');
    if (!form) return false;

    patchFlow({ stage: 'preparing-duplicate' });
    scheduleFlowExpiry();

//     console.info(LOG, `Restaurando alterações no cliente duplicado ${flow.newId}.`);

    try {
      const ready = await waitForDuplicateForm(doc, flow);
      if (!readFlow()) return false;

      restoreClientSnapshot(ready.form, flow.snapshot);
      await new Promise(resolve => setTimeout(resolve, 150));
      restoreClientSnapshot(ready.form, flow.snapshot);

      const knownSuccess = captureSaveSuccessSnapshot(doc);
      patchFlow({ stage: 'saving-duplicate' });
      setEditGroupsBusy(doc, true);

//       console.info(LOG, `Salvando alterações no cliente duplicado ${flow.newId}.`);
      dispatchNativeSave(doc);
      scheduleSaveWatch(doc, flow, knownSuccess);
      return true;
    } catch (error) {
      failFlow(doc, error);
      return false;
    }
  }

  async function finishAfterSave(doc, flow) {
    if (flowFinishing) return;
    flowFinishing = true;

    try {
      if (!isClientListPage(doc) && hasVisibleSaveError(doc)) {
        failFlow(doc, new Error('O SATGO exibiu erro ao salvar o cliente duplicado.'));
        return;
      }

      if (flow.mode === 'duplicate-and-dav') {
        const api = window.calebeHelperClientDav;
        if (!api?.createDavForClient) {
          failFlow(doc, new Error('API calebeHelperClientDav.createDavForClient não disponível.'));
          return;
        }

        patchFlow({ stage: 'opening-dav' });
        endOverlaySuppression('duplicate');
//         console.info(LOG, `Abrindo novo DAV para o cliente ${flow.newId}.`);

        try {
          await api.createDavForClient({ code: String(flow.newId), name: '' });
          clearFlow();
          setEditGroupsBusy(doc, false);
//           console.info(LOG, `Novo DAV aberto com o cliente ${flow.newId}.`);
        } catch (error) {
          failFlow(doc, error);
//           console.error(LOG, 'Falha ao abrir DAV para o cliente duplicado.', error);
        }
        return;
      }

      const currentId = getCurrentClientId(doc);
      if (currentId === String(flow.newId)) {
        clearFlow();
        endOverlaySuppression('duplicate');
        installEditActions(doc);
        setEditGroupsBusy(doc, false);
//         console.info(LOG, `Duplicação concluída. Permanecendo no cliente ${flow.newId}.`);
        return;
      }

      if (flow.editUrl) {
        patchFlow({ stage: 'reopening-duplicate' });
        navigateFrame(flow.editUrl);
        return;
      }

      failFlow(doc, new Error('Não foi possível retornar ao cliente duplicado após salvar.'));
    } finally {
      flowFinishing = false;
    }
  }

  function finishReopen(doc, flow) {
    if (getCurrentClientId(doc) !== String(flow.newId || '')) return false;
    clearFlow();
    endOverlaySuppression('duplicate');
    installEditActions(doc);
    setEditGroupsBusy(doc, false);
//     console.info(LOG, `Duplicação concluída. Cliente ${flow.newId} aberto.`);
    return true;
  }

  function handleFlowError(error) {
//     console.error(LOG, error);
  }

  /* =========================================================
     PÁGINA ATUAL / RETOMADA APÓS NAVEGAÇÃO
     ========================================================= */

  function handleCurrentFrame({ fromLoad = false } = {}) {
    const doc = getFrameDocument();
    if (!doc?.documentElement) return;

    installStyle(doc);
    installListDuplicateBehavior(doc);
    installEditActions(doc);
    executePendingNativeDelete(doc);
    executePendingDavAfterSave(doc, { fromLoad }).catch(handleFlowError);

    const flow = readActiveFlow();
    if (!flow || flow.stage === 'error') return;

    scheduleFlowExpiry();
    flowBusy = true;
    setEditGroupsBusy(doc, true);

    try {
      if (flow.stage === 'opening-duplicate') {
        if (!fromLoad) return;
        handleOpenedDuplicate(doc, flow).catch(handleFlowError);
        return;
      }

      /*
       * A etapa de salvamento só avança em um NOVO load do iframe.
       * Isso impede que o mesmo documento finalize o fluxo logo após
       * dispararmos o submit nativo. Salvamentos sem navegação (AJAX)
       * são confirmados pelo scheduleSaveWatch().
       */
      if (flow.stage === 'saving-duplicate' && fromLoad) {
        const clientId = getCurrentClientId(doc);
        if (!isClientListPage(doc) && clientId !== String(flow.newId || '')) {
//           console.info(LOG, 'Load ignorado: o iframe não está na tela do cliente duplicado.');
          return;
        }

        finishAfterSave(doc, flow).catch(handleFlowError);
        return;
      }

      if (flow.stage === 'reopening-duplicate' && fromLoad) {
        finishReopen(doc, flow);
      }
    } catch (error) {
      failFlow(doc, error);
    }
  }

  /* =========================================================
     IFRAME
     ========================================================= */

  function observeFrameDocument(doc) {
    if (!doc?.documentElement) return;

    frameObserver?.disconnect();
    observedFrameDocument = doc;

    frameObserver = new MutationObserver(() => {
      installStyle(doc);
      installListDuplicateBehavior(doc);
      installEditActions(doc);
      executePendingNativeDelete(doc);
      handleCurrentFrame({ fromLoad: false });
    });

    frameObserver.observe(doc.documentElement, {
      childList: true,
      subtree: true
    });
  }

  function handleFrameLoad(doc) {
    if (!doc?.documentElement || doc.readyState !== 'complete') return false;
    if (loadHandledDocument === doc) return false;

    loadHandledDocument = doc;
    handleCurrentFrame({ fromLoad: true });
    return true;
  }

  function bindCurrentFrame() {
    const frame = getMainFrame();
    if (!frame) return;

    if (frame !== observedFrame) {
      observedFrame = frame;
      frame.addEventListener('load', event => {
        /*
         * O CalebeCore dispara eventos "load" sintéticos no iframe ao trocar
         * de aba. Tratá-los como navegação real adiantava o salvamento e
         * consumia o fluxo antes do SATGO concluir o submit.
         */
        if (!event.isTrusted) return;

        const doc = getFrameDocument();
        const previousDeleteDocument = deleteConfirmationDocument;
        if (doc && doc !== observedFrameDocument) observeFrameDocument(doc);

        if (!handleFrameLoad(doc)) {
          setTimeout(() => handleFrameLoad(getFrameDocument()), 50);
        }

        if (
          overlaySuppressionReason === 'delete' &&
          previousDeleteDocument &&
          doc &&
          doc !== previousDeleteDocument
        ) {
          deleteConfirmationDocument = null;
          endOverlaySuppression('delete');
        }
      });
    }

    const doc = getFrameDocument();
    if (doc && doc !== observedFrameDocument) observeFrameDocument(doc);
    handleFrameLoad(doc);
    handleCurrentFrame({ fromLoad: false });
  }

  /* =========================================================
     INICIALIZAÇÃO
     ========================================================= */

  ensureOverlayObserver();
  bindCurrentFrame();

  window.addEventListener('pageshow', () => {
    bindCurrentFrame();
    handleCurrentFrame({ fromLoad: false });
  });

  new MutationObserver(bindCurrentFrame).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
})();

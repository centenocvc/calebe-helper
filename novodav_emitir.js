(() => {
  'use strict';

  // ⬛ Bloco: configuração e estado do módulo.
  const MODULE_ID = 'calebe-helper-emitir-nota';
  const CHECKBOX_ID = 'calebe-helper-emitir-nota-finalizar';
  const PENDING_KEY = 'calebeHelperEmitirNotaPendenteV1';
  const THERMAL_PENDING_KEY = 'calebeHelperImpressaoTermicaPendenteV1';
  const PRINT_TYPE_STORAGE_KEY = 'calebeHelperTipoImpressaoDAV';
  const SCAN_INTERVAL_MS = 500;
  const WAIT_NEW_DAV_MS = 45000;

  let observedDocs = new WeakSet();
  let observedPrintSelects = new WeakSet();
  let pending = null;
  let thermalPending = null;
  let scanTimer = null;

  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();

  const THERMAL_WINDOW_NAME = 'calebeHelperThermalPrint';

  function dispatchPageCommand(doc, detail) {
    try {
      const EventCtor = doc.defaultView?.CustomEvent || CustomEvent;
      doc.dispatchEvent(new EventCtor('calebe-helper:command', { detail }));
      return true;
    } catch (error) {
      console.warn('[Calebe Helper] Não foi possível enviar o comando ao contexto da página.', error);
      return false;
    }
  }

  const getTopDocument = () => {
    try { return window.top.document; } catch { return document; }
  };

  function getFrameDocuments() {
    const host = getTopDocument();
    const docs = [];
    const seen = new Set();

    const add = doc => {
      if (!doc?.documentElement || seen.has(doc)) return;
      seen.add(doc);
      docs.push(doc);
    };

    add(host);
    for (const frame of host.querySelectorAll('iframe')) {
      try { add(frame.contentDocument); } catch { }
    }
    return docs;
  }

  function isDavCreationPage(doc) {
    if (!doc?.documentElement) return false;
    const hasProductFields = Boolean(
      doc.getElementById('inlinePrdCodigo') &&
      (doc.getElementById('btnObs') || doc.getElementById('inlinePrdQtd'))
    );
    const path = String(doc.location?.pathname || '');
    return hasProductFields || (/\/dav0[12]\//i.test(path) &&
      Boolean(doc.querySelector('input[id*="cli"], input[name*="cli"]')));
  }

  function isDavListPage(doc) {
    if (!doc?.documentElement) return false;
    const heading = [...doc.querySelectorAll('h6')].some(el =>
      /DAV01[\s\S]{0,40}Documento Auxiliar de Venda/i.test(el.textContent || '')
    );
    return heading && Boolean(doc.querySelector('tr button[onclick*="duplicarDav("]'));
  }

  function extractDavId(row) {
    const formatted = normalize(row?.textContent).match(/\b\d{3}-(\d{5})\b/);
    if (formatted) return Number(formatted[1]) || null;
    const selected = String(row?.getAttribute?.('onclick') || '').match(/selecionarLinha\s*\(\s*this\s*,\s*(\d+)/);
    if (selected) return Number(selected[1]) || null;
    const duplicate = String(row?.querySelector('button[onclick*="duplicarDav("]')?.getAttribute('onclick') || '')
      .match(/duplicarDav\s*\(\s*(\d+)/);
    return duplicate ? Number(duplicate[1]) || null : null;
  }

  function collectDavIds(doc) {
    if (!isDavListPage(doc)) return [];
    return [...doc.querySelectorAll('tr')]
      .filter(row => row.querySelector('button[onclick*="duplicarDav("]'))
      .map(extractDavId)
      .filter(id => Number.isFinite(id) && id > 0);
  }

  function snapshotExistingDavIds() {
    const ids = new Set();
    for (const doc of getFrameDocuments()) {
      for (const id of collectDavIds(doc)) ids.add(String(id));
    }
    return [...ids];
  }

  function createCheckbox(doc, anchor) {
    const wrapper = doc.createElement('div');
    wrapper.className = 'form-check form-check-inline mb-0 me-2 ms-auto flex-shrink-0';
    wrapper.id = MODULE_ID;

    const input = doc.createElement('input');
    input.type = 'checkbox';
    input.className = 'form-check-input';
    input.id = CHECKBOX_ID;
    input.autocomplete = 'off';

    const label = doc.createElement('label');
    label.className = 'form-check-label';
    label.htmlFor = CHECKBOX_ID;
    label.textContent = 'Emitir nota ao finalizar';

    wrapper.append(input, label);
    anchor.insertAdjacentElement('beforebegin', wrapper);
    return input;
  }

  function installCheckbox(doc) {
    if (!isDavCreationPage(doc)) return;
    if (doc.getElementById(CHECKBOX_ID)) return;

    // ⬛ Bloco: localiza a linha principal do cabeçalho.
    const headerRow = doc.querySelector(
      '.d-flex.align-items-center.justify-content-between.mb-3.flex-wrap.gap-2'
    );

    if (!headerRow) return;

    // ⬛ Bloco: localiza o grupo de botões à direita.
    const actionGroup = [...headerRow.children].find(el =>
      el.matches('.d-flex.gap-2') &&
      el.querySelector(
        '#btnObs, #btnFecharDav, #btnDetalhes, #btnVoltar2'
      )
    );

    if (!actionGroup) return;

    // ⬛ Bloco: insere o checkbox imediatamente antes dos botões.
    const input = createCheckbox(doc, actionGroup);
    const STORAGE_KEY = 'calebeHelperEmitirNotaAutomaticamente';

    input.checked = localStorage.getItem(STORAGE_KEY) === 'true';
    input.setAttribute('aria-checked', String(input.checked));

    // ⬛ Bloco: salva cada alteração para os próximos DAVs.
    input.addEventListener('change', () => {
      localStorage.setItem(STORAGE_KEY, String(input.checked));
      input.setAttribute('aria-checked', String(input.checked));
    });
  }

  // ⬛ Bloco: adiciona a opção de impressão térmica no fechamento do DAV.
  function installThermalOption(doc) {
    if (!isDavCreationPage(doc)) return;
    const select = doc.getElementById('tipoImpressao');
    if (!select || select.querySelector('option[value="3"]')) return;

    const option = doc.createElement('option');
    option.value = '3';
    option.textContent = 'Imprime DAV — Térmica Bobina 80x40';
    const noPrint = select.querySelector('option[value="0"]');
    if (noPrint) select.insertBefore(option, noPrint);
    else select.appendChild(option);
  }

  // ⬛ Bloco: restaura e memoriza a última opção de impressão selecionada.
  function installPrintTypePreference(doc) {
    if (!isDavCreationPage(doc)) return;

    const select = doc.getElementById('tipoImpressao');
    if (!select || observedPrintSelects.has(select)) return;

    let storage;

    try {
      storage = doc.defaultView.localStorage;
    } catch (error) {
      console.warn('[Calebe Helper] Não foi possível acessar a preferência de impressão salva.', error);
      return;
    }

    try {
      const savedValue = storage.getItem(PRINT_TYPE_STORAGE_KEY);

      if (
        savedValue !== null &&
        [...select.options].some(option => option.value === savedValue)
      ) {
        select.value = savedValue;
      }
    } catch (error) {
      console.warn('[Calebe Helper] Não foi possível restaurar a opção de impressão salva.', error);
    }

    select.addEventListener('change', () => {
      try {
        storage.setItem(PRINT_TYPE_STORAGE_KEY, select.value);
      } catch (error) {
        console.warn('[Calebe Helper] Não foi possível salvar a opção de impressão selecionada.', error);
      }
    });

    observedPrintSelects.add(select);
  }

  // ⬛ Bloco: registra a impressão térmica solicitada para este DAV.
  function beginPendingThermalPrint(doc, control) {
    if (!isFinalizationControl(control)) return;
    const select = doc.getElementById('tipoImpressao');
    if (select?.value !== '3') return;

    const idFromUrl = new URLSearchParams(String(doc.location?.search || '')).get('id');
    const davId = idFromUrl && /^\d+$/.test(idFromUrl) ? Number(idFromUrl) : null;
    const state = {
      createdAt: Date.now(),
      davId,
      baseline: snapshotExistingDavIds(),
      sourceUrl: String(doc.location?.href || '')
    };

    // O page-bridge executa no mundo principal; a janela é reservada ainda no clique do usuário.
    dispatchPageCommand(doc, { action: 'reserve-thermal-print-window' });

    try {
      getTopDocument().defaultView.sessionStorage.setItem(THERMAL_PENDING_KEY, JSON.stringify(state));
      console.info('[Calebe Helper] Impressão térmica selecionada; janela reservada e aguardando o fechamento bem-sucedido do DAV.');
    } catch (error) {
      console.warn('[Calebe Helper] Não foi possível guardar a impressão térmica pendente.', error);
    }
  }

  function loadPendingThermalPrint() {
    if (thermalPending) return;
    try {
      const storage = getTopDocument().defaultView.sessionStorage;
      const raw = storage.getItem(THERMAL_PENDING_KEY);
      const state = JSON.parse(raw || 'null');
      if (state?.createdAt && Date.now() - state.createdAt < WAIT_NEW_DAV_MS) {
        thermalPending = state;
      } else if (raw) {
        storage.removeItem(THERMAL_PENDING_KEY);
      }
    } catch { }
  }

  function clearPendingThermalPrint() {
    thermalPending = null;
    try { getTopDocument().defaultView.sessionStorage.removeItem(THERMAL_PENDING_KEY); } catch { }
  }

  // ⬛ Bloco: prepara o módulo nfe001 e executa a impressão nativa após confirmação do servidor.
  function requestThermalPrintAfterClose(sourceDoc, detail = {}) {
    loadPendingThermalPrint();
    if (!thermalPending) return;

    const davId = Number(detail.davId || thermalPending.davId) || null;
    if (!davId) {
      console.error('[Calebe Helper] O SATGO confirmou o fechamento, mas não foi possível identificar o ID do DAV.');
      clearPendingThermalPrint();
      return;
    }

    if (thermalPending.davId && Number(thermalPending.davId) !== davId) return;

    let sourceUrl;
    try { sourceUrl = new URL(thermalPending.sourceUrl); }
    catch {
      console.error('[Calebe Helper] Não foi possível recuperar a origem do DAV para preparar a impressão térmica.');
      clearPendingThermalPrint();
      return;
    }

    const sessionKey = sourceUrl.searchParams.get('chave');
    if (!sessionKey) {
      console.error('[Calebe Helper] Não foi possível recuperar a chave de sessão para preparar a impressão térmica.');
      clearPendingThermalPrint();
      return;
    }

    const host = getTopDocument();
    const frameId = 'calebe-helper-nfe-thermal-frame';
    let frame = host.getElementById(frameId);
    if (!frame) {
      frame = host.createElement('iframe');
      frame.id = frameId;
      frame.title = 'Preparação da impressão térmica';
      frame.setAttribute('aria-hidden', 'true');
      frame.style.cssText = 'position:fixed;width:1px;height:1px;left:-10000px;top:-10000px;border:0;opacity:0;pointer-events:none;';
      host.body.appendChild(frame);
    }

    const requestId = `thermal-${Date.now()}-${davId}`;
    let resultHandled = false;
    let resultTimer = null;

    const handleResult = event => {
      const result = event.detail || {};
      if (result.id !== requestId || resultHandled) return;
      resultHandled = true;
      if (resultTimer) clearTimeout(resultTimer);
      frame.contentDocument?.removeEventListener('calebe-helper:thermal-print-result', handleResult);

      if (result.ok) {
        console.info(`[Calebe Helper] DAV ${davId} fechado com sucesso; função nativa abrirEspelhoDavTermico(${davId}) executada.`);
        clearPendingThermalPrint();
      } else {
        console.error('[Calebe Helper] O módulo nfe001 não conseguiu executar a impressão térmica:', result.error || 'erro não informado');
        clearPendingThermalPrint();
      }
    };

    const executeInNfeFrame = () => {
      let nfeDoc;
      try { nfeDoc = frame.contentDocument; } catch { nfeDoc = null; }
      if (!nfeDoc?.documentElement) return;

      nfeDoc.addEventListener('calebe-helper:thermal-print-result', handleResult);
      console.info(`[Calebe Helper] Fechamento do DAV ${davId} confirmado pelo servidor; carregando o módulo nativo de impressão.`);
      if (!dispatchPageCommand(nfeDoc, {
        action: 'print-thermal-dav',
        davId,
        requestId,
        windowName: THERMAL_WINDOW_NAME
      })) {
        nfeDoc.removeEventListener('calebe-helper:thermal-print-result', handleResult);
        console.error('[Calebe Helper] Não foi possível enviar a solicitação ao módulo nativo de impressão.');
        clearPendingThermalPrint();
        return;
      }

      resultTimer = window.setTimeout(() => {
        if (resultHandled) return;
        resultHandled = true;
        nfeDoc.removeEventListener('calebe-helper:thermal-print-result', handleResult);
        console.error('[Calebe Helper] O módulo nfe001 não respondeu à solicitação de impressão térmica.');
        clearPendingThermalPrint();
      }, 12000);
    };

    // Reutiliza a página nfe001 que contém a função nativa; não depende de ela já estar visível na tela.
    const nfeUrl = new URL('/calweb/modulos/nfe001/nfe001.php', sourceUrl.origin);
    nfeUrl.searchParams.set('chave', sessionKey);
    const desiredUrl = nfeUrl.href;
    let currentUrl = '';
    try { currentUrl = frame.contentWindow.location.href; } catch { }

    if (currentUrl === desiredUrl && frame.contentDocument?.readyState === 'complete') {
      executeInNfeFrame();
    } else {
      frame.onload = executeInNfeFrame;
      frame.src = desiredUrl;
    }
  }

  // ⬛ Bloco: recebe a confirmação real da mesma resposta usada pelo fechamento nativo.
  function onDavCloseConfirmed(doc, event) {
    const detail = event.detail || {};
    if (!detail.ok) return;
    loadPendingThermalPrint();
    if (!thermalPending) return;
    const sourcePath = (() => {
      try { return new URL(thermalPending.sourceUrl).pathname; }
      catch { return ''; }
    })();
    if (!/\/dav0[12]\/dav0[12]_form\.php$/i.test(sourcePath)) return;
    requestThermalPrintAfterClose(doc, detail);
  }

  // ⬛ Bloco: remove solicitações que ficaram sem confirmação do servidor.
  function tryOpenThermalPrint() {
    loadPendingThermalPrint();
    if (!thermalPending) return;
    if (Date.now() - thermalPending.createdAt > WAIT_NEW_DAV_MS) {
      console.warn('[Calebe Helper] O servidor não confirmou o fechamento do DAV dentro do prazo; a impressão térmica não foi acionada.');
      clearPendingThermalPrint();
    }
  }

  function isFinalizationControl(control) {
    if (!control) return false;
    if (control.id === 'btnNovoDav' || control.matches('.calebe-helper-caixa-dav')) return false;

    const label = normalize([
      control.textContent,
      control.value,
      control.title,
      control.getAttribute('aria-label'),
      control.getAttribute('onclick'),
      control.id,
      control.className
    ].join(' ')).toLowerCase();

    if (/adicionar|incluir item|novo item|produto|observa[cç][aã]o|limpar|cancelar|voltar/.test(label)) return false;
    return /finalizar|concluir|gravar dav|salvar dav|confirmar dav|fechar dav|emitir dav|salvar|gravar|confirmar/.test(label);
  }

  function savePendingState() {
    try {
      getTopDocument().defaultView.sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
    } catch { }
  }

  function clearPendingState() {
    pending = null;
    try { getTopDocument().defaultView.sessionStorage.removeItem(PENDING_KEY); } catch { }
  }

  function loadPendingState() {
    if (pending) return;
    try {
      const raw = getTopDocument().defaultView.sessionStorage.getItem(PENDING_KEY);
      const data = JSON.parse(raw || 'null');
      if (data && data.createdAt && Date.now() - data.createdAt < WAIT_NEW_DAV_MS) pending = data;
      else if (raw) getTopDocument().defaultView.sessionStorage.removeItem(PENDING_KEY);
    } catch { }
  }

  function beginPendingEmit(doc, control) {
    const checkbox = doc.getElementById(CHECKBOX_ID);
    if (!checkbox?.checked || pending || !isFinalizationControl(control)) return;

    const baseline = snapshotExistingDavIds();
    pending = {
      createdAt: Date.now(),
      baseline,
      sourceUrl: String(doc.location?.href || ''),
      control: normalize(control.textContent || control.value || control.title)
    };
    savePendingState();
    console.info('[Calebe Helper] Emissão automática marcada; aguardando a confirmação do DAV salvo.');
  }

  function tryOpenCaixa(doc) {
    if (!pending || Date.now() - pending.createdAt > WAIT_NEW_DAV_MS) {
      if (pending) {
        console.warn('[Calebe Helper] Não foi possível localizar o novo DAV dentro do prazo; a Caixa DAV não foi aberta automaticamente.');
        clearPendingState();
      }
      return;
    }
    if (!isDavListPage(doc)) return;

    const baseline = new Set((pending.baseline || []).map(String));
    const candidates = [...doc.querySelectorAll('tr')]
      .map(row => ({ row, id: extractDavId(row), button: row.querySelector('button.calebe-helper-caixa-dav') }))
      .filter(item => item.id && !baseline.has(String(item.id)));

    // A dav1.js instala o botão Caixa DAV via MutationObserver. Aguarda até ele aparecer.
    const ready = candidates.find(item => item.button && !item.button.disabled);
    if (!ready) return;

    const id = ready.id;
    clearPendingState();
    console.info(`[Calebe Helper] DAV ${id} identificado; abrindo a mesma Caixa DAV do botão existente.`);
    ready.button.click();
  }

  function onDocumentClick(doc, event) {
    const target = event.target instanceof doc.defaultView.Element ? event.target : null;
    if (!target) return;
    const control = target.closest('button, a, input[type="button"], input[type="submit"]');
    if (!control) return;

    // Guarda a lista atual antes de abrir um DAV novo.
    if (control.id === 'btnNovoDav' || /novo dav/i.test(normalize(control.textContent || control.title))) {
      const ids = snapshotExistingDavIds();
      if (ids.length) {
        try {
          getTopDocument().defaultView.sessionStorage.setItem(
            `${PENDING_KEY}:baseline`,
            JSON.stringify(ids)
          );
        } catch { }
      }
      return;
    }

    if (!isDavCreationPage(doc)) return;
    beginPendingThermalPrint(doc, control);
    beginPendingEmit(doc, control);
  }

  function attachDocument(doc) {
    if (!doc?.documentElement || observedDocs.has(doc)) return;
    observedDocs.add(doc);
    doc.addEventListener('click', event => onDocumentClick(doc, event), true);
    doc.addEventListener('calebe-helper:dav-close-confirmed', event => onDavCloseConfirmed(doc, event));

    const observer = new MutationObserver(() => {
      installCheckbox(doc);
      installThermalOption(doc);
      installPrintTypePreference(doc);
      tryOpenCaixa(doc);
      tryOpenThermalPrint(doc);
    });
    observer.observe(doc.documentElement, { childList: true, subtree: true });

    installCheckbox(doc);
    installThermalOption(doc);
    installPrintTypePreference(doc);
    tryOpenCaixa(doc);
    tryOpenThermalPrint(doc);
  }

  function restoreBaselineIfAvailable() {
    if (!pending || (pending.baseline || []).length) return;
    try {
      const raw = getTopDocument().defaultView.sessionStorage.getItem(`${PENDING_KEY}:baseline`);
      const ids = JSON.parse(raw || '[]');
      if (Array.isArray(ids) && ids.length) {
        pending.baseline = ids.map(String);
        savePendingState();
      }
    } catch { }
  }

  function scan() {
    loadPendingState();
    loadPendingThermalPrint();
    restoreBaselineIfAvailable();
    for (const doc of getFrameDocuments()) {
      attachDocument(doc);
      installCheckbox(doc);
      installThermalOption(doc);
      installPrintTypePreference(doc);
      tryOpenCaixa(doc);
      tryOpenThermalPrint(doc);
    }
  }

  scan();
  scanTimer = window.setInterval(scan, SCAN_INTERVAL_MS);
  window.addEventListener('pagehide', () => {
    if (scanTimer) window.clearInterval(scanTimer);
  }, { once: true });
})();
(() => {
  'use strict';

  // ⬛ Bloco: configuração e estado do módulo.
  const MODULE_ID = 'calebe-helper-emitir-nota';
  const CHECKBOX_ID = 'calebe-helper-emitir-nota-finalizar';
  const PENDING_KEY = 'calebeHelperEmitirNotaPendenteV1';
  const BASELINE_KEY = `${PENDING_KEY}:baseline`;
  const THERMAL_PENDING_KEY = 'calebeHelperImpressaoTermicaPendenteV1';
  const PRINT_TYPE_STORAGE_KEY = 'calebeHelperTipoImpressaoDAV';
  const EMIT_STORAGE_KEY = 'calebeHelperEmitirNotaAutomaticamente';
  const THERMAL_OPTION_VALUE = '3';
  const THERMAL_WINDOW_NAME = 'calebeHelperThermalPrint';
  const THERMAL_FRAME_ID = 'calebe-helper-nfe-thermal-frame';
  const SCAN_INTERVAL_MS = 500;
  const WAIT_NEW_DAV_MS = 45000;
  const WAIT_THERMAL_CONFIRM_MS = 45000; // o fechar_dav grava venda, estoque e financeiro: pode passar de 2 s
  const WAIT_THERMAL_RESULT_MS = 12000;
  const CONFIRMED_CAIXA_RETRY_MS = 2000;
  const WAIT_CAIXA_PAGE_MS = 30000;
  const THERMAL_TITLE_TIMEOUT_MS = 15000;
  const THERMAL_TITLE_INTERVAL_MS = 50;

  const observedDocs = new WeakSet();
  const observedPrintSelects = new WeakSet();
  let pending = null;
  let thermalPending = null;
  let pendingCaixa = null;
  let scanTimer = null;
  let thermalTitleTimer = null;
  let lastSavedBaseline = '';
  let lastConfirmedCaixaAttemptAt = 0;

  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();

  const getTopDocument = () => {
    try { return window.top.document; } catch { return document; }
  };

  // ⬛ Bloco: persistência temporária (sessionStorage da janela principal).
  const topStorage = () => {
    try { return getTopDocument().defaultView.sessionStorage; } catch { return null; }
  };

  function loadState(key, ttl) {
    const storage = topStorage();
    try {
      const raw = storage?.getItem(key);
      const data = JSON.parse(raw || 'null');
      if (data?.createdAt && Date.now() - data.createdAt < ttl) return data;
      if (raw) storage.removeItem(key);
    } catch { }
    return null;
  }

  const saveState = (key, data) => {
    try { topStorage()?.setItem(key, JSON.stringify(data)); } catch { }
  };

  const removeState = key => {
    try { topStorage()?.removeItem(key); } catch { }
  };

  const loadPending = () => { pending ||= loadState(PENDING_KEY, WAIT_NEW_DAV_MS); };
  const savePending = () => saveState(PENDING_KEY, pending);
  const clearPending = () => { pending = null; removeState(PENDING_KEY); };

  const loadThermalPending = () => { thermalPending ||= loadState(THERMAL_PENDING_KEY, WAIT_THERMAL_CONFIRM_MS); };
  const clearThermalPending = () => { thermalPending = null; removeState(THERMAL_PENDING_KEY); };

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

  function getFrameDocuments(root = getTopDocument(), docs = [], seen = new Set(), depth = 0) {
    if (!root?.documentElement || seen.has(root) || depth > 4) return docs;

    seen.add(root);
    docs.push(root);

    for (const frame of root.querySelectorAll('iframe')) {
      let child = null;
      try { child = frame.contentDocument; } catch { }
      if (child) getFrameDocuments(child, docs, seen, depth + 1);
    }

    return docs;
  }

  // ⬛ Bloco: identificação das telas do DAV.
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

  function isPaymentAttentionPage(doc) {
    if (!doc?.body) return false;
    return /ATENÇÃO AO PAGAMENTO/i.test(normalize(doc.body.innerText || doc.body.textContent));
  }

  const collectDavRows = doc => doc?.documentElement
    ? [...doc.querySelectorAll('tr')].filter(row => row.querySelector('button[onclick*="duplicarDav("]'))
    : [];

  function isDavListPage(doc) {
    if (!doc?.documentElement) return false;
    const heading = [...doc.querySelectorAll('h6')].some(el =>
      /DAV01[\s\S]{0,40}Documento Auxiliar de Venda/i.test(el.textContent || '')
    );
    if (heading) return true;

    // Nas abas novas a listagem pode perder o h6; o botão nativo continua presente.
    return Boolean(doc.getElementById('btnNovoDav')) && collectDavRows(doc).length > 0;
  }

  function extractDavId(row) {
    const formatted = String(row?.textContent || '').match(/\b\d{3}-(\d{5,})\b/);
    if (formatted) return Number(formatted[1]) || null;

    const onclicks = [
      row?.getAttribute?.('onclick'),
      ...[...(row?.querySelectorAll?.('[onclick]') || [])].map(el => el.getAttribute('onclick'))
    ];

    for (const onclick of onclicks) {
      const match = String(onclick || '').match(
        /(?:duplicarDav|abrirDav|selecionarLinha)\s*\(\s*(?:this\s*,\s*)?(\d+)/
      );
      if (match) return Number(match[1]) || null;
    }

    return null;
  }

  const collectDavIds = doc => isDavListPage(doc)
    ? collectDavRows(doc).map(extractDavId).filter(id => Number.isFinite(id) && id > 0)
    : [];

  function davIdFromUrl(url) {
    try {
      const value = new URL(String(url || '')).searchParams.get('id');
      return value && /^\d+$/.test(value) ? Number(value) : null;
    } catch {
      return null;
    }
  }

  // ⬛ Bloco: referência dos DAVs existentes (distingue o DAV novo dos antigos).
  function snapshotExistingDavIds() {
    const ids = new Set();
    for (const doc of getFrameDocuments()) {
      for (const id of collectDavIds(doc)) ids.add(String(id));
    }
    return [...ids];
  }

  function persistBaseline(ids) {
    const values = [...new Set((ids || []).map(String))];
    if (!values.length) return;

    const serialized = JSON.stringify(values);
    if (serialized === lastSavedBaseline) return;

    try {
      topStorage().setItem(BASELINE_KEY, serialized);
      lastSavedBaseline = serialized;
    } catch { }
  }

  function restoreBaselineIfAvailable() {
    if (!pending || (pending.baseline || []).length) return;
    try {
      const ids = JSON.parse(topStorage().getItem(BASELINE_KEY) || '[]');
      if (Array.isArray(ids) && ids.length) {
        pending.baseline = ids.map(String);
        savePending();
      }
    } catch { }
  }

  // ⬛ Bloco: checkbox "Emitir nota ao finalizar" com preferência persistente.
  function installCheckbox(doc) {
    if (!isDavCreationPage(doc) || doc.getElementById(CHECKBOX_ID)) return;

    const headerRow = doc.querySelector(
      '.d-flex.align-items-center.justify-content-between.mb-3.flex-wrap.gap-2'
    );
    if (!headerRow) return;

    const actionGroup = [...headerRow.children].find(el =>
      el.matches('.d-flex.gap-2') &&
      el.querySelector('#btnObs, #btnFecharDav, #btnDetalhes, #btnVoltar2')
    );
    if (!actionGroup) return;

    const wrapper = doc.createElement('div');
    wrapper.className = 'form-check form-check-inline mb-0 me-2 ms-auto flex-shrink-0';
    wrapper.id = MODULE_ID;

    const input = doc.createElement('input');
    input.type = 'checkbox';
    input.className = 'form-check-input';
    input.id = CHECKBOX_ID;
    input.autocomplete = 'off';
    input.checked = localStorage.getItem(EMIT_STORAGE_KEY) === 'true';
    input.setAttribute('aria-checked', String(input.checked));

    const label = doc.createElement('label');
    label.className = 'form-check-label';
    label.htmlFor = CHECKBOX_ID;
    label.textContent = 'Emitir nota ao finalizar';

    wrapper.append(input, label);
    actionGroup.insertAdjacentElement('beforebegin', wrapper);

    input.addEventListener('change', () => {
      localStorage.setItem(EMIT_STORAGE_KEY, String(input.checked));
      input.setAttribute('aria-checked', String(input.checked));
    });
  }

  // ⬛ Bloco: opção de impressão térmica no fechamento do DAV.
  function installThermalOption(doc) {
    if (!isDavCreationPage(doc)) return;
    const select = doc.getElementById('tipoImpressao');
    if (!select || select.querySelector(`option[value="${THERMAL_OPTION_VALUE}"]`)) return;

    const option = doc.createElement('option');
    option.value = THERMAL_OPTION_VALUE;
    option.textContent = 'Imprime DAV — Térmica Bobina 80x40';
    select.insertBefore(option, select.querySelector('option[value="0"]'));
  }

  // ⬛ Bloco: restaura e memoriza a última opção de impressão selecionada.
  function installPrintTypePreference(doc) {
    if (!isDavCreationPage(doc)) return;

    const select = doc.getElementById('tipoImpressao');
    if (!select || observedPrintSelects.has(select)) return;

    let storage;
    try {
      storage = doc.defaultView.localStorage;
      const saved = storage.getItem(PRINT_TYPE_STORAGE_KEY);
      if (saved !== null && [...select.options].some(option => option.value === saved)) {
        select.value = saved;
      }
    } catch (error) {
      console.warn('[Calebe Helper] Não foi possível restaurar a opção de impressão salva.', error);
      if (!storage) return;
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

  // ⬛ Bloco: registra a impressão térmica somente na confirmação do pagamento.
  function beginPendingThermalPrint(doc, control) {
    if (!isPaymentAttentionPage(doc) || !isFinalizationControl(control)) return;

    let printType = doc.getElementById('tipoImpressao')?.value || '';

    // Recupera a última opção salva caso o seletor não esteja nesta tela.
    if (!printType) {
      try { printType = doc.defaultView.localStorage.getItem(PRINT_TYPE_STORAGE_KEY) || ''; } catch { }
    }
    if (printType !== THERMAL_OPTION_VALUE) return;

    const sourceUrl = String(doc.location?.href || '');
    thermalPending = { createdAt: Date.now(), davId: davIdFromUrl(sourceUrl), sourceUrl };

    // A janela somente é reservada neste clique, na tela ATENÇÃO AO PAGAMENTO.
    dispatchPageCommand(doc, { action: 'reserve-thermal-print-window' });
    saveState(THERMAL_PENDING_KEY, thermalPending);

    console.info(
      `[Calebe Helper] ATENÇÃO AO PAGAMENTO: fechamento solicitado; janela de impressão reservada e aguardando confirmação do servidor por até ${WAIT_THERMAL_CONFIRM_MS / 1000} segundos.`
    );
  }

  // ⬛ Bloco: remove solicitações térmicas que ficaram sem confirmação do servidor.
  function expireThermalPending() {
    loadThermalPending();
    if (thermalPending && Date.now() - thermalPending.createdAt > WAIT_THERMAL_CONFIRM_MS) {
      console.warn('[Calebe Helper] O servidor não confirmou o fechamento do DAV dentro do prazo; a impressão térmica não foi acionada.');
      clearThermalPending();
    }
  }

  // ⬛ Bloco: define o #title da página térmica como "DAV Nº <número>".
  function stopThermalTitle() {
    if (thermalTitleTimer) window.clearInterval(thermalTitleTimer);
    thermalTitleTimer = null;
  }

  function startThermalTitle(davId, ...candidateWindows) {
    stopThermalTitle();

    const id = Number(davId);
    if (!Number.isFinite(id) || id <= 0) return;

    // Reabre pelo nome a janela reservada (URL vazia não navega a janela existente).
    let popup = null;
    for (const win of candidateWindows) {
      try { popup = win?.open?.('', THERMAL_WINDOW_NAME) || null; } catch { }
      if (popup) break;
    }
    if (!popup) return;

    const expectedTitle = `DAV Nº ${id}`;
    const deadline = Date.now() + THERMAL_TITLE_TIMEOUT_MS;
    let announced = false;

    const applyTitle = () => {
      let docs;
      try {
        if (popup.closed) return stopThermalTitle();
        docs = getFrameDocuments(popup.document);
      } catch {
        return; // documento em transição durante a navegação da janela
      }

      for (const doc of docs) {
        const title = doc.getElementById('title');
        if (!title) continue;

        // O SATGO pode reescrever o título após o carregamento; por isso reaplica até o prazo.
        const prop = /^(INPUT|TEXTAREA|SELECT)$/.test(title.tagName) ? 'value' : 'textContent';
        if (normalize(title[prop]) !== expectedTitle) {
          title[prop] = expectedTitle;
          if (!announced) {
            announced = true;
            console.info(`[Calebe Helper] Título da impressão térmica atualizado para "${expectedTitle}".`);
          }
        }
        return;
      }
    };

    applyTitle();
    thermalTitleTimer = window.setInterval(() => {
      if (Date.now() > deadline) stopThermalTitle();
      else applyTitle();
    }, THERMAL_TITLE_INTERVAL_MS);
  }

  // ⬛ Bloco: prepara o módulo nfe001 e executa a impressão nativa após confirmação do servidor.
  function requestThermalPrintAfterClose(sourceDoc, detail = {}) {
    loadThermalPending();
    if (!thermalPending) return;

    const fail = message => {
      stopThermalTitle();
      console.error(`[Calebe Helper] ${message}`);
      clearThermalPending();
    };

    const davId = Number(detail.davId || thermalPending.davId) || null;
    if (!davId) return fail('O SATGO confirmou o fechamento, mas não foi possível identificar o ID do DAV.');
    if (thermalPending.davId && Number(thermalPending.davId) !== davId) return;

    let sourceUrl;
    try { sourceUrl = new URL(thermalPending.sourceUrl); }
    catch { return fail('Não foi possível recuperar a origem do DAV para preparar a impressão térmica.'); }

    const sessionKey = sourceUrl.searchParams.get('chave');
    if (!sessionKey) return fail('Não foi possível recuperar a chave de sessão para preparar a impressão térmica.');

    const host = getTopDocument();
    let frame = host.getElementById(THERMAL_FRAME_ID);
    if (!frame) {
      frame = host.createElement('iframe');
      frame.id = THERMAL_FRAME_ID;
      frame.title = 'Preparação da impressão térmica';
      frame.setAttribute('aria-hidden', 'true');
      frame.style.cssText = 'position:fixed;width:1px;height:1px;left:-10000px;top:-10000px;border:0;opacity:0;pointer-events:none;';
      host.body.appendChild(frame);
    }

    const requestId = `thermal-${Date.now()}-${davId}`;
    let nfeDoc = null;
    let resultTimer = null;
    let finished = false;

    const finish = errorMessage => {
      if (finished) return;
      finished = true;
      window.clearTimeout(resultTimer);
      nfeDoc?.removeEventListener('calebe-helper:thermal-print-result', onResult);

      if (errorMessage) return fail(errorMessage);
      console.info(`[Calebe Helper] DAV ${davId} fechado com sucesso; função nativa abrirEspelhoDavTermico(${davId}) executada.`);
      clearThermalPending();
    };

    function onResult(event) {
      const result = event.detail || {};
      if (result.id !== requestId) return;
      finish(result.ok ? '' : `O módulo nfe001 não conseguiu executar a impressão térmica: ${result.error || 'erro não informado'}`);
    }

    const executeInNfeFrame = () => {
      try { nfeDoc = frame.contentDocument; } catch { nfeDoc = null; }
      if (!nfeDoc?.documentElement || finished) return;
      frame.onload = null; // impede reexecução caso a página nfe001 recarregue

      nfeDoc.addEventListener('calebe-helper:thermal-print-result', onResult);
      console.info(`[Calebe Helper] Fechamento do DAV ${davId} confirmado pelo servidor; carregando o módulo nativo de impressão.`);
      startThermalTitle(davId, sourceDoc.defaultView, frame.contentWindow, window);

      if (!dispatchPageCommand(nfeDoc, {
        action: 'print-thermal-dav',
        davId,
        requestId,
        windowName: THERMAL_WINDOW_NAME
      })) {
        return finish('Não foi possível enviar a solicitação ao módulo nativo de impressão.');
      }

      resultTimer = window.setTimeout(
        () => finish('O módulo nfe001 não respondeu à solicitação de impressão térmica.'),
        WAIT_THERMAL_RESULT_MS
      );
    };

    // Reutiliza a página nfe001 que contém a função nativa; não depende de ela já estar visível na tela.
    const nfeUrl = new URL('/calweb/modulos/nfe001/nfe001.php', sourceUrl.origin);
    nfeUrl.searchParams.set('chave', sessionKey);
    let currentUrl = '';
    try { currentUrl = frame.contentWindow.location.href; } catch { }

    if (currentUrl === nfeUrl.href && frame.contentDocument?.readyState === 'complete') {
      executeInNfeFrame();
    } else {
      frame.onload = executeInNfeFrame;
      frame.src = nfeUrl.href;
    }
  }

  // ⬛ Bloco: usa a mesma rotina do botão Caixa DAV da listagem, agora com o ID confirmado pelo servidor.
  function openCaixaForDav(davId) {
    const id = Number(davId);
    if (!Number.isFinite(id) || id <= 0) return false;

    if (typeof window.calebeHelperOpenCaixaDav === 'function') {
      try {
        window.calebeHelperOpenCaixaDav(id);
        return true;
      } catch { }
    }

    // Alternativa autônoma para pacotes que não expõem a rotina da dav1.js.
    let link = null;
    for (const doc of getFrameDocuments()) {
      link = doc.querySelector('a[href*="modulos/nfe001/nfe001.php"]');
      if (link) break;
    }
    if (!link) return false;

    pendingCaixa = { davId: id, createdAt: Date.now() };
    link.click();
    return true;
  }

  // ⬛ Bloco: conclui a abertura da Caixa DAV quando a página nfe001 carrega.
  function isNfeCaixaPage(doc) {
    if (!doc?.documentElement) return false;
    if (/\/modulos\/nfe001\/nfe001\.php$/i.test(String(doc.location?.pathname || ''))) return true;
    return Boolean(doc.getElementById('filtAcao')) ||
      Boolean(doc.querySelector('a[onclick*="abrirCaixaDav("]'));
  }

  function installPendingCaixa(doc) {
    if (!pendingCaixa) return;

    if (Date.now() - pendingCaixa.createdAt > WAIT_CAIXA_PAGE_MS) {
      pendingCaixa = null;
      return;
    }

    if (!isNfeCaixaPage(doc)) return;

    const mode = doc.getElementById('filtAcao');
    if (mode && mode.value !== 'emitir') {
      mode.value = 'emitir';
      mode.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
      return;
    }

    const nativeLink = [...doc.querySelectorAll('a[onclick*="abrirCaixaDav("]')].find(link => {
      const match = String(link.getAttribute('onclick') || '').match(/abrirCaixaDav\s*\(\s*(\d+)\s*,\s*1/);
      return match && Number(match[1]) === pendingCaixa.davId;
    });
    if (!nativeLink) return;

    pendingCaixa = null;
    nativeLink.click();
  }

  // ⬛ Bloco: emissão automática após a confirmação do fechamento do DAV.
  function openConfirmedCaixa(davId) {
    if (!openCaixaForDav(davId)) return false;
    clearPending();
    console.info(`[Calebe Helper] Fechamento do DAV ${davId} confirmado; Caixa DAV aberta automaticamente.`);
    return true;
  }

  function confirmPendingEmit(detail = {}) {
    loadPending();
    if (!pending) return;

    const detailDavId = Number(detail.davId) || null;
    const pendingDavId = Number(pending.davId) || null;
    if (pendingDavId && detailDavId && pendingDavId !== detailDavId) return;

    const davId = detailDavId || pendingDavId;
    if (!davId) return;

    pending.confirmedDavId = davId;
    savePending();

    if (!openConfirmedCaixa(davId)) {
      console.warn('[Calebe Helper] O DAV foi fechado, mas a Caixa DAV não abriu pela rotina compartilhada; tentando pela listagem.');
    }
  }

  function retryConfirmedCaixa() {
    if (!pending?.confirmedDavId) return;
    if (Date.now() - lastConfirmedCaixaAttemptAt < CONFIRMED_CAIXA_RETRY_MS) return;

    lastConfirmedCaixaAttemptAt = Date.now();
    openConfirmedCaixa(Number(pending.confirmedDavId));
  }

  // ⬛ Bloco: recebe a confirmação real da mesma resposta usada pelo fechamento nativo.
  function onDavCloseConfirmed(doc, event) {
    const detail = event.detail || {};
    if (!detail.ok) return;

    loadThermalPending();
    if (thermalPending) {
      let sourcePath = '';
      try { sourcePath = new URL(thermalPending.sourceUrl).pathname; } catch { }
      if (/\/dav0[12]\/dav0[12]_form\.php$/i.test(sourcePath)) requestThermalPrintAfterClose(doc, detail);
    }

    confirmPendingEmit(detail);
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
    return /finalizar|concluir|gravar dav|salvar dav|confirmar dav|fechar dav|fechar|emitir dav|salvar|gravar|confirmar/.test(label);
  }

  function isEmitPreferenceEnabled(doc) {
    const checkbox = doc.getElementById(CHECKBOX_ID);
    if (checkbox) return checkbox.checked;
    try { return getTopDocument().defaultView.localStorage.getItem(EMIT_STORAGE_KEY) === 'true'; } catch { return false; }
  }

  function beginPendingEmit(doc, control) {
    if (!isFinalizationControl(control)) return;

    if (pending && Date.now() - pending.createdAt > WAIT_NEW_DAV_MS) clearPending();

    // Cada nova etapa de finalização renova o prazo (ex.: pagamento demorado).
    if (pending) {
      const checkbox = doc.getElementById(CHECKBOX_ID);
      if (checkbox && !checkbox.checked) {
        clearPending();
        return;
      }
      pending.createdAt = Date.now();
      pending.davId ||= davIdFromUrl(doc.location?.href);
      savePending();
      return;
    }

    if (!isEmitPreferenceEnabled(doc)) return;

    const baseline = snapshotExistingDavIds();
    persistBaseline(baseline);

    lastConfirmedCaixaAttemptAt = 0;
    pendingCaixa = null;
    pending = {
      createdAt: Date.now(),
      baseline,
      davId: davIdFromUrl(doc.location?.href),
      confirmedDavId: null
    };
    savePending();
    console.info('[Calebe Helper] Emissão automática marcada; aguardando a confirmação do DAV salvo.');
  }

  function tryOpenCaixa(doc) {
    if (!pending) return;

    if (Date.now() - pending.createdAt > WAIT_NEW_DAV_MS) {
      const missingBaseline = !(pending.baseline || []).length && !pending.confirmedDavId;
      console.warn(
        missingBaseline
          ? '[Calebe Helper] Não foi possível localizar o novo DAV dentro do prazo; a listagem de DAVs não estava aberta para registrar a referência inicial.'
          : '[Calebe Helper] Não foi possível localizar o novo DAV dentro do prazo; a Caixa DAV não foi aberta automaticamente.'
      );
      clearPending();
      return;
    }

    if (!isDavListPage(doc)) return;

    const baseline = new Set((pending.baseline || []).map(String));
    const confirmedId = Number(pending.confirmedDavId) || null;
    const rows = collectDavRows(doc)
      .map(row => ({ id: extractDavId(row), button: row.querySelector('button.calebe-helper-caixa-dav') }))
      .filter(item => Number.isFinite(item.id) && item.id > 0);

    // Sem referência inicial não dá para diferenciar o DAV novo dos antigos.
    if (!confirmedId && !baseline.size) return;
    const candidates = rows.filter(item => confirmedId ? item.id === confirmedId : !baseline.has(String(item.id)));

    // A dav1.js instala o botão Caixa DAV via MutationObserver. Aguarda até ele aparecer.
    const ready = candidates.find(item => item.button && !item.button.disabled);
    if (!ready) return;

    clearPending();
    console.info(`[Calebe Helper] DAV ${ready.id} identificado; abrindo a mesma Caixa DAV do botão existente.`);
    ready.button.click();
  }

  // ⬛ Bloco: cliques nos documentos observados.
  function onDocumentClick(doc, event) {
    const target = event.target instanceof doc.defaultView.Element ? event.target : null;
    const control = target?.closest('button, a, input[type="button"], input[type="submit"]');
    if (!control) return;

    // Guarda a lista atual antes de abrir um DAV novo.
    if (control.id === 'btnNovoDav' || /novo dav/i.test(normalize(control.textContent || control.title))) {
      persistBaseline(snapshotExistingDavIds());
      return;
    }

    // Emissão automática: tela de criação do DAV; a tela ATENÇÃO AO PAGAMENTO renova o prazo.
    const paymentPage = isPaymentAttentionPage(doc);
    if (paymentPage || isDavCreationPage(doc)) beginPendingEmit(doc, control);

    // Impressão térmica somente na tela ATENÇÃO AO PAGAMENTO.
    if (paymentPage) beginPendingThermalPrint(doc, control);
  }

  function installAll(doc) {
    installCheckbox(doc);
    installThermalOption(doc);
    installPrintTypePreference(doc);
    installPendingCaixa(doc);
    tryOpenCaixa(doc);
    expireThermalPending();
  }

  function attachDocument(doc) {
    if (!doc?.documentElement) return;

    if (!observedDocs.has(doc)) {
      observedDocs.add(doc);
      doc.addEventListener('click', event => onDocumentClick(doc, event), true);
      doc.addEventListener('calebe-helper:dav-close-confirmed', event => onDavCloseConfirmed(doc, event));
      new MutationObserver(() => installAll(doc)).observe(doc.documentElement, { childList: true, subtree: true });
    }

    installAll(doc);
  }

  function scan() {
    loadPending();
    loadThermalPending();
    restoreBaselineIfAvailable();

    if (pending) retryConfirmedCaixa();
    // Mantém a última listagem conhecida como referência para o próximo DAV.
    else persistBaseline(snapshotExistingDavIds());

    getFrameDocuments().forEach(attachDocument);
  }

  scan();
  scanTimer = window.setInterval(scan, SCAN_INTERVAL_MS);
  window.addEventListener('pagehide', () => {
    window.clearInterval(scanTimer);
    stopThermalTitle();
  }, { once: true });
})();

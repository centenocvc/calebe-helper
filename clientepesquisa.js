(() => {
  'use strict';

  const MENU_ID = 'calebe-client-search-menu';
  const HISTORY_ID = 'calebe-client-search-history-dropdown';
  const HISTORY_STORAGE_KEY = 'calebeClientSearchHistoryV1';
  const EMPTY_ROW_ID = 'calebe-client-search-empty-row';
  const DEDUPE_INTERVAL_MS = 500;
  const MAX_HISTORY_ITEMS = 20;
  const MAX_HISTORY_SUGGESTIONS = 7;
  const REQUIRED_CLIENT_FIELDS = [
    'ClienteRazaoSocial',
    'ClienteNomeFantazia',
    'ClienteCGC',
    'ClienteMunicipio',
    'ClienteCodigo'
  ];
  const SEARCH_GROUPS = {
    name: {
      criterion: 'nome',
      nativeFields: ['ClienteRazaoSocial', 'ClienteNomeFantazia'],
      nativeValue: 'ClienteRazaoSocial'
    },
    location: {
      criterion: 'municipio',
      nativeFields: ['ClienteMunicipio'],
      nativeValue: 'ClienteMunicipio'
    }
  };
  const CRITERION_LABELS = {
    nome: 'Nome',
    municipio: 'Município',
    codigo: 'Código',
    documento: 'CPF/CNPJ'
  };

  let currentDocument = null;
  let currentController = null;
  const wiredFrames = new WeakSet();
  let observedFrameDocument = null;
  let frameDocumentObserver = null;

  function hasRequiredClientFields(select) {
    if (!select) return false;
    const values = new Set([...select.options].map(option => option.value));
    return REQUIRED_CLIENT_FIELDS.every(value => values.has(value));
  }

  function findClientSearchCard(doc) {
    if (!doc) return null;
    return [...doc.querySelectorAll('.card.mb-3')].find(card => {
      const header = card.querySelector(':scope > .card-header');
      const form = card.querySelector(':scope form#formFiltro, form#formFiltro');
      const input = form?.querySelector('input[name="q"]');
      const select = form?.querySelector('select[name="campo"].form-control');
      return /Clientes\s*\/\s*Fornecedores/i.test(header?.textContent || '') &&
        Boolean(form && input && hasRequiredClientFields(select));
    }) || null;
  }

  function findFieldColumn(control, commonParent) {
    let node = control;
    while (node?.parentElement && node.parentElement !== commonParent) {
      if (node.parentElement.parentElement === commonParent) return node.parentElement;
      node = node.parentElement;
    }
    return control.parentElement;
  }

  function swapNativeColumns(input, select) {
    let commonParent = input.parentElement;
    while (commonParent && !commonParent.contains(select)) commonParent = commonParent.parentElement;
    if (!commonParent) return;
    const inputColumn = findFieldColumn(input, commonParent);
    const selectColumn = findFieldColumn(select, commonParent);
    if (!inputColumn || !selectColumn || inputColumn === selectColumn) return;
    if (inputColumn.nextElementSibling !== selectColumn) commonParent.insertBefore(inputColumn, selectColumn);
  }

  function createMethodMenu(doc) {
    doc.getElementById(MENU_ID)?.remove();
    const menu = doc.createElement('div');
    menu.id = MENU_ID;
    menu.className = 'calebe-client-search-menu';
    menu.hidden = true;
    Object.assign(menu.style, {
      position: 'fixed', display: 'none', flexDirection: 'column', background: '#fff',
      border: '1px solid #ced4da', borderRadius: '7px',
      boxShadow: '0 0.25rem 0.75rem rgba(0, 0, 0, 0.12)', overflow: 'hidden',
      zIndex: '2147483646'
    });
    for (const [method, label] of [
      ['name', 'Razão Social / Fantasia'],
      ['location', 'Setor / Município']
    ]) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'calebe-client-search-option';
      button.dataset.method = method;
      button.textContent = label;
      Object.assign(button.style, {
        width: '100%', padding: '0.45rem 0.75rem', border: '0', background: '#fff',
        color: '#212529', textAlign: 'left', cursor: 'pointer'
      });
      menu.appendChild(button);
    }
    doc.body.appendChild(menu);
    return menu;
  }

  function createHistoryDropdown(doc) {
    doc.getElementById(HISTORY_ID)?.remove();
    const dropdown = doc.createElement('div');
    dropdown.id = HISTORY_ID;
    dropdown.className = 'calebe-client-search-history-dropdown';
    dropdown.setAttribute('role', 'listbox');
    dropdown.hidden = true;
    Object.assign(dropdown.style, {
      position: 'fixed', display: 'none', flexDirection: 'column', background: '#fff',
      border: '1px solid #ced4da', borderRadius: '7px',
      boxShadow: '0 0.25rem 0.75rem rgba(0, 0, 0, 0.12)', overflow: 'hidden',
      zIndex: '2147483645'
    });
    doc.body.appendChild(dropdown);
    return dropdown;
  }

  function normalizeHistoryTerm(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('pt-BR')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function initializeClientSearch(doc, card) {
    const form = card.querySelector(':scope form#formFiltro, form#formFiltro');
    const select = form.querySelector('select[name="campo"].form-control');
    const input = form.querySelector('input[name="q"]');

    currentController?.abort();
    currentDocument = doc;
    currentController = new AbortController();
    const { signal } = currentController;

    swapNativeColumns(input, select);
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('aria-controls', HISTORY_ID);
    input.setAttribute('aria-expanded', 'false');

    const menu = createMethodMenu(doc);
    const methodOptions = [...menu.querySelectorAll('.calebe-client-search-option')];
    const historyDropdown = createHistoryDropdown(doc);
    let historyItems = [];
    let visibleHistoryItems = [];
    let highlightedHistoryIndex = -1;
    let clearConfirmationPending = false;
    let suppressNextEnterKeyup = false;
    let busy = false;
    let activeSearch = null;
    let lastSignature = '';
    let lastSearchAt = 0;

    function positionMethodMenu() {
      if (menu.hidden) return;
      const rect = select.getBoundingClientRect();
      Object.assign(menu.style, {
        left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`,
        minHeight: `${rect.height}px`
      });
    }

    function positionHistoryDropdown() {
      if (historyDropdown.hidden) return;
      const rect = input.getBoundingClientRect();
      Object.assign(historyDropdown.style, {
        left: `${rect.left}px`, top: `${rect.bottom + 2}px`, width: `${rect.width}px`
      });
    }

    function closeMethodMenu() {
      menu.hidden = true;
      menu.style.display = 'none';
    }

    function openMethodMenu(force = false) {
      if (!force && !input.value.trim()) return closeMethodMenu();
      menu.hidden = false;
      menu.style.display = 'flex';
      positionMethodMenu();
    }

    function closeHistory() {
      historyDropdown.hidden = true;
      historyDropdown.style.display = 'none';
      highlightedHistoryIndex = -1;
      clearConfirmationPending = false;
      input.setAttribute('aria-expanded', 'false');
    }

    function getFilteredHistoryItems() {
      const filter = normalizeHistoryTerm(input.value);
      return historyItems
        .filter(item => !filter || item.normalized.includes(filter))
        .sort((first, second) => {
          const firstStarts = filter && first.normalized.startsWith(filter) ? 1 : 0;
          const secondStarts = filter && second.normalized.startsWith(filter) ? 1 : 0;
          return secondStarts - firstStarts || second.lastUsedAt - first.lastUsedAt;
        })
        .slice(0, MAX_HISTORY_SUGGESTIONS);
    }

    function setHighlightedHistoryIndex(index) {
      if (!visibleHistoryItems.length) {
        highlightedHistoryIndex = -1;
      } else {
        highlightedHistoryIndex = (index + visibleHistoryItems.length) % visibleHistoryItems.length;
      }
      historyDropdown.querySelectorAll('[role="option"]').forEach((option, optionIndex) => {
        const selected = optionIndex === highlightedHistoryIndex;
        option.setAttribute('aria-selected', String(selected));
        option.style.background = selected ? '#e7f1ff' : '#fff';
      });
    }

    async function persistHistory() {
      await chrome.storage.local.set({
        [HISTORY_STORAGE_KEY]: { version: 1, items: historyItems.slice(0, MAX_HISTORY_ITEMS) }
      });
    }

    async function deleteHistoryItem(normalized) {
      historyItems = historyItems.filter(item => item.normalized !== normalized);
      await persistHistory();
      renderHistory();
    }

    function createHistoryOption(item, index) {
      const row = doc.createElement('div');
      row.className = 'calebe-client-search-history-item';
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(index === highlightedHistoryIndex));
      Object.assign(row.style, {
        display: 'flex', alignItems: 'center', width: '100%', background: '#fff'
      });

      const chooseButton = doc.createElement('button');
      chooseButton.type = 'button';
      chooseButton.className = 'calebe-client-search-history-choice';
      chooseButton.tabIndex = -1;
      Object.assign(chooseButton.style, {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem',
        flex: '1 1 auto', minWidth: '0', padding: '0.45rem 0.65rem', border: '0',
        background: 'transparent', color: '#212529', textAlign: 'left', cursor: 'pointer'
      });
      const term = doc.createElement('span');
      term.textContent = item.term;
      Object.assign(term.style, { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
      const criterion = doc.createElement('small');
      criterion.textContent = CRITERION_LABELS[item.criterion] || item.criterion;
      Object.assign(criterion.style, { flex: '0 0 auto', color: '#6c757d', fontSize: '0.72rem' });
      chooseButton.append(term, criterion);
      chooseButton.addEventListener('pointerdown', event => event.preventDefault(), { signal });
      chooseButton.addEventListener('click', () => selectHistoryItem(item), { signal });

      const deleteButton = doc.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'calebe-client-search-history-delete';
      deleteButton.tabIndex = -1;
      deleteButton.setAttribute('aria-label', `Excluir ${item.term} do histórico`);
      deleteButton.textContent = '×';
      Object.assign(deleteButton.style, {
        flex: '0 0 auto', padding: '0.35rem 0.6rem', border: '0', background: 'transparent',
        color: '#6c757d', fontSize: '1.1rem', cursor: 'pointer'
      });
      deleteButton.addEventListener('pointerdown', event => event.preventDefault(), { signal });
      deleteButton.addEventListener('click', event => {
        event.stopPropagation();
        deleteHistoryItem(item.normalized).catch(error => {
          console.error('[Calebe Helper] Falha ao excluir item do histórico:', error);
        });
      }, { signal });
      row.append(chooseButton, deleteButton);
      return row;
    }

    function renderHistory() {
      visibleHistoryItems = getFilteredHistoryItems();
      highlightedHistoryIndex = -1;
      historyDropdown.replaceChildren();
      if (!visibleHistoryItems.length) return closeHistory();

      visibleHistoryItems.forEach((item, index) => {
        historyDropdown.appendChild(createHistoryOption(item, index));
      });
      const clearButton = doc.createElement('button');
      clearButton.type = 'button';
      clearButton.className = 'calebe-client-search-history-clear';
      clearButton.tabIndex = -1;
      clearButton.textContent = clearConfirmationPending ? 'Clique novamente para confirmar' : 'Limpar histórico';
      Object.assign(clearButton.style, {
        width: '100%', padding: '0.4rem 0.65rem', border: '0', borderTop: '1px solid #e9ecef',
        background: '#f8f9fa', color: clearConfirmationPending ? '#b02a37' : '#6c757d',
        textAlign: 'center', fontSize: '0.78rem', cursor: 'pointer'
      });
      clearButton.addEventListener('pointerdown', event => event.preventDefault(), { signal });
      clearButton.addEventListener('click', () => {
        if (!clearConfirmationPending) {
          clearConfirmationPending = true;
          renderHistory();
          return;
        }
        historyItems = [];
        persistHistory().then(closeHistory).catch(error => {
          console.error('[Calebe Helper] Falha ao limpar histórico:', error);
        });
      }, { signal });
      historyDropdown.appendChild(clearButton);
      historyDropdown.hidden = false;
      historyDropdown.style.display = 'flex';
      input.setAttribute('aria-expanded', 'true');
      positionHistoryDropdown();
    }

    function documentSearchTerms(original, digits) {
      const candidates = [String(original || '').trim(), digits];
      if (digits.length === 14) candidates.push(digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5'));
      if (digits.length === 11) candidates.push(digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4'));
      return [...new Set(candidates.filter(Boolean))];
    }

    function classify(term, preferredMethod) {
      const trimmed = String(term || '').trim();
      if (!trimmed) return null;
      const digits = trimmed.replace(/\D/g, '');
      const isDocumentPattern = /^[\d.\-/\s]+$/.test(trimmed);
      if (/^\d+$/.test(trimmed)) {
        if (/^\d{1,4}$/.test(trimmed)) {
          return { criterion: 'codigo', nativeFields: ['ClienteCodigo'], nativeValue: 'ClienteCodigo', term: trimmed, historyTerm: trimmed };
        }
        if (digits.length === 11 || digits.length === 14) {
          return { criterion: 'documento', nativeFields: ['ClienteCGC'], nativeValue: 'ClienteCGC', term: digits, searchTerms: documentSearchTerms(trimmed, digits), historyTerm: trimmed };
        }
        return null;
      }
      if (isDocumentPattern && (digits.length === 11 || digits.length === 14)) {
        return { criterion: 'documento', nativeFields: ['ClienteCGC'], nativeValue: 'ClienteCGC', term: digits, searchTerms: documentSearchTerms(trimmed, digits), historyTerm: trimmed };
      }
      const group = SEARCH_GROUPS[preferredMethod];
      return group ? { ...group, term: trimmed, historyTerm: trimmed } : null;
    }

    function classificationFromHistory(item) {
      if (item.criterion === 'nome') return { ...SEARCH_GROUPS.name, term: item.term, historyTerm: item.term };
      if (item.criterion === 'municipio') return { ...SEARCH_GROUPS.location, term: item.term, historyTerm: item.term };
      if (item.criterion === 'codigo') return { criterion: 'codigo', nativeFields: ['ClienteCodigo'], nativeValue: 'ClienteCodigo', term: item.term, historyTerm: item.term };
      if (item.criterion === 'documento') {
        const digits = item.term.replace(/\D/g, '');
        return { criterion: 'documento', nativeFields: ['ClienteCGC'], nativeValue: 'ClienteCGC', term: digits, searchTerms: documentSearchTerms(item.term, digits), historyTerm: item.term };
      }
      return null;
    }

    function buildUrl(nativeField, term, page = 1) {
      const url = new URL(form.getAttribute('action') || doc.location.href, doc.location.href);
      const params = new URLSearchParams();
      for (const [key, value] of new FormData(form).entries()) {
        if (typeof value === 'string' && key !== 'q') params.append(key, value);
      }
      params.set('campo', nativeField);
      params.set('q', term);
      params.set('p', String(page));
      url.search = params.toString();
      return url;
    }

    async function fetchSearchSource(nativeField, term, page = 1) {
      const response = await fetch(buildUrl(nativeField, term, page), {
        credentials: 'same-origin',
        headers: { Accept: 'text/html' }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      const parsedDocument = new DOMParser().parseFromString(html, 'text/html');
      const rows = [...parsedDocument.querySelectorAll('#tblClientes tbody tr')];
      const resultRows = rows.filter(row => row.querySelectorAll('td').length >= 7);
      const totalText = parsedDocument.getElementById('lblEncontrados')?.textContent || '';
      const totalMatch = totalText.match(/Encontrados\s*:\s*([\d.,]+)/i);
      const total = totalMatch ? (Number(totalMatch[1].replace(/\D/g, '')) || resultRows.length) : resultRows.length;
      const totalPag = Math.max(1, Math.ceil(total / 15));
      return { field: nativeField, term, parsedDocument, rows, total, pagina: page, totalPag };
    }

    // Algumas páginas do SATGO repetem clientes anteriores ao usar p=2, embora
    // o contador informe que ainda existem registros. A pesquisa por parte do
    // código permite recuperar os cadastros omitidos sem inventar resultados.
    async function recoverMissingNameRows(source) {
      if (source.field !== 'ClienteRazaoSocial' || source.total <= 15) {
        return { documents: [source.parsedDocument], pagina: source.pagina };
      }

      const documents = [source.parsedDocument];
      const seen = new Set();
      const remember = parsedDocument => {
        parsedDocument.querySelectorAll('#tblClientes tbody tr').forEach(row => {
          if (row.querySelectorAll('td').length >= 7) {
            const code = row.querySelector('td')?.textContent.match(/^\s*\d+/)?.[0]?.trim();
            if (code) seen.add(code);
          }
        });
      };
      remember(source.parsedDocument);

      for (let page = 2; page <= source.totalPag; page++) {
        const next = await fetchSearchSource(source.field, source.term, page);
        documents.push(next.parsedDocument);
        remember(next.parsedDocument);
      }

      if (seen.size < source.total) {
        const lastCode = Math.max(...[...seen].map(Number).filter(Number.isFinite));
        const startPrefix = Math.floor(lastCode / 10);
        const wanted = normalizeHistoryTerm(source.term);

        // Limita as consultas suplementares; a correspondência é conferida
        // na razão social devolvida pelo próprio servidor antes de exibir.
        for (let prefix = startPrefix; prefix < startPrefix + 30 && seen.size < source.total; prefix++) {
          const candidate = await fetchSearchSource('ClienteCodigo', String(prefix));
          const candidateRows = candidate.parsedDocument.querySelectorAll('#tblClientes tbody tr');
          candidateRows.forEach(row => {
            const cells = row.querySelectorAll('td');
            const code = cells[0]?.textContent.match(/^\s*\d+/)?.[0]?.trim();
            const name = normalizeHistoryTerm(cells[1]?.querySelector('strong')?.textContent);
            if (!code || cells.length < 7 || !name.includes(wanted) || seen.has(code)) {
              row.remove();
            } else {
              seen.add(code);
            }
          });
          if (candidate.parsedDocument.querySelector('#tblClientes tbody tr')) {
            documents.push(candidate.parsedDocument);
          }
        }
      }

      if (seen.size < source.total) {
        console.warn(`[Calebe Helper] SATGO informou ${source.total} clientes, mas entregou ${seen.size} códigos distintos para esta razão social.`);
      }
      return { documents, pagina: source.totalPag };
    }

    function resolveEffectiveNameField(socialResult, fantasyResult) {
      if (socialResult.total > 0) return 'ClienteRazaoSocial';
      if (fantasyResult.total > 0) return 'ClienteNomeFantazia';
      return 'ClienteRazaoSocial';
    }

    function resolveEffectiveField(classification, sourceResults) {
      if (classification.criterion !== 'nome') return classification.nativeFields[0];
      const socialResult = sourceResults.find(result => result.field === 'ClienteRazaoSocial');
      const fantasyResult = sourceResults.find(result => result.field === 'ClienteNomeFantazia');
      return resolveEffectiveNameField(socialResult, fantasyResult);
    }

    function persistVisibleSearch(term, effectiveField) {
      const url = new URL(doc.location.href);
      url.searchParams.set('q', term);
      url.searchParams.set('campo', effectiveField);
      url.searchParams.delete('p');
      url.searchParams.delete('fmt');
      doc.defaultView.history.replaceState(doc.defaultView.history.state, '', url.href);
    }

    async function persistNativeSearchState(effectiveField, term) {
      const response = await fetch(buildUrl(effectiveField, term, 1), {
        credentials: 'same-origin',
        headers: { Accept: 'text/html' },
        signal
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      const parsedDocument = new DOMParser().parseFromString(html, 'text/html');
      return { persisted: true, parsedDocument };
    }

    function syncNativeActiveFilters(sourceDocument) {
      const liveForm = doc.getElementById('formFiltro');
      const sourceForm = sourceDocument?.getElementById('formFiltro');
      if (!liveForm || !sourceForm) return;
      const currentFilters = [...liveForm.querySelectorAll(':scope > .filtros-ativos')];
      const sourceFilters = sourceForm.querySelector(':scope > .filtros-ativos');
      if (!sourceFilters) {
        currentFilters.forEach(filters => filters.remove());
        return;
      }
      const importedFilters = doc.importNode(sourceFilters, true);
      if (currentFilters.length) {
        currentFilters[0].replaceWith(importedFilters);
        currentFilters.slice(1).forEach(filters => filters.remove());
      }
      else liveForm.appendChild(importedFilters);
    }

    function combineRows(parsedDocuments) {
      const rows = [];
      const clientCodes = new Set();
      for (const parsedDocument of parsedDocuments) {
        for (const row of parsedDocument.querySelectorAll('#tblClientes tbody tr')) {
          const cells = row.querySelectorAll('td');
          if (cells.length < 7) continue;
          const clientCode = cells[0].textContent.trim();
          const identity = clientCode || String(row.textContent || '').replace(/\s+/g, ' ').trim();
          if (identity && clientCodes.has(identity)) continue;
          if (identity) clientCodes.add(identity);
          rows.push(doc.importNode(row, true));
        }
      }
      return rows;
    }

    function getCurrentTableWrap() {
      const next = card.nextElementSibling;
      return next?.matches('.table-wrap') && next.querySelector('#tblClientes') ? next : null;
    }

    function removeIncorrectCardTables() {
      card.querySelectorAll('#tblClientes').forEach(table => {
        const parent = table.parentElement;
        table.remove();
        if (parent &&
            parent !== form &&
            !parent.matches('.card-body, .card-footer') &&
            !parent.children.length &&
            !parent.textContent.trim()) {
          parent.remove();
        }
      });
    }

    function createTableWrap(parsedDocuments, rows) {
      const sourceWrap = parsedDocuments
        .map(parsedDocument => parsedDocument.querySelector('.table-wrap'))
        .find(wrap => wrap?.querySelector('#tblClientes tbody'));
      if (!sourceWrap) return null;
      const importedWrap = doc.importNode(sourceWrap, true);
      const tableBody = importedWrap.querySelector('#tblClientes tbody');
      tableBody.replaceChildren(...rows);
      const emptyState = card.nextElementSibling?.matches('.empty-state')
        ? card.nextElementSibling
        : null;
      emptyState?.remove();
      card.insertAdjacentElement('afterend', importedWrap);
      return { tableWrap: importedWrap, tableBody };
    }

    function ensureEmptyState(parsedDocuments) {
      getCurrentTableWrap()?.remove();
      let emptyState = card.nextElementSibling?.matches('.empty-state')
        ? card.nextElementSibling
        : null;
      if (emptyState) return emptyState;
      const sourceState = parsedDocuments
        .map(parsedDocument => parsedDocument.querySelector('.empty-state'))
        .find(Boolean);
      emptyState = sourceState ? doc.importNode(sourceState, true) : doc.createElement('div');
      emptyState.classList.add('empty-state');
      if (!emptyState.textContent.trim()) emptyState.textContent = 'Nenhum cliente encontrado.';
      card.insertAdjacentElement('afterend', emptyState);
      return emptyState;
    }

    function renderResultRows(parsedDocuments, rows) {
      removeIncorrectCardTables();
      if (!rows.length) {
        ensureEmptyState(parsedDocuments);
        return null;
      }
      let tableWrap = getCurrentTableWrap();
      let tableBody = tableWrap?.querySelector('#tblClientes tbody') || null;
      if (!tableBody) {
        const created = createTableWrap(parsedDocuments, rows);
        tableWrap = created?.tableWrap || null;
        tableBody = created?.tableBody || null;
      }
      if (!tableBody) throw new Error('Contêiner nativo da tabela de clientes não encontrado.');
      card.nextElementSibling?.matches('.empty-state') && card.nextElementSibling.remove();
      tableBody.replaceChildren(...rows);
      return tableBody;
    }

    function updateResultCounters(total, shown) {
      const foundLabel = doc.getElementById('lblEncontrados');
      const shownLabel = doc.getElementById('lblApresentados');
      if (foundLabel) foundLabel.textContent = `Encontrados: ${total}`;
      if (shownLabel) shownLabel.textContent = `Apresentados: ${shown}`;
    }

    function getActiveDocuments() {
      return activeSearch.sources.flatMap(source => source.documents);
    }

    function configureLoadMore() {
      const buttonWrap = doc.getElementById('btnMaisWrap');
      const button = buttonWrap?.querySelector('button');
      if (!buttonWrap || !button) return;
      const hasMore = activeSearch.sources.some(source => source.pagina < source.totalPag);
      buttonWrap.style.display = hasMore ? '' : 'none';
      const cleanButton = button.cloneNode(true);
      cleanButton.removeAttribute('onclick');
      button.replaceWith(cleanButton);
      if (hasMore) cleanButton.addEventListener('click', loadMoreResults, { signal });
    }

    async function loadMoreResults() {
      if (!activeSearch || busy) return;
      busy = true;
      try {
        const pendingSources = activeSearch.sources.filter(source => source.pagina < source.totalPag);
        const nextResults = await Promise.all(
          pendingSources.map(source => fetchSearchSource(source.field, source.term || activeSearch.term, source.pagina + 1))
        );
        for (const result of nextResults) {
          const source = activeSearch.sources.find(item => item.field === result.field && item.term === result.term);
          source.pagina = result.pagina;
          source.total = result.total;
          source.totalPag = result.totalPag;
          source.documents.push(result.parsedDocument);
        }
        const rows = combineRows(getActiveDocuments());
        renderResultRows(getActiveDocuments(), rows);
        updateResultCounters(rows.length, rows.length);
        configureLoadMore();
        const persistenceResult = await persistNativeSearchState(
          activeSearch.effectiveField,
          activeSearch.historyTerm
        );
        if (persistenceResult.persisted) syncNativeActiveFilters(persistenceResult.parsedDocument);
      } catch (error) {
        console.error('[Calebe Helper] Falha ao carregar mais clientes:', error);
      } finally {
        busy = false;
      }
    }

    async function recordSuccessfulSearch(classification) {
      const term = String(classification.historyTerm || '').trim();
      const normalized = normalizeHistoryTerm(term);
      if (!normalized || !CRITERION_LABELS[classification.criterion]) return;
      const previous = historyItems.find(item => item.normalized === normalized);
      const updated = {
        term,
        normalized,
        criterion: classification.criterion,
        lastUsedAt: Date.now(),
        useCount: (Number(previous?.useCount) || 0) + 1
      };
      historyItems = [updated, ...historyItems.filter(item => item.normalized !== normalized)]
        .sort((first, second) => second.lastUsedAt - first.lastUsedAt)
        .slice(0, MAX_HISTORY_ITEMS);
      await persistHistory();
    }

    async function runSearch(classification) {
      if (!classification || busy) return false;
      const signature = `${classification.criterion}\n${normalizeHistoryTerm(classification.historyTerm)}`;
      const now = Date.now();
      if (signature === lastSignature && now - lastSearchAt < DEDUPE_INTERVAL_MS) return false;
      lastSignature = signature;
      lastSearchAt = now;
      busy = true;
      closeMethodMenu();
      closeHistory();

      try {
        const searchTerms = classification.searchTerms || [classification.term];
        const sourceResults = await Promise.all(
          classification.nativeFields.flatMap(nativeField =>
            searchTerms.map(term => fetchSearchSource(nativeField, term))
          )
        );
        const recoveredSources = [];
        for (const result of sourceResults) {
          recoveredSources.push(await recoverMissingNameRows(result));
        }
        const parsedDocuments = recoveredSources.flatMap(source => source.documents);
        const rows = combineRows(parsedDocuments);
        const effectiveField = resolveEffectiveField(classification, sourceResults);
        activeSearch = {
          kind: classification.criterion,
          effectiveField,
          term: classification.term,
          historyTerm: classification.historyTerm,
          sources: sourceResults.map((result, index) => ({
            field: result.field,
            term: result.term,
            pagina: recoveredSources[index].pagina,
            total: result.total,
            totalPag: result.totalPag,
            documents: recoveredSources[index].documents
          }))
        };

        renderResultRows(parsedDocuments, rows);
        updateResultCounters(rows.length, rows.length);
        configureLoadMore();

        select.value = effectiveField;
        persistVisibleSearch(classification.historyTerm, effectiveField);
        const persistenceResult = await persistNativeSearchState(
          effectiveField,
          classification.historyTerm
        );
        if (persistenceResult.persisted) syncNativeActiveFilters(persistenceResult.parsedDocument);
        if (rows.length) await recordSuccessfulSearch(classification);
        return true;
      } catch (error) {
        console.error('[Calebe Helper] Falha na pesquisa inteligente de clientes:', error);
        return false;
      } finally {
        busy = false;
      }
    }

    function selectHistoryItem(item) {
      input.value = item.term;
      closeHistory();
      runSearch(classificationFromHistory(item));
    }

    function runCurrentInputSearch(method = 'name') {
      return runSearch(classify(input.value, method));
    }

    chrome.storage.local.get(HISTORY_STORAGE_KEY).then(stored => {
      const state = stored?.[HISTORY_STORAGE_KEY];
      if (state?.version === 1 && Array.isArray(state.items)) {
        historyItems = state.items
          .filter(item => item && CRITERION_LABELS[item.criterion] && item.normalized)
          .sort((first, second) => second.lastUsedAt - first.lastUsedAt)
          .slice(0, MAX_HISTORY_ITEMS);
      }
      if (doc.activeElement === input) renderHistory();
    }).catch(error => {
      console.error('[Calebe Helper] Falha ao carregar histórico de clientes:', error);
    });

    input.addEventListener('focus', renderHistory, { signal });
    input.addEventListener('input', () => {
      renderHistory();
      const value = input.value.trim();
      const isDocument = /^[\d.\-/\s]+$/.test(value) && [11, 14].includes(value.replace(/\D/g, '').length);
      if (!value || /^\d+$/.test(value) || isDocument) closeMethodMenu();
      else openMethodMenu();
    }, { signal });

    input.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' && !historyDropdown.hidden) {
        event.preventDefault();
        setHighlightedHistoryIndex(highlightedHistoryIndex + 1);
      } else if (event.key === 'ArrowUp' && !historyDropdown.hidden) {
        event.preventDefault();
        setHighlightedHistoryIndex(highlightedHistoryIndex < 0 ? visibleHistoryItems.length - 1 : highlightedHistoryIndex - 1);
      } else if (event.key === 'Enter') {
        if (!historyDropdown.hidden && highlightedHistoryIndex >= 0) {
          event.preventDefault();
          suppressNextEnterKeyup = true;
          selectHistoryItem(visibleHistoryItems[highlightedHistoryIndex]);
        }
      } else if (event.key === 'Escape') {
        closeHistory();
        closeMethodMenu();
      } else if (event.key === 'Tab' && !event.shiftKey) {
        event.preventDefault();
        closeHistory();
        openMethodMenu(true);
        methodOptions[0].focus();
      }
    }, { signal });

    input.addEventListener('keyup', event => {
      if (event.key !== 'Enter') return;
      if (suppressNextEnterKeyup) {
        suppressNextEnterKeyup = false;
        return;
      }
      if (highlightedHistoryIndex < 0) runCurrentInputSearch();
    }, { signal });

    form.addEventListener('submit', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (highlightedHistoryIndex < 0) runCurrentInputSearch();
    }, { capture: true, signal });

    methodOptions.forEach((option, index) => {
      option.addEventListener('focus', () => { option.style.background = '#e7f1ff'; }, { signal });
      option.addEventListener('blur', () => { option.style.background = '#fff'; }, { signal });
      option.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          closeMethodMenu();
          input.focus();
        } else if (event.key === 'Tab') {
          event.preventDefault();
          if (event.shiftKey) input.focus();
          else methodOptions[(index + 1) % methodOptions.length].focus();
        } else if (event.key === 'Enter') {
          event.preventDefault();
          runCurrentInputSearch(option.dataset.method);
        }
      }, { signal });
      option.addEventListener('click', () => runCurrentInputSearch(option.dataset.method), { signal });
    });

    doc.addEventListener('pointerdown', event => {
      if (!menu.contains(event.target) && event.target !== input) closeMethodMenu();
      if (!historyDropdown.contains(event.target) && event.target !== input) closeHistory();
    }, { signal });
    doc.defaultView.addEventListener('resize', () => {
      positionMethodMenu();
      positionHistoryDropdown();
    }, { signal });
    doc.defaultView.addEventListener('scroll', () => {
      positionMethodMenu();
      positionHistoryDropdown();
    }, { capture: true, signal });
    signal.addEventListener('abort', () => {
      menu.remove();
      historyDropdown.remove();
    }, { once: true });

    positionHistoryDropdown();
  }

  function tryInitializeClientSearch(doc) {
    const card = findClientSearchCard(doc);
    if (!card) return false;
    if (card.dataset.calebeClientSearchInstalled === '1') return true;
    card.dataset.calebeClientSearchInstalled = '1';
    try {
      initializeClientSearch(doc, card);
      return true;
    } catch (error) {
      delete card.dataset.calebeClientSearchInstalled;
      currentController?.abort();
      currentController = null;
      currentDocument = null;
      console.error('[Calebe Helper] Falha ao inicializar a pesquisa de clientes:', error);
      return false;
    }
  }

  function observeFrameDocument(doc) {
    if (!doc?.documentElement) return;
    if (observedFrameDocument !== doc) {
      frameDocumentObserver?.disconnect();
      currentController?.abort();
      const previousCard = currentDocument ? findClientSearchCard(currentDocument) : null;
      if (previousCard) delete previousCard.dataset.calebeClientSearchInstalled;
      currentController = null;
      currentDocument = null;
      observedFrameDocument = doc;
    }
    if (tryInitializeClientSearch(doc)) {
      frameDocumentObserver?.disconnect();
      frameDocumentObserver = null;
      return;
    }
    if (frameDocumentObserver) return;
    frameDocumentObserver = new MutationObserver(() => {
      if (!tryInitializeClientSearch(doc)) return;
      frameDocumentObserver?.disconnect();
      frameDocumentObserver = null;
    });
    frameDocumentObserver.observe(doc.documentElement, { childList: true, subtree: true });
  }

  function processFrame() {
    // A tela de clientes pode estar em um iframe de aba, não no #mainIframe original.
    const frame = document.querySelector('iframe.aba-frame.ativa') ||
      document.getElementById('mainIframe');
    if (!frame) return;
    if (!wiredFrames.has(frame)) {
      wiredFrames.add(frame);
      frame.addEventListener('load', processFrame);
    }
    try {
      const doc = frame.contentDocument;
      observeFrameDocument(doc);
    } catch (error) {
      console.error('[Calebe Helper] Falha ao acessar a pesquisa de clientes:', error);
    }
  }

  processFrame();
  const frameObserver = new MutationObserver(processFrame);
  // A troca de aba é sinalizada pela classe ativa do iframe.
  frameObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class']
  });
})();

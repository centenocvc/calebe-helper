(() => {
  'use strict';
  if (window.top !== window.self) return;
  if (document.getElementById('calebe-helper-root')) return;

  const STORAGE_KEY = 'calebeHelperStateV3';
  const DEFAULTS = {
    cpf: false,
    cnpj: false,
    multi: false,
    coefficient21: 2000,
    coefficient22: 2000,
    layout: 'test-one',
    theme: 'bootstrap',
    geometry: { left: null, top: 16, width: 760, height: null }
  };

  const state = {
    rows: [],
    settings: structuredClone(DEFAULTS),
    selectedIndex: null,
    visible: false,
    busy: false,
    clientDetails: new Map(),
    multiSession: null
  };
  let lastPanelPointerAt = 0;
  let autoMinimizedPanel = false;

  function extensionContextValid() {
    try {
      return Boolean(globalThis.chrome?.runtime?.id);
    } catch (_) {
      return false;
    }
  }

  function isExtensionContextInvalidatedError(error) {
    return /Extension context invalidated/i.test(String(error?.message || error || ''));
  }

  function safeRuntimeGetURL(path) {
    if (!extensionContextValid()) return '';
    try {
      return chrome.runtime.getURL(path);
    } catch (error) {
      if (isExtensionContextInvalidatedError(error)) return '';
      throw error;
    }
  }

  function safeRuntimeGetManifest() {
    if (!extensionContextValid()) return null;
    try {
      return chrome.runtime.getManifest();
    } catch (error) {
      if (isExtensionContextInvalidatedError(error)) return null;
      throw error;
    }
  }

  const ICON_URL = safeRuntimeGetURL('icons/calweb-helper-32.png');
  const manifest = safeRuntimeGetManifest();
  const APP_VERSION = manifest?.version_name || manifest?.version || 'desconhecida';

  const root = document.createElement('div');
  root.id = 'calebe-helper-root';
  root.innerHTML = `
    <div class="ch-header" id="ch-drag-handle">
      <strong class="ch-brand"><img src="${ICON_URL}" alt=""> Calebe Helper <small>v${APP_VERSION}</small></strong>
      <div class="ch-header-actions">
        <button type="button" id="ch-minimize" title="Minimizar">—</button>
        <button type="button" id="ch-close" title="Ocultar (F2)">×</button>
      </div>
    </div>
    <div class="ch-body">
      <div class="ch-toolbar">
        <div class="ch-toolbar-group ch-document-group">
          <span id="ch-count" class="ch-count-label">0 Linhas</span>
          <span class="ch-document-separator" aria-hidden="true">|</span>
          <label class="ch-check"><input id="ch-cpf" type="checkbox"> CPF</label>
          <label class="ch-check"><input id="ch-cnpj" type="checkbox"> CNPJ</label>
        </div>
        <div class="ch-toolbar-group ch-theme">
          <label><input name="ch-theme" type="radio" value="bootstrap"> Bootstrap</label>
          <label><input name="ch-theme" type="radio" value="glass"> Glass</label>
          <label><input name="ch-theme" type="radio" value="neutral"> Neutro</label>
        </div>
        <div class="ch-toolbar-group ch-products-group">
          <label class="ch-inline">Prod. 21 <input id="ch-coef-21" type="number" step="0.01" min="0" value="2000"></label>
          <label class="ch-inline ch-inline-secondary">Prod. 22 <input id="ch-coef-22" type="number" step="0.01" min="0" value="2000"></label>
        </div>
        <div class="ch-clean-actions">
          <button type="button" class="ch-clear-done" title="Remover linhas concluídas"><i class="bi bi-broom"></i> Limpar concluídos</button>
          <button type="button" class="ch-clear-all" title="Remover todas as linhas"><i class="bi bi-trash3"></i> Limpar todos</button>
        </div>
      </div>

      <div class="ch-section ch-table-section">
        <div class="ch-table-wrap">
          <table>
            <thead><tr><th>21</th><th>22</th><th class="ch-product-other">Outros</th><th class="ch-code-column">Cód.</th><th class="ch-oc-column">OC</th><th>Cliente</th><th>Endereço</th><th class="ch-money">Total</th><th class="ch-action-column"></th></tr></thead>
            <tbody id="ch-tbody"></tbody>
          </table>
        </div>
      </div>
      <div class="ch-section ch-footer-section">
        <div class="ch-footer-clean-actions">
          <button type="button" class="ch-clear-done" title="Remover linhas concluídas"><i class="bi bi-broom"></i> Limpar concluídos</button>
          <button type="button" class="ch-clear-all" title="Remover todas as linhas"><i class="bi bi-trash3"></i> Limpar todos</button>
        </div>
        <div id="ch-status">
          <span id="ch-status-text">Pronto. F2 mostra/oculta o painel.</span>
          <span class="ch-layout-options">
            <label><input name="ch-layout" type="radio" value="test-one"> Teste 1</label>
            <label><input name="ch-layout" type="radio" value="test-two"> Teste 2</label>
          </span>
        </div>
      </div>
    </div>
  `;
  root.tabIndex = 0;
  root.style.display = 'none';
  root.classList.add('ch-hidden');
  document.documentElement.appendChild(root);

  const $ = sel => root.querySelector(sel);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const status = (msg, kind = '') => {
    $('#ch-status-text').textContent = msg;
    $('#ch-status').dataset.kind = kind;
  };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function getFrame() { return document.getElementById('mainIframe'); }
  function getCalebeDoc() {
    const f = getFrame();
    try { return f?.contentDocument || document; } catch (_) { return document; }
  }
  function getCalebeWin() {
    const f = getFrame();
    try { return f?.contentWindow || window; } catch (_) { return window; }
  }

  function injectBridge() {
    const doc = getCalebeDoc();
    if (!doc || doc === document) return false;
    if (doc.getElementById('calebe-helper-page-bridge')) return true;

    const bridgeUrl = safeRuntimeGetURL('page-bridge.js');
    if (!bridgeUrl) return false;
    const root = doc.head || doc.documentElement;
    if (!root) return false;

    try {
      const s = doc.createElement('script');
      s.id = 'calebe-helper-page-bridge';
      s.src = bridgeUrl;
      root.appendChild(s);
      return true;
    } catch (error) {
      if (isExtensionContextInvalidatedError(error)) return false;
      throw error;
    }
  }

  async function ensureBridgeReady() {
    injectBridge();
    const doc = getCalebeDoc();
    await waitFor(() => doc.documentElement?.dataset?.calebeHelperBridgeReady === '1', {
      timeout: 4000, interval: 50, message: 'Ponte do Calebe não ficou pronta.'
    });
    wireBridgeEvents();
  }

  function wireFrame() {
    const frame = getFrame();
    if (!frame || frame.dataset.calebeHelperWired) return;
    frame.dataset.calebeHelperWired = '1';
    frame.addEventListener('load', () => {
      setTimeout(() => { injectBridge(); wireBridgeEvents(); installClientOverlay(); wireCalebePageCollapse(); }, 50);
    });
    injectBridge(); wireBridgeEvents(); installClientOverlay(); wireCalebePageCollapse();
  }

  function collapsePanelPreview() {
    if (Date.now() - lastPanelPointerAt < 250) return;
    if (!state.visible || state.busy) return;
    root.classList.add('ch-unfocused');
  }

  function wireCalebePageCollapse() {
    const doc = getCalebeDoc();
    if (!doc || doc === document || doc.__calebeHelperCollapseWired) return;
    doc.__calebeHelperCollapseWired = true;
    doc.addEventListener('pointerdown', collapsePanelPreview, true);
  }

  function wireBridgeEvents() {
    const doc = getCalebeDoc();
    if (!doc || doc.__calebeHelperEventsWired) return;
    doc.__calebeHelperEventsWired = true;
    doc.addEventListener('calebe-helper:cliente-detalhes', e => {
      let row = e.detail || {};
      try {
        const raw = doc.documentElement?.dataset?.calebeHelperClientDetails;
        if (raw) row = JSON.parse(raw);
      } catch (_) {}
      if (row.ClienteCodigo) state.clientDetails.set(String(row.ClienteCodigo), row);
      renderClientOverlay(row);
    });
  }

  function command(action, payload = {}, timeout = 3000) {
    injectBridge();
    const doc = getCalebeDoc();
    return new Promise((resolve, reject) => {
      const id = `ch-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      let timer;
      const handler = e => {
        if (e.detail?.id !== id) return;
        clearTimeout(timer); doc.removeEventListener('calebe-helper:command-result', handler);
        e.detail.ok ? resolve(e.detail) : reject(new Error(e.detail.error || 'Falha no comando.'));
      };
      doc.addEventListener('calebe-helper:command-result', handler);
      doc.dispatchEvent(new CustomEvent('calebe-helper:command', { detail: { id, action, ...payload } }));
      timer = setTimeout(() => { doc.removeEventListener('calebe-helper:command-result', handler); reject(new Error(`Timeout: ${action}`)); }, timeout);
    });
  }

  function readClientDetailsFromBridge(expectedCode = '') {
    try {
      const doc = getCalebeDoc();
      const raw = doc.documentElement?.dataset?.calebeHelperClientDetails;
      if (!raw) return null;
      const row = JSON.parse(raw);
      if (!row?.ClienteCodigo) return null;
      if (expectedCode && String(row.ClienteCodigo) !== String(expectedCode)) return null;
      state.clientDetails.set(String(row.ClienteCodigo), row);
      return row;
    } catch (_) { return null; }
  }

  function docType(documento) {
    const n = String(documento || '').replace(/\D/g, '');
    return n.length === 11 ? 'CPF' : n.length === 14 ? 'CNPJ' : '';
  }

  function parseMoney(value) {
    let s = String(value ?? '').replace(/\u00a0/g, ' ').trim();
    if (!s) return NaN;
    s = s.replace(/R\$/gi, '').replace(/\s+/g, '');
    if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
    else if (s.includes(',')) s = s.replace(',', '.');
    s = s.replace(/[^0-9.-]/g, '');
    return Number(s);
  }
  const money = n => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  function normalizeOc(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    return /^OC\b/i.test(raw) ? raw.replace(/^oc\b/i, 'OC') : `OC ${raw}`;
  }

  function parseClipboard(text) {
    const lines = String(text || '').replace(/\r/g, '').split('\n').filter(line => line.trim() !== '');
    const out = [];
    for (const line of lines) {
      const cols = line.split('\t');
      if (cols.length < 6) continue;
      const total = parseMoney(cols[5]);
      if (!Number.isFinite(total)) continue;
      const codigo = String(cols[0] ?? '').trim();
      const documento = String(cols[3] ?? '').trim();
      const tipo = docType(documento);
      out.push({
        clientCode: codigo,
        oc: normalizeOc(cols[1]),
        name: String(cols[2] ?? '').trim().replace(/\s{2,}/g, ' '),
        document: documento,
        type: tipo,
        address: String(cols[4] ?? '').trim().replace(/\s{2,}/g, ' '),
        total,
        product21: false,
        product22: false,
        productOther: false,
        multi: false,
        status: ''
      });
    }
    return out;
  }

  function isNewEnabled(row) {
    if (row.clientCode) return false;
    return (row.type === 'CPF' && state.settings.cpf) || (row.type === 'CNPJ' && state.settings.cnpj);
  }

  function rowVisible(row) {
    if (row.clientCode) return true;
    if (row.type === 'CPF') return !!state.settings.cpf;
    if (row.type === 'CNPJ') return !!state.settings.cnpj;
    return true;
  }

  function renderRows() {
    const tbody = $('#ch-tbody');
    tbody.innerHTML = '';
    state.rows.forEach((row, i) => {
      if (!rowVisible(row)) return;
      const tr = document.createElement('tr');
      if (i === state.selectedIndex) tr.classList.add('ch-selected');
      if (isNewEnabled(row)) tr.classList.add('ch-new-client');
      if (row.status === 'done') tr.classList.add('ch-done');
      tr.innerHTML = `
        <td><input class="ch-line-product" data-product="21" data-index="${i}" type="checkbox" ${row.product21 ? 'checked' : ''} title="Preencher com o produto 21"></td>
        <td><input class="ch-line-product" data-product="22" data-index="${i}" type="checkbox" ${row.product22 ? 'checked' : ''} title="Preencher com o produto 22"></td>
        <td class="ch-product-other"><input class="ch-line-product" data-product="other" data-index="${i}" type="checkbox" ${row.productOther ? 'checked' : ''} title="Escolher outro produto manualmente"></td>
        <td class="ch-code-column">${esc(row.clientCode || '—')}</td>
        <td class="ch-oc-column">${esc(row.oc)}</td>
        <td class="ch-client" title="${esc(row.name)}">${esc(row.name)}</td>
        <td class="ch-address" title="${esc(row.address)}">${esc(row.address)}</td>
        <td class="ch-money">${esc(money(row.total))}</td>
        <td class="ch-action-column"><button type="button" class="ch-fill" data-index="${i}" ${!state.busy ? '' : 'disabled'}>${row.status === 'done' ? '✓ Concluído' : 'Preencher'}</button></td>`;
      tbody.appendChild(tr);
    });
    const visibleCount = state.rows.filter(rowVisible).length;
    $('#ch-count').textContent = `${visibleCount} ${visibleCount === 1 ? 'Linha' : 'Linhas'}`;
    adjustSingleItemHeight(visibleCount);
    requestAnimationFrame(refreshResizeMinimums);
  }

  function adjustSingleItemHeight(visibleCount) {
    const isSingle = visibleCount === 1;
    if (isSingle) {
      if (root.dataset.singleItemHeight !== '1') {
        root.dataset.singleItemHeight = '1';
        root.style.height = 'auto';
      }
      requestAnimationFrame(() => {
        if (root.dataset.singleItemHeight !== '1') return;
        root.style.height = `${root.scrollHeight}px`;
      });
      return;
    }
    if (root.dataset.singleItemHeight === '1') {
      delete root.dataset.singleItemHeight;
      applyGeometry();
    }
  }

  function applyTheme() {
    const theme = ['bootstrap', 'glass', 'neutral'].includes(state.settings.theme) ? state.settings.theme : 'bootstrap';
    root.dataset.theme = theme;
    root.dataset.layout = state.settings.layout === 'test-two' ? 'test-two' : 'test-one';
    requestAnimationFrame(refreshResizeMinimums);
  }

  function setNativeValue(el, value) {
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    const win = el.ownerDocument.defaultView;
    if (tag === 'input' || tag === 'textarea') {
      const proto = tag === 'input' ? win.HTMLInputElement.prototype : win.HTMLTextAreaElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      setter ? setter.call(el, String(value)) : (el.value = String(value));
    } else if (tag === 'select') el.value = String(value);
    else return false;
    el.dispatchEvent(new win.Event('input', { bubbles: true }));
    el.dispatchEvent(new win.Event('change', { bubbles: true }));
    return true;
  }

  async function waitFor(fn, { timeout = 8000, interval = 100, message = 'Tempo esgotado.' } = {}) {
    const start = Date.now();
    let lastErr;
    while (Date.now() - start < timeout) {
      try { const v = fn(); if (v) return v; } catch (e) { lastErr = e; }
      await sleep(interval);
    }
    throw lastErr || new Error(message);
  }

  function visible(el) {
    if (!el) return false;
    const w = el.ownerDocument.defaultView;
    const cs = w.getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && el.getClientRects().length > 0;
  }

  function click(el) {
    if (!el) throw new Error('Elemento para clique nao encontrado.');
    el.scrollIntoView({ block: 'center' });
    const win = el.ownerDocument.defaultView;
    el.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true, cancelable: true, view: win }));
    el.dispatchEvent(new win.MouseEvent('mouseup', { bubbles: true, cancelable: true, view: win }));
    el.click();
  }

  function clickNeutralArea(doc) {
    const area = doc.createElement('span');
    area.setAttribute('aria-hidden', 'true');
    Object.assign(area.style, {
      position: 'fixed', left: '2px', bottom: '2px', width: '1px', height: '1px',
      opacity: '0', pointerEvents: 'auto', zIndex: '2147483647'
    });
    doc.body.appendChild(area);
    const win = doc.defaultView;
    area.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true, cancelable: true, view: win }));
    area.dispatchEvent(new win.MouseEvent('mouseup', { bubbles: true, cancelable: true, view: win }));
    area.click();
    area.remove();
  }

  async function dismissNoClientMessage() {
    const doc = getCalebeDoc();
    try {
      const message = await waitFor(() => {
        const list = doc.getElementById('cli_ac');
        return list && visible(list) && /Nenhum cliente encontrado/i.test(list.textContent || '') ? list : null;
      }, { timeout: 1500, interval: 25, message: 'Mensagem de cliente inexistente não apareceu.' });
      await sleep(120);
      clickNeutralArea(doc);
      return message;
    } catch (_) {
      return null;
    }
  }

  async function waitForObsButtonReady() {
    for (;;) {
      const btn = findReadyButton('btnObs');
      if (btn) {
        await sleep(500);
        return btn;
      }
      await sleep(120);
    }
  }

  function findReadyButton(id) {
    return [...getCalebeDoc().querySelectorAll(`#${id}`)].find(el => !el.disabled) || null;
  }

  async function waitForReadyButton(id, message) {
    return waitFor(() => findReadyButton(id), { timeout: 12000, interval: 100, message });
  }
  async function startNewDav() {
    const existingDav = () => {
      const d = getCalebeDoc();
      const novo = d.getElementById('btnNovoDav');
      return d.getElementById('cliNome') && d.getElementById('cliId') && (!novo || !visible(novo));
    };

    if (existingDav()) {
      await ensureBridgeReady();
      installClientOverlay();
      await waitForObsButtonReady();
      return { resumed: true };
    }

    const btn = await waitFor(() => {
      const d = getCalebeDoc();
      return d.getElementById('btnNovoDav') || existingDav();
    }, { message: '#btnNovoDav nao apareceu e a tela atual nao parece uma DAV em andamento.' });

    if (btn && btn.nodeType === 1) {
      click(btn);
      await sleep(500);
    }
    else {
      await ensureBridgeReady();
      installClientOverlay();
      await waitForObsButtonReady();
      return { resumed: true };
    }

    await waitFor(existingDav, { timeout: 10000, message: 'A nova DAV nao ficou pronta apos btnNovoDav.' });

    // A tela da nova DAV pode recriar parte do DOM. Reinstala ponte + captura + overlay
    // antes de pesquisar o cliente, para que os dados completos do endpoint ja sejam observados.
    await ensureBridgeReady();
    installClientOverlay();
    await waitFor(() => getCalebeDoc().getElementById('cliNome'), { timeout: 3000, message: '#cliNome nao apareceu na nova DAV.' });
    await waitForObsButtonReady();
    return { resumed: false };
  }

  async function openBlankDavThroughClientDav() {
    const api = await waitFor(() => window.calebeHelperClientDav, {
      timeout: 3000,
      message: 'Integração clientedav.js não ficou disponível.'
    });
    if (typeof api.openBlankDav !== 'function') throw new Error('clientedav.js não expôs openBlankDav().');
    return api.openBlankDav();
  }

  async function selectClientByCode(code, { clearFirst = false } = {}) {
    const expected = String(code).trim();
    const doc = getCalebeDoc();
    const input = await waitFor(() => doc.getElementById('cliNome'), { timeout: 4000, message: '#cliNome não encontrado.' });

    await ensureBridgeReady();
    const overlay = installClientOverlay();

    if (clearFirst) {
      const cliId = getCalebeDoc().getElementById('cliId');
      if (overlay) {
        overlay.dataset.temCliente = '0';
        overlay.style.display = 'none';
        overlay.innerHTML = '';
      }
      setNativeValue(input, '');
      if (cliId) setNativeValue(cliId, '');
      await sleep(80);
    }

    // Caminho principal: reproduz exatamente o uso nativo do Calebe. O campo recebe
    // o código e Enter aciona acNavCliente(), que chama acBuscarClientePorCodigo().
    input.focus();
    setNativeValue(input, expected);
    input.dispatchEvent(new input.ownerDocument.defaultView.Event('input', { bubbles: true }));
    await sleep(60);
    input.dispatchEvent(new input.ownerDocument.defaultView.KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
    }));

    // Se o handler inline não tiver sido executado por alguma particularidade do WebView,
    // usa a ponte MAIN-world como segunda rota, sem depender dela para o primeiro disparo.
    try {
      await waitFor(() => String(getCalebeDoc().getElementById('cliId')?.value || '') === expected, {
        timeout: 7000, message: 'fallback'
      });
    } catch (_) {
      await command('lookup-client', { code: expected }, 4000);
    }

    await waitFor(() => String(getCalebeDoc().getElementById('cliId')?.value || '') === expected, {
      timeout: 7000, message: `Cliente ${expected} não foi confirmado em #cliId.`
    });

    // Aguarda brevemente o fetch capturado para que o endereço apareça antes de seguir.
    try {
      let details = await waitFor(() => state.clientDetails.get(expected) || readClientDetailsFromBridge(expected), { timeout: 1800, message: 'detalhes' });
      renderClientOverlay(details);
    } catch (_) {
      console.warn('[Calebe Helper] Cliente confirmado, mas detalhes/endereço não foram capturados:', _);
    }
    await dismissNoClientMessage();
  }

  function findProductInput() {
    return getCalebeDoc().getElementById('inlinePrdCodigo');
  }

  function coefficientForProduct(code) {
    if (String(code) === '21') return Number(state.settings.coefficient21);
    if (String(code) === '22') return Number(state.settings.coefficient22);
    return NaN;
  }

  function selectedProductCodes(row) {
    return [row.product21 && '21', row.product22 && '22'].filter(Boolean);
  }

  async function enterProductCode(code) {
    const input = await waitFor(findProductInput, { timeout: 5000, message: '#inlinePrdCodigo não encontrado.' });
    const win = input.ownerDocument.defaultView;
    input.focus();
    setNativeValue(input, code);
    await sleep(80);
    input.dispatchEvent(new win.KeyboardEvent('keydown', {
      key: 'Tab', code: 'Tab', keyCode: 9, which: 9, bubbles: true, cancelable: true
    }));
    input.dispatchEvent(new win.KeyboardEvent('keyup', {
      key: 'Tab', code: 'Tab', keyCode: 9, which: 9, bubbles: true, cancelable: true
    }));
    input.blur();
  }

  async function fillSelectedProduct(row) {
    if (row.productOther) return false;
    const selectedProducts = selectedProductCodes(row);
    if (!selectedProducts.length) return false;
    await enterProductCode(selectedProducts[0]);
    row.multi = selectedProducts.length > 1;
    return true;
  }

  async function applyCoefficientWhileWaitingForProduct() {
    // Não há timeout nesta etapa. A DAV pode ficar aguardando o usuário pelo tempo necessário.
    for (;;) {
      const d = getCalebeDoc();
      const productCode = String(d.getElementById('inlinePrdCodigo')?.value || '').trim();
      const coef = coefficientForProduct(productCode);
      const unit = d.getElementById('inlinePrdVlUnit');
      if (unit && coef > 0 && String(unit.value || '') !== String(coef)) setNativeValue(unit, coef);
      const desc = d.getElementById('inlinePrdDesc');
      const loaded = desc && String(('value' in desc ? desc.value : desc.textContent) || '').trim();
      if (loaded) {
        // Reaplica uma última vez após o Calebe preencher a descrição, caso o carregamento do produto tenha zerado o valor unitário.
        const unitAfter = d.getElementById('inlinePrdVlUnit');
        if (unitAfter && coef > 0) setNativeValue(unitAfter, coef);
        return desc;
      }
      await sleep(100);
    }
  }

  async function applyExactItemTotal(target, unit, qty, liquid, unitValue) {
    if (!(target > 0) || !(unitValue > 0)) throw new Error('Total ou valor unitário inválido para ajustar a quantidade.');
    const rawQty = target / unitValue;
    const finalQty = Math.ceil((rawQty - 1e-10) * 1000) / 1000;
    const gross = Math.round(finalQty * unitValue * 100) / 100;
    const discount = Math.max(0, Math.round((gross - target) * 100) / 100);

    setNativeValue(unit, unitValue);
    await sleep(100);
    setNativeValue(qty, finalQty);
    await sleep(120);

    if (discount > 0.001) {
      const tipoDesconto = await waitFor(() => getCalebeDoc().getElementById('tipoDesconto'), { message: '#tipoDesconto não encontrado para corrigir o arredondamento.' });
      const desc = await waitFor(() => getCalebeDoc().getElementById('inlinePrdVlDesc'), { message: '#inlinePrdVlDesc não encontrado para corrigir o arredondamento.' });
      if (tipoDesconto.disabled || desc.disabled) throw new Error('Os campos de desconto estão bloqueados; não foi possível acertar o valor exato.');
      if (String(tipoDesconto.value) !== '1') setNativeValue(tipoDesconto, '1');
      await sleep(100);
      setNativeValue(desc, discount.toFixed(2).replace('.', ','));
    }

    await waitFor(() => {
      const currentLiquid = getCalebeDoc().getElementById('inlinePrdVlLiq') || liquid;
      const value = parseMoney(currentLiquid.value);
      return Number.isFinite(value) && Math.abs(value - target) <= 0.01;
    }, { timeout: 5000, message: `O valor líquido não atingiu ${money(target)} após ajustar a quantidade.` });
    return { quantity: finalQty, discount };
  }

  async function fillSingleItem(total) {
    await applyCoefficientWhileWaitingForProduct();
    const unit = await waitFor(() => getCalebeDoc().getElementById('inlinePrdVlUnit'), { message: '#inlinePrdVlUnit nao encontrado.' });
    const qty = await waitFor(() => getCalebeDoc().getElementById('inlinePrdQtd'), { message: '#inlinePrdQtd nao encontrado.' });
    const liquid = await waitFor(() => getCalebeDoc().getElementById('inlinePrdVlLiq'), { message: '#inlinePrdVlLiq nao encontrado.' });
    const productCode = String(findProductInput()?.value || '').trim();
    const configuredCoefficient = coefficientForProduct(productCode);
    const unitValue = configuredCoefficient > 0 ? configuredCoefficient : parseMoney(unit.value);
    if (!(unitValue > 0)) throw new Error('Valor unitário do produto inválido.');

    try {
      await applyExactItemTotal(total, unit, qty, liquid, unitValue);
    } catch (firstError) {
      // Fallback: reaplica quantidade e desconto uma única vez caso o Calebe não recalcule na primeira tentativa.
      status(`O valor do item não fechou; tentando corrigir a quantidade para ${money(total)}...`, 'warn');
      await sleep(350);
      try {
        await applyExactItemTotal(total, unit, qty, liquid, unitValue);
      } catch (retryError) {
        throw new Error(`Falha no acerto automático do item. Primeira tentativa: ${firstError.message} Segunda tentativa: ${retryError.message}`);
      }
    }
    await sleep(500);
  }
  async function ensureCurrentDavTotalMatches(total) {
    const readTotNf = () => {
      const totalEl = getCalebeDoc().getElementById('totNF');
      if (!totalEl) return NaN;
      const raw = 'value' in totalEl ? totalEl.value : totalEl.textContent;
      return parseMoney(raw);
    };

    // ⬛ Bloco: pausa a conferência enquanto a janela/aba do Calebe não está em foco.
    // O tempo fora de foco não conta como tempo de espera; ao voltar, a busca é retomada.
    const pageHasFocus = () => {
      try {
        return document.visibilityState !== 'hidden' && document.hasFocus();
      } catch (_) {
        return false;
      }
    };

    while (!pageHasFocus()) {
      await sleep(250);
    }

    let stableMatches = 0;
    while (true) {
      // Se o usuário mudar para outra janela/aba, suspende a leitura do total.
      if (!pageHasFocus()) {
        stableMatches = 0;
        await sleep(250);
        continue;
      }

      const current = readTotNf();
      if (Number.isFinite(current) && Math.abs(current - total) <= 0.01) {
        stableMatches++;
        // Exige duas leituras iguais separadas por 250 ms para evitar avançar
        // com um valor transitório durante a atualização do Calebe.
        if (stableMatches >= 2) return;
      } else {
        stableMatches = 0;
      }

      await sleep(250);
    }
  }
  function armMultiItem(row) {
    const doc = getCalebeDoc();
    const productInput = findProductInput();
    const liquid = doc.getElementById('inlinePrdVlLiq');
    if (!productInput || !liquid) throw new Error('Para Vários itens, configure o seletor do produto e confirme #inlinePrdVlLiq.');

    const initialProduct = String(productInput.value || '').trim();
    const automaticProducts = selectedProductCodes(row);
    const pendingProducts = automaticProducts.filter(code => code !== initialProduct);
    const session = state.multiSession = {
      rowIndex: state.selectedIndex,
      target: row.total,
      accumulated: 0,
      lastProduct: initialProduct,
      lastLiquid: 0,
      lastQuantity: 0,
      quantityBlankSince: 0,
      pendingProducts,
      switching: false,
      timer: null
    };

    session.timer = setInterval(async () => {
      if (state.multiSession !== session) return clearInterval(session.timer);
      if (session.adjusting) return;
      try {
        const d = getCalebeDoc();
        const p = findProductInput();
        const liq = d.getElementById('inlinePrdVlLiq');
        const unit = d.getElementById('inlinePrdVlUnit');
        const qty = d.getElementById('inlinePrdQtd');
        if (!p || !liq || !unit || !qty) return;
        const curProduct = String(p.value || '').trim();
        const curLiquid = parseMoney(liq.value);
        const curQuantity = parseMoney(qty.value);
        const configuredUnit = coefficientForProduct(curProduct);
        if (configuredUnit > 0 && String(unit.value || '') !== String(configuredUnit)) setNativeValue(unit, configuredUnit);
        const remainingBeforeCurrent = Math.max(0, session.target - session.accumulated);
        if (Number.isFinite(curLiquid) && curLiquid > remainingBeforeCurrent + 0.01) {
          const unitValue = coefficientForProduct(curProduct) || parseMoney(unit.value);
          if (unitValue > 0) {
            setNativeValue(qty, remainingBeforeCurrent / unitValue);
            status(`Quantidade limitada ao saldo disponível de ${money(remainingBeforeCurrent)}.`, 'warn');
          }
          return;
        }
        if (Number.isFinite(curLiquid) && curLiquid > 0) session.lastLiquid = curLiquid;
        if (Number.isFinite(curQuantity) && curQuantity > 0) {
          session.lastQuantity = curQuantity;
          session.quantityBlankSince = 0;
        }

        // ⬛ Bloco: evita interpretar um campo de quantidade temporariamente vazio como confirmação do item.
        // Enquanto o usuário edita/confirma a quantidade, a automação aguarda sem limite de tempo.
        const quantityIsBeingEdited = d.activeElement === qty;
        if (!(curQuantity > 0) && quantityIsBeingEdited) {
          session.quantityBlankSince = 0;
        } else if (!(curQuantity > 0) && session.lastQuantity > 0) {
          if (!session.quantityBlankSince) session.quantityBlankSince = Date.now();
        } else {
          session.quantityBlankSince = 0;
        }

        const quantityWasClearedAfterConfirmation =
          session.lastLiquid > 0 &&
          session.lastQuantity > 0 &&
          session.quantityBlankSince > 0 &&
          Date.now() - session.quantityBlankSince >= 2500;

        const itemAdvanced = session.lastProduct && (
          (curProduct && curProduct !== session.lastProduct) ||
          quantityWasClearedAfterConfirmation
        );
        if (itemAdvanced) {
          if (session.lastLiquid > 0) session.accumulated = Math.min(session.target, session.accumulated + session.lastLiquid);
          session.lastLiquid = 0;
          session.lastQuantity = 0;
          session.quantityBlankSince = 0;
          session.lastProduct = curProduct;
          delete qty.dataset.chRemainderFilled;

          if (session.pendingProducts.length && !session.switching && session.accumulated < session.target - 0.01) {
            const nextProduct = session.pendingProducts.shift();
            session.switching = true;
            await enterProductCode(nextProduct);
            session.lastProduct = nextProduct;
            session.switching = false;
            return;
          }
        }
        if (!session.lastProduct && curProduct) session.lastProduct = curProduct;

        const isFinalAutomaticProduct = curProduct && !session.pendingProducts.length && automaticProducts.includes(curProduct);
        if (session.accumulated > 0 && isFinalAutomaticProduct) {
          const remaining = Math.round((session.target - session.accumulated) * 100) / 100;
          const unitN = coefficientForProduct(curProduct) || parseMoney(unit.value);
          if (remaining > 0.009 && unitN > 0 && !qty.dataset.chRemainderFilled) {
            qty.dataset.chRemainderFilled = '1';
            session.adjusting = true;
            try {
              const result = await applyExactItemTotal(remaining, unit, qty, liq, unitN);
              status(`Produto ${curProduct}: quantidade ${result.quantity.toFixed(3)} ajustada para completar o saldo de ${money(remaining)}${result.discount > 0 ? ` com desconto de ${money(result.discount)}` : ''}.`, 'ok');
            } catch (error) {
              delete qty.dataset.chRemainderFilled;
              status(`Não foi possível completar o saldo de ${money(remaining)} pela quantidade: ${error.message}`, 'warn');
              return;
            } finally {
              session.adjusting = false;
            }
          }
          const current = parseMoney(liq.value);
          if (Number.isFinite(current) && Math.abs(session.accumulated + current - session.target) <= 0.01) {
            clearInterval(session.timer);
            state.multiSession = null;
            restorePanelAfterFill();
            status(`Total dos itens conferido: ${money(session.target)}. Continue o fechamento da DAV.`, 'ok');
          }
        }
      } catch (error) {
        console.warn('[Calebe Helper] Acompanhamento dos itens aguardando a confirmação do lançamento:', error);
      }
    }, 250);
  }

  function findObsButton() {
    return findReadyButton('btnObs') || getCalebeDoc().getElementById('btnObs');
  }
  async function fillObservation(oc) {
    for (;;) {
      let obs = getCalebeDoc().getElementById('obsNota');
      if (obs && visible(obs)) {
        setNativeValue(obs, oc);
        const btnBack = await waitForObsButtonReady();
        click(btnBack);
        await sleep(200);
        return;
      }

      const btn = await waitForObsButtonReady();
      click(btn);
      try {
        obs = await waitFor(() => {
          const x = getCalebeDoc().getElementById('obsNota');
          return x && visible(x) ? x : null;
        }, { timeout: 1800, interval: 100, message: '#obsNota nao ficou visivel.' });
        setNativeValue(obs, oc);
        const btnBack = await waitForObsButtonReady();
        click(btnBack);
        await sleep(200);
        return;
      } catch (_) {
        await sleep(250);
      }
    }
  }
  async function closeDavSequence(row) {
    await ensureCurrentDavTotalMatches(row.total);
    click(await waitForReadyButton('btnFecharDav', '#btnFecharDav nao ficou disponivel para o primeiro fechamento.'));
    const cash = await waitFor(() => { const x = getCalebeDoc().getElementById('vlDinheiro'); return x && visible(x) ? x : null; }, { timeout: 8000, message: 'Tela de pagamento nao apareceu.' });
    await command('autofill-cash', {}, 3000);
    await waitFor(() => {
      const n = parseMoney(cash.value); return Number.isFinite(n) && Math.abs(n - row.total) <= 0.01;
    }, { timeout: 4000, message: 'vlDinheiro nao recebeu o total esperado.' });

    click(await waitForReadyButton('btnFecharDav', 'btnFecharDav final nao ficou disponivel.'));
  }
  async function fillRow(index) {
    const row = state.rows[index];
    if (!row || state.busy) return;
    row.multi = [row.product21, row.product22, row.productOther].filter(Boolean).length > 1;
    state.selectedIndex = index;
    if (!row.clientCode) {
      if (isNewEnabled(row)) {
        console.warn(`[Calebe Helper] Linha ${index + 1}: ${row.type} sem código — novo cadastro ainda será implementado. DAV não iniciada.`);
      } else console.warn(`[Calebe Helper] Linha ${index + 1}: cliente sem código e tipo não habilitado.`);
      return;
    }

    state.busy = true;
    renderRows();
    minimizePanelForFill();
    try {
      console.log('[FLUXO PREENCHER] Preencher acionado.');
      status(`Linha ${index + 1}: criando nova DAV...`);
      await openBlankDavThroughClientDav();
      status(`Linha ${index + 1}: preenchendo observacao ${row.oc}...`);
      await fillObservation(row.oc);
      console.log('[FLUXO PREENCHER] Observação preenchida.');
      await selectClientByCode(row.clientCode, { clearFirst: true });
      console.log('[FLUXO PREENCHER] Cliente confirmado.');
      status(`Linha ${index + 1}: cliente ${row.clientCode} confirmado.`);
      const productInput = getCalebeDoc().getElementById('inlinePrdCodigo');
      const automaticProduct = await fillSelectedProduct(row);
      if (!automaticProduct && productInput) productInput.focus();
      status(`Linha ${index + 1}: cliente confirmado. Aguardando indefinidamente o produto em #inlinePrdDesc...`, 'ok');
      // O produto e informado manualmente no Calebe: o usuario digita #inlinePrdCodigo
      // e pressiona Tab; a automacao so continua quando #inlinePrdDesc for preenchido.
      await applyCoefficientWhileWaitingForProduct();
      if (row.multi) {
        armMultiItem(row);
        status('Vários itens: produto carregado. Ajuste o primeiro item; ao escolher o próximo produto, a quantidade necessária para completar o total será calculada automaticamente.', 'ok');
        return;
      }

      status(`Linha ${index + 1}: produto carregado; aplicando coeficiente e calculando quantidade para ${money(row.total)}...`);
      await fillSingleItem(row.total);
      await closeDavSequence(row);
      row.status = 'done';
      await saveState();
      renderRows();
      status(`Linha ${index + 1} concluida: ${row.oc} - ${money(row.total)}.`, 'ok');
    } catch (e) {
      console.error('[Calebe Helper]', e);
    } finally {
      state.busy = false;
      renderRows();
      if (!state.multiSession) restorePanelAfterFill();
    }
  }

  function buildAddress(row) {
    const endereco = [
      row.ClienteLogradouro,
      Number(row.ClienteNumero) > 0 ? row.ClienteNumero : '',
      row.ClienteComplemento,
      row.ClienteBairro
    ].filter(v => String(v ?? '').trim() !== '').join(', ');
    const cidadeUf = [row.ClienteMunicipio, row.ClienteUf].filter(Boolean).join(' / ');
    return [endereco, cidadeUf].filter(Boolean).join(' — ');
  }

  function installClientOverlay() {
    const doc = getCalebeDoc();
    const input = doc.getElementById('cliNome');
    if (!input) return null;
    const group = input.closest('.input-group') || input.parentElement;
    if (!group) return null;
    group.style.position = 'relative';

    let overlay = doc.getElementById('calebe-cliente-overlay');
    if (!overlay) {
      overlay = doc.createElement('div');
      overlay.id = 'calebe-cliente-overlay';
      overlay.style.position = 'absolute';
      const icone = group.querySelector('.input-group-text');
      const larguraIcone = icone ? icone.getBoundingClientRect().width : 34;
      overlay.style.left = larguraIcone + 'px';
      overlay.style.right = '1px';
      overlay.style.top = '1px';
      overlay.style.bottom = '1px';
      overlay.style.display = 'none';
      overlay.style.alignItems = 'center';
      overlay.style.padding = '0 8px';
      overlay.style.background = '#fff';
      overlay.style.borderRadius = '0 4px 4px 0';
      overlay.style.whiteSpace = 'nowrap';
      overlay.style.overflow = 'hidden';
      overlay.style.pointerEvents = 'none';
      overlay.style.zIndex = '5';
      group.appendChild(overlay);
    }

    if (!input.dataset.chOverlayWired) {
      input.dataset.chOverlayWired = '1';
      input.addEventListener('focus', () => { overlay.style.display = 'none'; });
      input.addEventListener('blur', () => {
        if (overlay.dataset.temCliente === '1') setTimeout(() => { overlay.style.display = 'flex'; }, 100);
      });
    }
    return overlay;
  }

  function renderClientOverlay(row) {
    if (!row || !row.ClienteCodigo) return;
    const overlay = installClientOverlay();
    if (!overlay) return;
    const enderecoCompleto = buildAddress(row);
    overlay.innerHTML = `
      <span style="flex:0 0 auto;display:inline-block;padding:2px 7px;margin-right:7px;background:#0d6efd;color:#fff;border-radius:4px;font-size:.70rem;font-weight:700;line-height:1.4;">CÓD. ${esc(row.ClienteCodigo)}</span>
      <span style="flex:0 1 auto;min-width:0;font-size:.80rem;font-weight:600;color:#212529;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(row.ClienteRazaoSocial || '')}</span>
      <span style="flex:0 1 auto;min-width:0;margin-left:8px;color:#6c757d;font-size:.70rem;font-weight:400;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${enderecoCompleto ? '· ' + esc(enderecoCompleto) : ''}</span>`;
    overlay.dataset.temCliente = '1';
    setTimeout(() => { overlay.style.display = 'flex'; }, 50);
  }

  async function saveState() {
    if (!extensionContextValid()) return false;

    try {
      await chrome.storage.local.set({
        [STORAGE_KEY]: {
          rows: state.rows,
          settings: state.settings
        }
      });
      return true;
    } catch (error) {
      if (isExtensionContextInvalidatedError(error)) return false;
      throw error;
    }
  }

  async function loadState() {
    if (!extensionContextValid()) return false;

    try {
      const saved = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] || {};
      state.rows = Array.isArray(saved.rows) ? saved.rows : [];
      state.settings = { ...structuredClone(DEFAULTS), ...(saved.settings || {}), geometry: { ...DEFAULTS.geometry, ...(saved.settings?.geometry || {}) } };
      if (!saved.settings?.coefficient21 && Number(saved.settings?.coefficient) > 0) state.settings.coefficient21 = Number(saved.settings.coefficient);
      syncControls(); applyTheme(); applyGeometry(); renderRows(); wireFrame();
      if (state.rows.length) showPanel();
      else hidePanel();
      return true;
    } catch (error) {
      if (isExtensionContextInvalidatedError(error)) return false;
      throw error;
    }
  }

  function syncControls() {
    $('#ch-cpf').checked = !!state.settings.cpf;
    $('#ch-cnpj').checked = !!state.settings.cnpj;
    $('#ch-coef-21').value = state.settings.coefficient21;
    $('#ch-coef-22').value = state.settings.coefficient22;
    root.querySelectorAll('input[name="ch-theme"]').forEach(input => {
      input.checked = input.value === (state.settings.theme || 'bootstrap');
    });
    root.querySelectorAll('input[name="ch-layout"]').forEach(input => {
      input.checked = input.value === (state.settings.layout === 'test-two' ? 'test-two' : 'test-one');
    });
  }

  function applyGeometry() {
    const g = state.settings.geometry;
    root.style.width = `${Math.max(460, Number(g.width) || 760)}px`;
    root.style.height = 'auto';
    root.style.top = `${Math.max(0, Number(g.top) || 0)}px`;
    if (g.left == null) root.style.left = `${Math.max(0, window.innerWidth - (Number(g.width) || 760) - 16)}px`;
    else root.style.left = `${Math.max(0, Number(g.left) || 0)}px`;
    refreshResizeMinimums();
  }

  function getResizeMinimums() {
    const body = $('.ch-body');
    const table = $('table');
    const toolbar = $('.ch-toolbar');
    if (!body || !table || !toolbar) return { width: 0, height: 0 };

    const tableWidth = table.style.width;
    const toolbarWidth = toolbar.style.width;
    table.style.width = 'max-content';
    toolbar.style.width = 'max-content';
    const tableContentWidth = table.getBoundingClientRect().width;
    const toolbarContentWidth = toolbar.getBoundingClientRect().width;
    table.style.width = tableWidth;
    toolbar.style.width = toolbarWidth;

    const bodyStyle = getComputedStyle(body);
    const horizontalPadding = parseFloat(bodyStyle.paddingLeft) + parseFloat(bodyStyle.paddingRight);
    const borderWidth = parseFloat(getComputedStyle(root).borderLeftWidth) + parseFloat(getComputedStyle(root).borderRightWidth);
    const width = Math.ceil(Math.max(tableContentWidth, toolbarContentWidth) + horizontalPadding + borderWidth);

    const previousHeight = root.style.height;
    const previousBodyOverflow = body.style.overflow;
    root.style.height = 'auto';
    body.style.overflow = 'visible';
    const height = Math.ceil(root.scrollHeight);
    root.style.height = previousHeight;
    body.style.overflow = previousBodyOverflow;
    return { width, height };
  }

  function refreshResizeMinimums() {
    const minimums = getResizeMinimums();
    root.style.minWidth = `${minimums.width}px`;
    root.style.minHeight = `${minimums.height}px`;
    root.dataset.minWidth = String(minimums.width);
    root.dataset.minHeight = String(minimums.height);
  }

  function clampGeometry() {
    const r = root.getBoundingClientRect();
    const left = Math.min(Math.max(0, r.left), Math.max(0, window.innerWidth - 80));
    const top = Math.min(Math.max(0, r.top), Math.max(0, window.innerHeight - 40));
    root.style.left = `${left}px`; root.style.top = `${top}px`;
    state.settings.geometry = { left, top, width: r.width, height: r.height };
    saveState().catch(error => {
      if (!isExtensionContextInvalidatedError(error)) {
        console.error('[Calebe Helper] Falha ao salvar geometria:', error);
      }
    });
  }

  function enableDragResize() {
    const header = $('#ch-drag-handle');
    let drag = null;
    header.addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return;
      const r = root.getBoundingClientRect();
      drag = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
      header.setPointerCapture(e.pointerId); e.preventDefault();
    });
    header.addEventListener('pointermove', e => {
      if (!drag) return;
      root.style.left = `${drag.left + e.clientX - drag.x}px`;
      root.style.top = `${drag.top + e.clientY - drag.y}px`;
    });
    header.addEventListener('pointerup', () => { if (drag) { drag = null; clampGeometry(); } });

    const edgeAt = event => {
      const rect = root.getBoundingClientRect();
      const margin = 7;
      return {
        left: event.clientX - rect.left <= margin,
        right: rect.right - event.clientX <= margin,
        top: event.clientY - rect.top <= margin,
        bottom: rect.bottom - event.clientY <= margin
      };
    };
    const edgeCursor = edge => {
      if ((edge.top && edge.left) || (edge.bottom && edge.right)) return 'nwse-resize';
      if ((edge.top && edge.right) || (edge.bottom && edge.left)) return 'nesw-resize';
      if (edge.left || edge.right) return 'ew-resize';
      if (edge.top || edge.bottom) return 'ns-resize';
      return '';
    };
    let resizeState = null;
    root.addEventListener('pointermove', event => {
      if (!resizeState) {
        root.style.cursor = edgeCursor(edgeAt(event));
        return;
      }
      const deltaX = event.clientX - resizeState.x;
      const deltaY = event.clientY - resizeState.y;
      const minimums = getResizeMinimums();
      let width = resizeState.width;
      let height = resizeState.height;
      let left = resizeState.left;
      let top = resizeState.top;
      if (resizeState.edge.right) width = Math.max(minimums.width, resizeState.width + deltaX);
      if (resizeState.edge.bottom) height = Math.max(minimums.height, resizeState.height + deltaY);
      if (resizeState.edge.left) {
        width = Math.max(minimums.width, resizeState.width - deltaX);
        left = resizeState.right - width;
      }
      if (resizeState.edge.top) {
        height = Math.max(minimums.height, resizeState.height - deltaY);
        top = resizeState.bottom - height;
      }
      root.style.width = `${width}px`;
      root.style.height = `${height}px`;
      root.style.left = `${left}px`;
      root.style.top = `${top}px`;
    });
    root.addEventListener('pointerdown', event => {
      const edge = edgeAt(event);
      if (!edgeCursor(edge)) return;
      refreshResizeMinimums();
      const rect = root.getBoundingClientRect();
      resizeState = { edge, x: event.clientX, y: event.clientY, width: rect.width, height: rect.height, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
      root.setPointerCapture(event.pointerId);
      event.preventDefault();
      event.stopPropagation();
    }, true);
    root.addEventListener('pointerup', event => {
      if (!resizeState) return;
      resizeState = null;
      root.releasePointerCapture?.(event.pointerId);
      root.style.cursor = '';
      clampGeometry();
    });
  }

  root.addEventListener('change', async e => {
    if (e.target.matches('.ch-line-product')) {
      const i = Number(e.target.dataset.index);
      const product = e.target.dataset.product;
      const property = product === '21' ? 'product21' : product === '22' ? 'product22' : 'productOther';
      state.rows[i][property] = e.target.checked;
      state.rows[i].multi = [state.rows[i].product21, state.rows[i].product22, state.rows[i].productOther].filter(Boolean).length > 1;
      await saveState(); renderRows(); return;
    }
    if (e.target.id === 'ch-cpf' || e.target.id === 'ch-cnpj') {
      const type = e.target.id === 'ch-cpf' ? 'CPF' : 'CNPJ';
      const val = e.target.checked;
      state.settings[type.toLowerCase()] = val;
      await saveState(); renderRows(); return;
    }
    if (e.target.id === 'ch-coef-21') state.settings.coefficient21 = Number(e.target.value) || 2000;
    if (e.target.id === 'ch-coef-22') state.settings.coefficient22 = Number(e.target.value) || 2000;
    if (e.target.name === 'ch-theme') {
      state.settings.theme = ['bootstrap', 'glass', 'neutral'].includes(e.target.value) ? e.target.value : 'bootstrap';
      applyTheme();
    }
    if (e.target.name === 'ch-layout') {
      state.settings.layout = e.target.value === 'test-two' ? 'test-two' : 'test-one';
      applyTheme();
    }
    await saveState();
  });

  root.addEventListener('click', async e => {
    const clearButton = e.target.closest('.ch-clear-done, .ch-clear-all');
    if (clearButton) {
      const clearAll = clearButton.classList.contains('ch-clear-all');
      if (state.busy && !clearAll) {
        status('Existe uma DAV sendo preenchida. Não é possível limpar linhas concluídas agora.', 'warn');
        return;
      }
      if (state.busy && clearAll && !window.confirm('Existe uma DAV sendo preenchida. Tem certeza de que deseja limpar todos os itens?')) return;
      const remaining = clearAll ? [] : state.rows.filter(row => row.status !== 'done');
      const removed = state.rows.length - remaining.length;
      state.rows = remaining;
      state.selectedIndex = null;
      await saveState();
      renderRows();
      if (!state.rows.length) hidePanel();
      status(clearAll ? 'Todos os dados foram limpos.' : `${removed} concluído(s) removido(s).`, 'ok');
      return;
    }
    const b = e.target.closest('.ch-fill');
    if (b) { await fillRow(Number(b.dataset.index)); return; }
  });

  if (extensionContextValid()) {
    try {
      chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (!['show-panel', 'clear-panel'].includes(message?.action)) return;
        loadState()
          .then(() => {
            if (message.action === 'clear-panel' || !state.rows.length) {
              hidePanel();
              status('Dados limpos.', 'ok');
            } else {
              showPanel();
              status(`${state.rows.length} linha(s) importada(s).`, 'ok');
            }
            sendResponse({ ok: true });
          })
          .catch(err => sendResponse({ ok: false, error: String(err?.message || err) }));
        return true;
      });
    } catch (error) {
      if (!isExtensionContextInvalidatedError(error)) throw error;
    }

    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes[STORAGE_KEY]) return;
        const saved = changes[STORAGE_KEY].newValue || {};
        state.rows = Array.isArray(saved.rows) ? saved.rows : [];
        state.settings = { ...structuredClone(DEFAULTS), ...(saved.settings || {}), geometry: { ...DEFAULTS.geometry, ...(saved.settings?.geometry || {}) } };
        if (!saved.settings?.coefficient21 && Number(saved.settings?.coefficient) > 0) state.settings.coefficient21 = Number(saved.settings.coefficient);
        syncControls();
        applyTheme();
        renderRows();
        if (!state.rows.length) hidePanel();
      });
    } catch (error) {
      if (!isExtensionContextInvalidatedError(error)) throw error;
    }
  }

  function showPanel() {
    state.visible = true;
    root.style.display = '';
    root.classList.remove('ch-hidden', 'ch-unfocused');
    requestAnimationFrame(() => root.classList.remove('ch-hiding'));
  }

  function hidePanel() {
    state.visible = false;
    root.classList.remove('ch-unfocused');
    root.classList.add('ch-hiding');
    setTimeout(() => {
      if (!state.visible) {
        root.classList.add('ch-hidden');
        root.style.display = 'none';
      }
    }, 180);
  }

  function minimizePanelForFill() {
    if (root.classList.contains('ch-collapsed')) return;
    autoMinimizedPanel = true;
    const right = root.getBoundingClientRect().right;
    root.classList.add('ch-collapsed');
    root.style.left = `${Math.max(0, right - root.getBoundingClientRect().width)}px`;
  }

  function restorePanelAfterFill() {
    if (!autoMinimizedPanel) return;
    autoMinimizedPanel = false;
    const right = root.getBoundingClientRect().right;
    root.classList.remove('ch-collapsed');
    root.style.left = `${Math.max(0, right - root.getBoundingClientRect().width)}px`;
    root.classList.remove('ch-unfocused');
  }

  $('#ch-close').addEventListener('click', hidePanel);
  $('#ch-minimize').addEventListener('click', () => {
    const right = root.getBoundingClientRect().right;
    root.classList.toggle('ch-collapsed');
    root.style.left = `${Math.max(0, right - root.getBoundingClientRect().width)}px`;
  });

  root.addEventListener('pointerdown', () => {
    lastPanelPointerAt = Date.now();
    root.classList.remove('ch-unfocused');
  }, true);
  root.addEventListener('click', () => {
    lastPanelPointerAt = Date.now();
    root.classList.remove('ch-unfocused');
  }, true);

  function refreshFocusMode() {
    const activeInside = root.contains(document.activeElement);
    root.classList.toggle('ch-unfocused', !activeInside && !state.busy);
  }

  root.addEventListener('focusin', () => root.classList.remove('ch-unfocused'));
  root.addEventListener('mouseenter', () => root.classList.remove('ch-unfocused'));
  document.addEventListener('pointerdown', e => {
    if (!root.contains(e.target)) collapsePanelPreview();
  }, true);

  document.addEventListener('keydown', e => {
    if (e.key === 'F2') { e.preventDefault(); state.visible ? hidePanel() : showPanel(); }
    if (e.key === 'F3' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      const obs = getCalebeDoc().getElementById('obsNota'); if (obs) { e.preventDefault(); obs.focus(); obs.select?.(); }
    }
  }, true);

  const observer = new MutationObserver(() => {
    if (!document.documentElement.contains(root)) document.documentElement.appendChild(root);
    wireFrame();
  });
  observer.observe(document.documentElement, { childList:true, subtree:true });
  window.addEventListener('resize', clampGeometry);

  enableDragResize();
  window.calebeHelperSelectClientByCode = selectClientByCode;
  loadState().catch(e => console.error('[Calebe Helper] Falha ao carregar:', e));
  console.info(`[Calebe Helper] v${APP_VERSION} carregado em`, location.href);
})();

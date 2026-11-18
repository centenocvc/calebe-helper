/* global chrome */
/**
 * novodav_cliente.js — v2.1
 *
 * Busca unificada no campo #cliNome da tela de criação de DAV.
 * - Pesquisa por razão social (tipo 0 — já nativo), fantasia (tipo 1) e CPF/CNPJ (tipo 4).
 * - Injeta os resultados extras no dropdown nativo (#cli_ac) — o Calebe continua intacto.
 * - Padroniza os itens nativos e extras: nome · fantasia / documento · endereço.
 * - Clique (ou Enter) no resultado preenche #cliNome com o nome do cliente, nunca com o código.
 * - Overlay do cliente selecionado compartilhado com o fillexcel_modal.js.
 * - Clique em #cliNome libera o campo para uma nova pesquisa (limpa cliente/overlay).
 * - NÃO zera o #cliId: o Calebe usa '1' (CONSUMIDOR) como fallback para cliente livre.
 * - Cliente livre (nome não cadastrado): o Calebe mantém cliId='1' e o DAV emite.
 * - Nome em maiúsculo no blur (sem quebrar a busca durante a digitação).
 * - NÃO substitui window.fetch do Calebe. NÃO mexe no fillexcel_modal.js.
 */
(() => {
  'use strict';

  if (window.__novoDavClienteInstalled) return;
  window.__novoDavClienteInstalled = true;

  const LOG = '[NovoDAV-Cliente]';
  const NS = 'nc';
  const AJAX_URL = '/calweb/modulos/dav01/dav01_ajax.php';
  const TIPOS = { RAZAO: '0', FANTASIA: '1', DOC: '4' };
  const LIMIT = 10;
  const MIN_CHARS = 2;

  // ⬛ Bloco: acesso ao documento do Calebe
  const getCalebeDoc = () => {
    const frame = document.getElementById('mainIframe');
    if (frame) {
      try { return frame.contentDocument || document; } catch (_) { return document; }
    }
    return document;
  };
  const getCalebeWin = () => {
    const frame = document.getElementById('mainIframe');
    if (frame) {
      try { return frame.contentWindow || window; } catch (_) { return window; }
    }
    return window;
  };

  // ⬛ Bloco: chave de sessão exigida pelo backend do SATGO
  const getSessionKey = () => {
    for (const source of [getCalebeDoc(), document]) {
      try {
        const chave = new URL(source.location.href).searchParams.get('chave');
        if (chave) return chave;
      } catch (_) { }
    }
    const hidden = getCalebeDoc().querySelector('input[name="chave"]');
    return hidden ? String(hidden.value || '').trim() : '';
  };

  // ⬛ Bloco: helpers
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  const buildAddress = row => {
    const endereco = [
      row.ClienteLogradouro,
      Number(row.ClienteNumero) > 0 ? row.ClienteNumero : '',
      row.ClienteComplemento,
      row.ClienteBairro
    ].filter(v => String(v ?? '').trim() !== '').join(', ');
    const cidadeUf = [row.ClienteMunicipio, row.ClienteUf].filter(Boolean).join(' / ');
    return [endereco, cidadeUf].filter(Boolean).join(' — ');
  };

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function waitFor(fn, { timeout = 8000, interval = 100, message = 'timeout' } = {}) {
    const start = Date.now();
    let lastErr;
    while (Date.now() - start < timeout) {
      try { const v = fn(); if (v) return v; } catch (e) { lastErr = e; }
      await sleep(interval);
    }
    throw lastErr || new Error(message);
  }

  function setNativeValue(el, value) {
    if (!el) return false;
    const win = el.ownerDocument.defaultView;
    const proto = win.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter ? setter.call(el, String(value)) : (el.value = String(value));
    el.dispatchEvent(new win.Event('input', { bubbles: true }));
    el.dispatchEvent(new win.Event('change', { bubbles: true }));
    return true;
  }

  // ⬛ Bloco: busca no backend (mesma sessão/AJAX do Calebe)
  async function fetchClientSearch(termo, tipo) {
    const doc = getCalebeDoc();
    const win = getCalebeWin();
    const chave = getSessionKey();

    const FD = win?.FormData || FormData;
    const fd = new FD();
    fd.append('acao', 'search_clientes');
    fd.append('q', termo);
    fd.append('tipo', tipo);
    fd.append('offset', '0');
    fd.append('limit', String(LIMIT));
    if (chave) fd.append('chave', chave);

    let url = AJAX_URL;
    try {
      const target = new URL(AJAX_URL, doc.location.href);
      if (chave) target.searchParams.set('chave', chave);
      url = target.href;
    } catch (_) { }

    try {
      const fetcher = (win?.fetch || fetch).bind(win || window);
      const resp = await fetcher(url, {
        method: 'POST',
        body: fd,
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'application/json, text/plain, */*'
        }
      });
      if (!resp.ok) return [];
      const data = await resp.json();
      if (Array.isArray(data)) return data;
      if (Array.isArray(data?.clientes)) return data.clientes;
      if (Array.isArray(data?.data)) return data.data;
      return [];
    } catch (e) {
      return [];
    }
  }

  async function fetchClientByCode(code) {
    const results = await Promise.allSettled([
      fetchClientSearch(code, TIPOS.RAZAO),
      fetchClientSearch(code, TIPOS.FANTASIA),
      fetchClientSearch(code, TIPOS.DOC)
    ]);
    const flat = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
    const byCode = new Map();
    for (const row of flat) {
      if (!row?.ClienteCodigo) continue;
      byCode.set(String(row.ClienteCodigo), row);
    }
    return byCode.get(String(code)) || null;
  }

  // ⬛ Bloco: overlay compartilhado com o fillexcel_modal.js
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
    const endereco = buildAddress(row);
    overlay.innerHTML = `
      <span style="flex:0 0 auto;display:inline-block;padding:2px 7px;margin-right:7px;background:#0d6efd;color:#fff;border-radius:4px;font-size:.70rem;font-weight:700;line-height:1.4;">CÓD. ${esc(row.ClienteCodigo)}</span>
      <span style="flex:0 1 auto;min-width:0;font-size:.80rem;font-weight:600;color:#212529;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(row.ClienteRazaoSocial || '')}</span>
      <span style="flex:0 1 auto;min-width:0;margin-left:8px;color:#6c757d;font-size:.70rem;font-weight:400;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${endereco ? '· ' + esc(endereco) : ''}</span>`;
    overlay.dataset.temCliente = '1';
    setTimeout(() => { overlay.style.display = 'flex'; }, 50);
  }

  function clearClientOverlay() {
    const doc = getCalebeDoc();
    const overlay = doc.getElementById('calebe-cliente-overlay');
    if (!overlay) return;
    overlay.dataset.temCliente = '0';
    overlay.style.display = 'none';
    overlay.innerHTML = '';
  }

  // ⬛ Bloco: "CONSUMIDOR" padrão em cinza; limpa ao focar e volta ao sair vazio
  function installConsumerPlaceholder() {
    const doc = getCalebeDoc();
    const input = doc.getElementById('cliNome');
    if (!input || input.dataset[`${NS}ConsumerWired`]) return;
    input.dataset[`${NS}ConsumerWired`] = '1';

    const DEFAULT_NAME = 'CONSUMIDOR';
    const isDefault = () => String(input.value || '').trim().toUpperCase() === DEFAULT_NAME;
    let clearedOnFocus = false;

    const paintDefault = () => {
      if (isDefault()) {
        input.style.color = '#6c757d';
        input.dataset[`${NS}ConsumerDefault`] = '1';
      } else {
        input.style.color = '';
        delete input.dataset[`${NS}ConsumerDefault`];
      }
    };

    input.addEventListener('focus', () => {
      if (!isDefault()) return;
      clearedOnFocus = true;
      input.value = '';
      input.style.color = '';
      delete input.dataset[`${NS}ConsumerDefault`];
    });

    input.addEventListener('blur', () => {
      if (clearedOnFocus && !String(input.value || '').trim()) {
        input.value = DEFAULT_NAME;
        paintDefault();
      } else {
        paintDefault();
      }
      clearedOnFocus = false;
      setTimeout(paintDefault, 50);
    });

    input.addEventListener('input', () => {
      if (String(input.value || '').trim()) {
        clearedOnFocus = false;
        input.style.color = '';
        delete input.dataset[`${NS}ConsumerDefault`];
      }
    });

    if (doc.activeElement === input && isDefault()) {
      clearedOnFocus = true;
      input.value = '';
      input.style.color = '';
      delete input.dataset[`${NS}ConsumerDefault`];
    } else {
      paintDefault();
    }
  }

  // ⬛ Bloco: busca por código (reproduz o caminho nativo + overlay)
  async function selectClientByCode(code, { clearFirst = false } = {}) {
    const expected = String(code ?? '').trim();
    if (!/^\d+$/.test(expected)) throw new Error('Código inválido.');

    const doc = getCalebeDoc();
    const win = getCalebeWin();
    const input = doc.getElementById('cliNome');
    if (!input) throw new Error('#cliNome não encontrado.');

    const overlay = installClientOverlay();

    if (clearFirst) {
      const cliId = doc.getElementById('cliId');
      if (overlay) { overlay.dataset.temCliente = '0'; overlay.style.display = 'none'; overlay.innerHTML = ''; }
      setNativeValue(input, '');
      if (cliId) setNativeValue(cliId, '');
      await sleep(80);
    }

    input.focus();
    setNativeValue(input, expected);
    input.dispatchEvent(new win.Event('input', { bubbles: true }));
    await sleep(60);
    input.dispatchEvent(new win.KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
    }));

    await waitFor(() => String(doc.getElementById('cliId')?.value || '') === expected, {
      timeout: 7000,
      message: `Cliente ${expected} não foi confirmado em #cliId.`
    });

    try {
      const row = await fetchClientByCode(expected);
      if (row) renderClientOverlay(row);
    } catch (_) { /* silencioso */ }
  }

  // ⬛ Bloco: injetar resultados extras (fantasia + CPF/CNPJ) no dropdown nativo
  function getAcItemCodes(ac) {
    const codes = new Set();
    ac.querySelectorAll('.ac-item:not(.nc-extra-item)').forEach(el => {
      const code = el.dataset.clienteCodigo
        || el.dataset.id
        || el.querySelector('[data-cliente-codigo]')?.dataset.clienteCodigo;
      if (code) codes.add(String(code));
    });
    return codes;
  }

  const normalizeAcText = text => String(text ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const extractAcDocument = text => {
    const normalized = normalizeAcText(text);
    const formatted = normalized.match(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/)
      || normalized.match(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/);
    if (formatted) return formatted[0];
    const digits = normalized.match(/\b\d{11,14}\b/);
    return digits ? digits[0] : '';
  };

  const buildAcItemContent = ({ name, fantasia, doc, endereco, extra = false }) => {
    const nameStyle = extra ? 'color:#212529 !important;' : '';
    const mutedStyle = extra ? 'color:#6c757d !important;' : '';
    const fantasiaText = fantasia && normalizeAcText(fantasia).toUpperCase() !== normalizeAcText(name).toUpperCase()
      ? `<span style="font-size:.85em;font-weight:700;color:#6c757d !important;"> · </span><span style="font-size:.85em;font-weight:600;color:#212529 !important;">${esc(fantasia)}</span>`
      : '';
    const docHtml = doc ? `<span style="${mutedStyle}">${esc(doc)}</span>` : '';
    const enderecoHtml = endereco
      ? `<span class="ms-2" style="${mutedStyle}">${doc ? '<strong style="font-weight:700;">·</strong> ' : ''}${esc(endereco)}</span>`
      : '';
    const detailHtml = (docHtml || enderecoHtml)
      ? `<div class="text-muted nc-ac-detail" style="font-size:.73rem;margin-top:1px;">${docHtml}${enderecoHtml}</div>`
      : '';
    return `<div class="fw-bold nc-ac-name" style="font-size:.84rem;${nameStyle}">${esc(name || '')}${fantasiaText}</div>${detailHtml}`;
  };

  function findAcList(ac) {
    if (!ac) return null;
    const lists = [];
    if (ac.classList?.contains('ac-list')) lists.push(ac);
    lists.push(...ac.querySelectorAll('.ac-list'));
    return lists.find(list => list.querySelector('.ac-item:not(.nc-extra-item)'))
      || lists.find(list => list.querySelector('.ac-item'))
      || ac.querySelector('.ac-item:not(.nc-extra-item)')?.parentElement
      || lists[0]
      || null;
  }

  function ensureAcList(ac, doc) {
    const current = findAcList(ac);
    if (current) return current;
    const list = doc.createElement('div');
    list.className = 'ac-list';
    ac.appendChild(list);
    return list;
  }

  function extractNativeAddress(item) {
    const detail = item.querySelector('.text-muted') || item.querySelector('.ac-detail');
    if (!detail) return '';
    const spans = [...detail.querySelectorAll('span')];
    const addressSpan = detail.querySelector('span.ms-2')
      || spans.find(span => /—/.test(span.textContent || ''))
      || (spans.length > 1 ? spans[spans.length - 1] : null);
    if (!addressSpan) return '';
    return normalizeAcText(addressSpan.textContent).replace(/^[·•]\s*/, '');
  }

  function formatNativeAcItems(ac) {
    if (!ac) return;
    ac.querySelectorAll('.ac-item:not(.nc-extra-item)').forEach(item => {
      const existingName = item.querySelector('.nc-ac-name');
      if (existingName) {
        const plainName = normalizeAcText(existingName.childNodes[0]?.textContent || '');
        if (plainName) item.dataset[`${NS}Nome`] = plainName;
        item.dataset[`${NS}Formatted`] = '1';
        return;
      }
      const name = normalizeAcText(item.querySelector('.fw-bold')?.textContent || item.dataset.nome || '');
      const detail = item.querySelector('.text-muted') || item.querySelector('.ac-detail');
      if (!name || !detail) return;
      const doc = extractAcDocument(detail.textContent);
      const endereco = extractNativeAddress(item);
      if (!doc && !endereco) return;
      const fantasia = normalizeAcText(item.dataset.fantasia || item.dataset.nomeFantasia || item.dataset.nomeFantazia || '');
      item.innerHTML = buildAcItemContent({ name, fantasia, doc, endereco });
      item.dataset[`${NS}Nome`] = name;
      item.dataset[`${NS}Formatted`] = '1';
    });
  }

  function setInputValueSilently(input, value) {
    if (!input) return;
    const win = input.ownerDocument.defaultView;
    const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')?.set;
    setter ? setter.call(input, String(value)) : (input.value = String(value));
  }

  function fillClientNameFromItem(item, doc, options = {}) {
    if (!item) return;
    const force = options.force === true;
    const input = doc.getElementById('cliNome');
    const cliId = doc.getElementById('cliId');
    if (!input) return;
    const visibleName = normalizeAcText(item.querySelector?.('.fw-bold')?.textContent || '');
    const name = String(item.dataset[`${NS}Nome`] || visibleName || item.dataset.nome || '').trim();
    const code = String(item.dataset.id || item.dataset.clienteCodigo || '').trim();
    if (!name) return;

    const currentName = normalizeAcText(input.value).toUpperCase();
    const wantedName = normalizeAcText(name).toUpperCase();
    const currentValue = String(input.value || '').trim();
    const currentId = String(cliId?.value || '').trim();

    if (code) {
      if (!force && currentId && currentId !== code) return;
      if (!force && !currentId && currentValue !== code && currentName !== wantedName) return;
      if (currentId !== code && cliId) setNativeValue(cliId, code);
      if (currentName !== wantedName) setInputValueSilently(input, name);
      return;
    }

    if (!force && currentValue && currentName !== wantedName) return;
    if (currentName !== wantedName) setInputValueSilently(input, name);
  }

  function buildExtraAcItem(doc, row) {
    const code = String(row.ClienteCodigo ?? '').trim();
    const name = String(row.ClienteRazaoSocial || row.ClienteNomeFantazia || '').trim();
    const fantasia = String(row.ClienteNomeFantazia || '').trim();
    const documento = String(row.ClienteCGC || row.ClienteCNPJ || row.ClienteCnpj || row.ClienteCPF || row.ClienteCpf || '').trim();
    const endereco = buildAddress(row);

    const sample = doc.querySelector('#cli_ac .ac-item:not(.nc-extra-item)');
    const li = doc.createElement(sample?.tagName === 'LI' ? 'li' : 'div');
    li.className = 'ac-item nc-extra-item';
    li.dataset.clienteCodigo = code;
    li.dataset.id = code;
    li.dataset.nome = name;
    li.dataset[`${NS}Nome`] = name;
    li.style.padding = '.45rem .75rem';
    li.style.cursor = 'pointer';
    li.style.fontSize = '.82rem';
    li.style.background = '#f0f2f7';
    li.setAttribute('onmousedown', sample?.getAttribute('onmousedown') || 'acSelecionarCliente(this)');
    li.innerHTML = buildAcItemContent({ name, fantasia, doc: documento, endereco, extra: true });
    li.title = [name, documento, endereco].filter(Boolean).join(' — ');

    li.addEventListener('mousedown', event => {
      if (event.button !== 0) return;
      setTimeout(() => {
        const input = doc.getElementById('cliNome');
        const cliId = doc.getElementById('cliId');
        const currentId = String(cliId?.value || '').trim();
        if (currentId === code) {
          const ac = doc.getElementById('cli_ac');
          if (ac) ac.style.display = 'none';
          fillClientNameFromItem(li, doc);
          renderClientOverlay(row);
          return;
        }
        if (!input || !cliId) return;
        setNativeValue(cliId, code);
        setInputValueSilently(input, name);
        const ac = doc.getElementById('cli_ac');
        if (ac) ac.style.display = 'none';
        renderClientOverlay(row);
      }, 0);
    });

    return li;
  }

  function isNativeEmptyNode(node) {
    if (!node) return false;
    if (node.nodeType === 3) return /Nenhum cliente encontrado/i.test(node.nodeValue || '');
    if (node.nodeType !== 1) return false;
    if (node.classList.contains('ac-item') || node.classList.contains('nc-extra-item')) return false;
    if (node.dataset?.clienteCodigo || node.dataset?.id) return false;
    if (node.querySelector('.ac-item, [data-cliente-codigo], [data-id], .nc-extra-item')) return false;
    return /Nenhum cliente encontrado/i.test(node.textContent || '');
  }

  function getAcContainers(ac) {
    return [ac, ...ac.querySelectorAll('.ac-list')].filter((el, index, list) => el && list.indexOf(el) === index);
  }

  function hasNativeEmptyState(ac) {
    return getAcContainers(ac).some(container =>
      [...container.childNodes].some(isNativeEmptyNode)
    );
  }

  function removeNativeEmptyState(ac) {
    getAcContainers(ac).forEach(container => {
      [...container.childNodes].forEach(node => {
        if (isNativeEmptyNode(node)) node.remove();
      });
    });
  }

  async function injectExtraResults(termo) {
    const doc = getCalebeDoc();
    const ac = doc.getElementById('cli_ac');
    if (!ac) return { found: false, extras: 0 };

    const tipos = [TIPOS.FANTASIA];
    if (/\d/.test(termo)) tipos.push(TIPOS.DOC);

    const results = await Promise.allSettled(tipos.map(t => fetchClientSearch(termo, t)));
    const flat = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
    const existing = getAcItemCodes(ac);
    const byCode = new Map();
    for (const row of flat) {
      if (!row?.ClienteCodigo) continue;
      const code = String(row.ClienteCodigo);
      if (existing.has(code)) continue;
      byCode.set(code, row);
    }

    const input = doc.getElementById('cliNome');
    if (!input || String(input.value || '').trim() !== termo) return { found: false, extras: 0 };
    if (ac.style.display === 'none') return { found: false, extras: 0 };

    ac.querySelectorAll('.nc-extra-item').forEach(el => el.remove());

    const extras = [...byCode.values()];
    if (!extras.length) return { found: false, extras: 0 };

    removeNativeEmptyState(ac);
    const list = ensureAcList(ac, doc);
    const nativeItems = [...list.querySelectorAll('.ac-item:not(.nc-extra-item)')];
    const insertAnchor = nativeItems.length
      ? nativeItems[nativeItems.length - 1].nextSibling
      : list.firstChild;
    for (const row of extras) {
      list.insertBefore(buildExtraAcItem(doc, row), insertAnchor);
    }
    ac.style.display = 'block';
    return { found: true, extras: extras.length };
  }

  // ⬛ Bloco: observa o dropdown #cli_ac e injeta extras quando o Calebe popular
  function installAcObserver() {
    const doc = getCalebeDoc();
    const input = doc.getElementById('cliNome');
    const ac = doc.getElementById('cli_ac');
    if (!input || !ac || input.dataset[`${NS}AcWired`]) return;
    input.dataset[`${NS}AcWired`] = '1';

    let lastTermo = '';
    let debounceTimer = null;
    let observer = null;
    let observerVis = null;
    let inFlight = false;

    const stopObservers = () => {
      if (observer) { observer.disconnect(); observer = null; }
      if (observerVis) { observerVis.disconnect(); observerVis = null; }
      inFlight = false;
    };

    const startObservers = () => {
      if (observer) return;
      observer = new doc.defaultView.MutationObserver(() => {
        if (ac.style.display === 'none') { stopObservers(); return; }
        formatNativeAcItems(ac);
        const temExtras = Boolean(ac.querySelector('.nc-extra-item'));
        if (!temExtras) lastTermo = '';
        else if (hasNativeEmptyState(ac)) removeNativeEmptyState(ac);
        scheduleInject();
      });
      observer.observe(ac, { childList: true, subtree: true });

      observerVis = new doc.defaultView.MutationObserver(() => {
        if (ac.style.display === 'none') { stopObservers(); return; }
        formatNativeAcItems(ac);
        scheduleInject();
      });
      observerVis.observe(ac, { attributes: true, attributeFilter: ['style', 'class'] });
    };

    const scheduleInject = () => {
      const termo = String(input.value || '').trim();
      if (termo.length < MIN_CHARS) return;
      if (termo === lastTermo) return;
      lastTermo = termo;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        if (ac.style.display === 'none') { lastTermo = ''; return; }
        if (inFlight) return;
        inFlight = true;
        try {
          const result = await injectExtraResults(termo);
          const temNativos = Boolean(ac.querySelector('.ac-item:not(.nc-extra-item)'));
          if (!result.found && !temNativos) {
            // Não existe cliente (nem razão, nem fantasia, nem CPF/CNPJ)
            // Desliga observers e deixa o Calebe agir como nativo.
            stopObservers();
            lastTermo = '';
            // ⬛ NÃO zera o #cliId — o Calebe usa '1' (CONSUMIDOR) como fallback
            // (se o usuário digitou um nome e não selecionou, o Calebe mantém cliId='1')
            return;
          }
          if (result.found) startObservers();
        } finally {
          inFlight = false;
        }
      }, 400);
    };

    input.addEventListener('input', () => {
      const termo = String(input.value || '').trim();
      if (termo.length < MIN_CHARS) {
        stopObservers();
        return;
      }
      startObservers();
      scheduleInject();
    });

    if (ac.style.display !== 'none') {
      startObservers();
      formatNativeAcItems(ac);
    }
  }

  function triggerAcItemMouseDown(item) {
    if (!item) return;
    const win = getCalebeWin();
    try {
      item.dispatchEvent(new win.MouseEvent('mousedown', {
        bubbles: true, cancelable: true, view: win, button: 0, buttons: 1
      }));
    } catch (_) {
      try {
        item.dispatchEvent(new MouseEvent('mousedown', {
          bubbles: true, cancelable: true, button: 0
        }));
      } catch (__) { }
    }
  }

  // ⬛ Bloco: Enter seleciona o item ativo; extras sem nativos são selecionados direto
  function installEnterByCodeHandler() {
    const doc = getCalebeDoc();
    const input = doc.getElementById('cliNome');
    if (!input || input.dataset[`${NS}EnterWired`]) return;
    input.dataset[`${NS}EnterWired`] = '1';

    input.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      const raw = String(input.value || '').trim();
      const lista = doc.getElementById('cli_ac');
      let visible = false;
      try {
        visible = Boolean(lista) && getCalebeWin().getComputedStyle(lista).display !== 'none';
      } catch (_) {
        visible = Boolean(lista) && lista.style.display !== 'none';
      }
      const items = visible ? [...lista.querySelectorAll('.ac-item')] : [];

      const activeItem = items.find(el => el.classList.contains('active'));
      if (activeItem) {
        e.preventDefault();
        e.stopImmediatePropagation();
        triggerAcItemMouseDown(activeItem);
        return;
      }

      const extras = items.filter(el => el.classList.contains('nc-extra-item'));
      const natives = items.filter(el => !el.classList.contains('nc-extra-item'));
      if (extras.length && !natives.length) {
        e.preventDefault();
        e.stopImmediatePropagation();
        triggerAcItemMouseDown(extras[0]);
        return;
      }

      if (items.length) {
        setTimeout(() => {
          const selectedId = String(doc.getElementById('cliId')?.value || '').trim();
          if (!selectedId) return;
          const selectedItem = items.find(el =>
            String(el.dataset.id || el.dataset.clienteCodigo || '').trim() === selectedId
          );
          if (selectedItem) scheduleNameFix(selectedItem, doc);
        }, 0);
        return;
      }
      if (!/^\d+$/.test(raw)) return;
      try {
        await waitFor(() => String(doc.getElementById('cliId')?.value || '') === raw, {
          timeout: 6000, message: 'timeout'
        });
        const row = await fetchClientByCode(raw);
        if (row) {
          scheduleNameFix({ dataset: { id: raw, nome: row.ClienteRazaoSocial || '' } }, doc);
          renderClientOverlay(row);
        }
      } catch (_) { /* silencioso */ }
    }, true);
  }

  function scheduleNameFix(item, doc) {
    if (!item) return;
    setTimeout(() => fillClientNameFromItem(item, doc, { force: true }), 0);
    const retry = () => {
      const input = doc.getElementById('cliNome');
      const code = String(item.dataset.id || item.dataset.clienteCodigo || '').trim();
      if (code && String(input?.value || '').trim() === code) {
        fillClientNameFromItem(item, doc, { force: true });
      }
    };
    setTimeout(retry, 120);
    setTimeout(retry, 500);
  }

  // ⬛ Bloco: garante que o clique/Enter em qualquer item preencha #cliNome com o nome
  function installAcItemNameFix() {
    const doc = getCalebeDoc();
    if (!doc?.documentElement || doc.documentElement.dataset[`${NS}ItemNameWired`]) return;
    doc.documentElement.dataset[`${NS}ItemNameWired`] = '1';

    doc.addEventListener('mousedown', event => {
      if (event.button !== 0) return;
      const item = event.target?.closest?.('.ac-item');
      if (!item) return;
      const ac = doc.getElementById('cli_ac');
      if (!ac || !ac.contains(item)) return;
      scheduleNameFix(item, doc);
    }, true);
  }

  // ⬛ Bloco: clique em #cliNome libera o campo para uma nova pesquisa
  // ⚠️ NÃO zera o #cliId — o Calebe usa '1' (CONSUMIDOR) como fallback para cliente livre.
  function installClientSearchRelease() {
    const doc = getCalebeDoc();
    const input = doc.getElementById('cliNome');
    if (!input || input.dataset[`${NS}ReleaseWired`]) return;
    input.dataset[`${NS}ReleaseWired`] = '1';

    input.addEventListener('mousedown', event => {
      if (event.button !== 0) return;
      const cliId = doc.getElementById('cliId');
      if (!String(cliId?.value || '').trim()) return;

      const overlay = doc.getElementById('calebe-cliente-overlay');
      if (overlay) {
        overlay.dataset.temCliente = '0';
        overlay.style.display = 'none';
        overlay.innerHTML = '';
      }
      // ⬛ Só limpa o #cliNome (para nova pesquisa). NÃO zera o #cliId.
      setNativeValue(input, '');
    });
  }

  // ⬛ Bloco: observa #cliId para renderizar overlay quando o cliente é confirmado
  function installClientSelectionWatcher() {
    const doc = getCalebeDoc();
    const input = doc.getElementById('cliNome');
    const cliId = doc.getElementById('cliId');
    if (!input || !cliId || input.dataset[`${NS}WatchWired`]) return;
    input.dataset[`${NS}WatchWired`] = '1';

    let lastId = String(cliId.value || '');
    const handleIdChange = () => {
      const current = String(cliId.value || '');
      if (current === lastId) return;
      lastId = current;
      if (!current) { clearClientOverlay(); return; }
      (async () => {
        try {
          const row = await fetchClientByCode(current);
          if (!row) return;
          if (String(cliId.value || '').trim() !== current) return;
          const nameInput = doc.getElementById('cliNome');
          if (nameInput && String(nameInput.value || '').trim() === current) {
            setInputValueSilently(nameInput, row.ClienteRazaoSocial || '');
          }
          renderClientOverlay(row);
        } catch (_) { /* silencioso */ }
      })();
    };
    const mo = new doc.defaultView.MutationObserver(handleIdChange);
    mo.observe(cliId, { attributes: true, attributeFilter: ['value'] });
    cliId.addEventListener('input', handleIdChange);
  }

  // ⬛ Bloco: nome em maiúsculo ao sair do campo (sem quebrar a busca)
  function installUppercaseOnBlur() {
    const doc = getCalebeDoc();
    const input = doc.getElementById('cliNome');
    if (!input || input.dataset[`${NS}UpperWired`]) return;
    input.dataset[`${NS}UpperWired`] = '1';

    input.addEventListener('blur', () => {
      const val = String(input.value || '');
      if (!val) return;
      const upper = val.toUpperCase();
      if (upper !== val) {
        const win = input.ownerDocument.defaultView;
        const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')?.set;
        setter ? setter.call(input, upper) : (input.value = upper);
        input.dispatchEvent(new win.Event('change', { bubbles: true }));
      }
    });
  }

  // ⬛ Bloco: instala tudo
  function installAll() {
    const doc = getCalebeDoc();
    if (!doc?.documentElement) return;
    if (!doc.getElementById('cliNome')) return;
    installClientOverlay();
    installConsumerPlaceholder();
    installClientSearchRelease();
    installAcItemNameFix();
    installAcObserver();
    installEnterByCodeHandler();
    installClientSelectionWatcher();
    installUppercaseOnBlur();
  }

  function waitForCliNomeThenInstall() {
    const doc = getCalebeDoc();
    if (doc.getElementById('cliNome')) { installAll(); return; }
    const obs = new MutationObserver(() => {
      if (doc.getElementById('cliNome')) { obs.disconnect(); installAll(); }
    });
    obs.observe(doc.documentElement, { childList: true, subtree: true });
    setTimeout(() => obs.disconnect(), 30000);
  }

  // ⬛ Bloco: API pública (opcional)
  window.novoDavCliente = {
    selectClientByCode,
    renderClientOverlay,
    clearClientOverlay,
    fetchClientSearch,
    fetchClientByCode
  };

  // ⬛ Bloco: inicialização
  const init = () => {
    waitForCliNomeThenInstall();
    const frame = document.getElementById('mainIframe');
    if (frame && !frame.dataset[`${NS}Wired`]) {
      frame.dataset[`${NS}Wired`] = '1';
      frame.addEventListener('load', () => setTimeout(waitForCliNomeThenInstall, 150));
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
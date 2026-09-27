/* Calebe Helper — Novo DAV, teste 01.
 * Carregar como content script no menu.php, junto dos demais scripts.
 * Não precisa de page-bridge nem de dependências adicionais.
 * Enter ou mudança de foco confirma Valor Final (total DO ITEM).
 */
(() => {
  'use strict';
  if (window.__calebeNovoDavV1) return;
  window.__calebeNovoDavV1 = true;

  // Controles integrados à barra superior do DAV.
  const CONFIG = { barraStatus: true };
  const KEY = 'calebeNovoDavCoefficientsV1';
  const BASE_KEY = 'calebeHelperStateV3';
  const values = { coefficient21: '2000', coefficient22: '2000' };
  const controllers = new Map();
  const boundFrames = new WeakSet();
  let stopped = false;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function number(value) {
    let text = String(value ?? '').trim().replace(/R\$|\s/g, '');
    if (text.includes(',')) text = text.replace(/\./g, '').replace(',', '.');
    return text && /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : NaN;
  }
  function nativeValue(element, value) {
    const win = element.ownerDocument.defaultView;
    const proto = element.tagName === 'SELECT' ? win.HTMLSelectElement.prototype : win.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(element, String(value));
    else element.value = String(value);
    element.dispatchEvent(new win.Event('input', { bubbles: true }));
    element.dispatchEvent(new win.Event('change', { bubbles: true }));
  }
  function numericValue(element, value, decimals) {
    const text = Number(value).toFixed(decimals);
    nativeValue(element, element.type === 'number' ? text : text.replace('.', ','));
  }
  async function load() {
    try {
      if (!globalThis.chrome?.runtime?.id || !chrome.storage?.local) return;
      const saved = await chrome.storage.local.get([KEY, BASE_KEY]);
      for (const code of ['21', '22']) {
        const key = `coefficient${code}`;
        const n = number(saved[KEY]?.[key] ?? saved[BASE_KEY]?.settings?.[key]);
        if (n > 0) values[key] = String(n);
      }
    } catch (_) { /* Extensão recarregada: os valores padrão continuam utilizáveis. */ }
  }
  async function save() {
    try {
      if (globalThis.chrome?.runtime?.id && chrome.storage?.local) {
        await chrome.storage.local.set({ [KEY]: { ...values } });
      }
    } catch (_) { /* Mantém os valores desta sessão se o contexto foi invalidado. */ }
  }

  function install(doc) {
    if (!doc?.body || controllers.has(doc)) return;
    const get = id => doc.getElementById(id);
    if (!get('btnObs') || !get('inlinePrdCodigo') || !get('inlinePrdQtd')) return;
    // Marca no DOM para evitar duplicação se a extensão também usar all_frames.
    if (get('calebe-novodav-style')) return;
    const win = doc.defaultView;
    const style = doc.createElement('style');
    style.id = 'calebe-novodav-style';
    style.textContent = `
      .ch-nd-fields {
        box-sizing: border-box;
        font-family: var(--bs-body-font-family, inherit);
        font-size: .875rem;
        font-weight: 400;
        line-height: 1.5;
        color: var(--bs-body-color, #212529);
      }

      #calebe-novodav-status {
        display: inline-flex;
        align-items: center;
        gap: .55rem;
        flex: 0 0 auto;
        margin-left: auto;
      }

      .ch-nd-control {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: var(--ch-nd-height, 31px);
        margin: 0;
        border: 0px solid var(--ch-nd-border);
        border-radius: var(--bs-border-radius, .375rem);
        overflow: hidden;
        box-sizing: border-box;
        background: var(--ch-nd-bg);
        color: var(--ch-nd-color);
        font: inherit;
      }

      .ch-nd-success {
        --ch-nd-bg: var(--bs-success-bg-subtle, #d1e7dd);
        --ch-nd-color: var(--bs-success-text-emphasis, #0a3622);
        color: var(--accent3);
        fill: var(--accent3);
        stroke: var(--accent3)       
      }

      .ch-nd-primary {
        --ch-nd-bg: var(--bs-primary-bg-subtle, #cfe2ff);
        --ch-nd-color: var(--bs-primary-text-emphasis, #052c65);
        color: var(--accent);
        fill: var(--accent);
        stroke: var(--accent)
      }

      .ch-nd-icon {
        display: block;
        width: 29px;
        height: 23px;
        margin: 0 5px;
        flex: 0 0 auto;
        overflow: visible;
      }

      .ch-nd-icon rect {
        fill: none;
        stroke-width: 4;
      }

      .ch-nd-icon text {
        font-family: inherit;
        font-size: 58px;
        font-weight: 600;
      }

      .ch-nd-control input {
        box-sizing: border-box;
        display: block;
        width: 76px;
        height: calc(100% - 6px);
        min-height: 0;
        margin: 2px 2px 2px 0;
        border: 0px solid var(--ch-nd-border);
        border-radius: var(--bs-border-radius-sm, .25rem);
        padding: 0 .45rem;
        background: var(--ch-nd-bg);
        background: color-mix(in srgb, var(--ch-nd-bg) 100%, white 75%);
        font: inherit;
        font-weight: 500;
        color: inherit;
        line-height: normal;
        outline: 0;
        box-shadow: none;
      }

      #calebe-novodav-status .ch-nd-control.ch-nd-success input,
      #calebe-novodav-status .ch-nd-control.ch-nd-success input:focus {
        color: var(--accent3, #0a3622) !important;
        -webkit-text-fill-color: var(--accent3, #0a3622) !important;
        caret-color: var(--accent3, #0a3622);
      }

      #calebe-novodav-status .ch-nd-control.ch-nd-primary input,
      #calebe-novodav-status .ch-nd-control.ch-nd-primary input:focus {
        color: var(--accent, #052c65) !important;
        -webkit-text-fill-color: var(--accent, #052c65) !important;
        caret-color: var(--accent, #052c65);
      }

      #calebe-novodav-status .ch-nd-multiple {
        display: inline-flex;
        align-items: center;
        gap: .3rem;
        margin: 0;
        font: inherit;
        white-space: nowrap;
      }

      #calebe-novodav-status .ch-nd-multiple input {
        float: none;
        margin: 0;
        width: 1em;
        height: 1em;
        accent-color: var(--accent, #0d6efd);
      }

      .ch-nd-control[data-field-control="total"] input {
        width: 96px;
      }

      .ch-nd-control input::placeholder {
        color: inherit;
        opacity: .65;
      }

      .ch-nd-control:focus-within {
        box-shadow: 0 0 0 var(--bs-focus-ring-width, .25rem) var(--bs-focus-ring-color, rgba(13, 110, 253, .25));
      }

      .ch-nd-fields[data-result="error"] .ch-nd-control[data-field-control="total"] {
        border-color: var(--bs-danger, #dc3545);
        box-shadow: 0 0 0 .15rem rgba(var(--bs-danger-rgb, 220, 53, 69), .25);
      }
    `;
    (doc.head || doc.documentElement).appendChild(style);
    const state = { total: '', serial: 0, busy: false, pending: false, applied: false, signature: '', autoDone: '', autoFingerprint: '', autoSince: 0, multiple: false, multi: null, groups: [], disposed: false };

    function message(text, error = false) {
      for (const group of state.groups) {
        group.title = text;
        group.dataset.result = error ? 'error' : 'ok';
        group.querySelector('[data-field="total"]').setCustomValidity(error ? text : '');
      }
    }
    function sync(except) {
      for (const group of state.groups) for (const input of group.querySelectorAll('input[data-field]')) {
        if (input !== except) input.value = input.dataset.field === 'total' ? state.total : values[input.dataset.field];
      }
    }
    function fields() {
      return { code: get('inlinePrdCodigo'), description: get('inlinePrdDesc'), unit: get('inlinePrdVlUnit'), qty: get('inlinePrdQtd'), liquid: get('inlinePrdVlLiq'), discount: get('inlinePrdVlDesc'), discountType: get('tipoDesconto') };
    }
    function productCode() {
      const raw = String(get('inlinePrdCodigo')?.value || '').trim();
      const match = raw.match(/\d+/);
      return match ? match[0].replace(/^0+(?=\d)/, '') : raw;
    }
    function loaded() {
      const el = get('inlinePrdDesc');
      return Boolean(String(el && ('value' in el ? el.value : el.textContent) || '').trim());
    }
    async function apply(target = null) {
      if (state.disposed) return;
      if (state.busy) { state.pending = true; return; }
      const code = productCode();
      if (!['21', '22'].includes(code)) return message('O cálculo está disponível somente para os produtos 21 e 22.', true);
      const total = target === null ? number(state.total) : target;
      const coefficient = number(values[`coefficient${code}`]);
      if (!(total > 0) || !(coefficient > 0)) return message('Informe Valor Final e coeficiente maiores que zero.', true);
      if (Math.abs(total * 100 - Math.round(total * 100)) > 1e-6) return message('Use no máximo duas casas decimais no Valor Final.', true);
      if (!loaded()) return message('Aguarde o produto carregar e confirme novamente o Valor Final.', true);
      const f = fields();
      // Unitário e quantidade são os campos essenciais. Os campos de desconto/líquido
      // são tratados depois, para que um ID complementar ausente não bloqueie tudo.
      if (!f.code || !f.unit || !f.qty) {
        console.warn('[novodav] Campos essenciais não encontrados.', f);
        return message('Não foi possível localizar Código, VL UNIT. ou QTD do DAV.', true);
      }
      if ([f.unit, f.qty].some(el => el.disabled)) return message('VL UNIT. ou QTD não estão habilitados para edição.', true);

      const raw = total / coefficient;
      const extraDecimals = Math.abs(raw * 1000 - Math.round(raw * 1000)) > 1e-9;
      const qty = extraDecimals ? Math.ceil(raw * 1000) / 1000 : raw;
      const discount = Math.max(0, qty * coefficient - total);
      const token = ++state.serial;
      const valid = () => !state.disposed && token === state.serial && f.code.isConnected && productCode() === code;
      state.autoDone = code;
      state.busy = true;
      try {
        // Sempre aplica primeiro o coeficiente como VL UNIT. e a quantidade calculada.
        numericValue(f.unit, coefficient, 3);
        await sleep(100);
        if (!valid()) return;
        numericValue(f.qty, qty, 3);
        await sleep(100);
        if (!valid()) return;

        // Se o total fechar sem desconto, já concluímos.
        if (f.liquid && Math.abs(number(f.liquid.value) - total) <= 0.010001) {
          state.applied = true;
          message(`Produto ${code}: coeficiente ${coefficient}, quantidade ${qty.toFixed(3)}. Valor final conferido.`);
          return;
        }

        // Para arredondamentos de quantidade, aplica a diferença como desconto.
        if (!f.discount || !f.discountType) {
          console.warn('[novodav] Coeficiente e quantidade aplicados, mas campos de desconto não foram encontrados.', f);
          state.applied = true;
          return message(`Produto ${code}: coeficiente e quantidade aplicados. Campo de desconto não localizado; confira o Valor Final.`, true);
        }
        if ([f.discount, f.discountType].some(el => el.disabled)) {
          state.applied = true;
          return message('Coeficiente e quantidade aplicados, mas o desconto está bloqueado para edição.', true);
        }

        nativeValue(f.discountType, '1');
        await sleep(80);
        if (!valid()) return;
        numericValue(f.discount, discount, 2);

        if (!f.liquid) {
          console.warn('[novodav] Campo de valor líquido não encontrado.', f);
          state.applied = true;
          return message(`Produto ${code}: coeficiente, quantidade e desconto aplicados. Confira o Valor Final no SATGO.`);
        }

        const until = Date.now() + 2000;
        while (valid() && Date.now() < until) {
          if (Math.abs(number(f.liquid.value) - total) <= 0.010001) {
            state.applied = true;
            message(`Produto ${code}: quantidade ${qty.toFixed(3)}, desconto ${discount.toFixed(2)}. Valor final conferido.`);
            return;
          }
          await sleep(100);
        }
        if (valid()) message('Confira o item: o valor líquido calculado pelo SATGO não atingiu o Valor Final informado.', true);
      } finally {
        state.busy = false;
        if (state.pending) { state.pending = false; confirmValue(); }
      }
    }

    function iconSvg(text) {
      const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 100 100');
      svg.setAttribute('aria-hidden', 'true');
      svg.classList.add('ch-nd-icon');
      const border = doc.createElementNS('http://www.w3.org/2000/svg', 'rect');
      for (const [name, value] of Object.entries({ x: 4, y: 4, width: 86, height: 86, rx: 16, ry: 16 })) {
        border.setAttribute(name, String(value));
      }
      svg.appendChild(border);
      const label = doc.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', '47%');
      label.setAttribute('y', '43%');
      label.setAttribute('dominant-baseline', 'central');
      label.setAttribute('text-anchor', 'middle');
      label.textContent = text;
      svg.appendChild(label);
      return svg;
    }

    function confirmValue() {
      if (state.multiple) {
        if (state.multi) { state.multi.paused = false; state.multi.fillKey = ''; }
        else startMultiple();
        return;
      }
      if (!['21', '22'].includes(productCode()) || !loaded()) {
        message('Valor Final guardado. O cálculo será aplicado quando o produto 21 ou 22 carregar.');
        return;
      }
      apply().catch(error => message(`Não foi possível calcular o item: ${error.message}`, true));
    }

    // Ativo somente após marcar Multiplo. Reutiliza o tick existente, sem
    // MutationObserver, intervalo extra ou reescrita contínua dos campos.
    function committedTotal() {
      const el = get('totNF');
      return el ? number('value' in el ? el.value : el.textContent) : NaN;
    }
    function startMultiple() {
      const baseline = committedTotal();
      if (!Number.isFinite(baseline)) {
        message('Multiplo: total do DAV (#totNF) indisponível. Confirme o Valor Final após o formulário carregar.', true);
        return;
      }
      state.multi = { baseline, accumulated: 0, first: '', lastItemCode: '', phase: 'first',
        switching: false, paused: false, done: false, unitKey: '', fillKey: '',
        fingerprint: '', since: Date.now() };
      message('Múltiplo: lance primeiro os outros produtos; depois use 21 e 22 para completar o saldo do Valor Final.');
    }
    function selectOther(session, code) {
      const input = get('inlinePrdCodigo');
      if (!input || input.disabled) return;
      session.switching = true;
      try {
        input.focus();
        nativeValue(input, code);
        for (const type of ['keydown', 'keyup']) input.dispatchEvent(new win.KeyboardEvent(type, {
          key: 'Tab', code: 'Tab', keyCode: 9, which: 9, bubbles: true, cancelable: true
        }));
        input.blur();
        session.fingerprint = '';
        session.since = Date.now();
      } finally { session.switching = false; }
    }
    function tickMultiple() {
      const m = state.multi;
      if (!m || m.paused || m.done || m.switching || state.busy) return;
      const target = number(state.total);
      if (!(target > 0) || Math.abs(target * 100 - Math.round(target * 100)) > 1e-6) return;
      const committed = committedTotal();
      if (!Number.isFinite(committed)) return;
      const accumulated = Math.round((committed - m.baseline) * 100) / 100;
      if (accumulated < m.accumulated - .01) {
        m.paused = true;
        message('Multiplo pausado: itens removidos ou DAV alterado. Desmarque e marque para iniciar outro conjunto.', true);
        return;
      }
      const added = accumulated > m.accumulated + .009;
      m.accumulated = accumulated;
      const remaining = Math.round((target - accumulated) * 100) / 100;
      if (remaining < -.01) {
        m.paused = true;
        message('O total adicionado ultrapassou o Valor Final. Confira os itens.', true);
        return;
      }
      if (remaining <= .009) {
        m.done = true;
        message(`Multiplo concluído: ${target.toFixed(2)}. Valor Final mantido.`);
        return;
      }
      const code = productCode();
      if (added) {
        const addedCode = m.lastItemCode;
        m.lastItemCode = '';
        m.fillKey = '';
        m.unitKey = '';
        if (['21', '22'].includes(addedCode)) {
          m.first = addedCode;
          m.phase = 'remaining';
          const next = addedCode === '22' ? '21' : '22';
          if (code !== next) { selectOther(m, next); return; }
        } else {
          message(`Outros itens contabilizados. Saldo para completar: ${remaining.toFixed(2)}.`);
        }
      }
      const current = fields();
      if (code && loaded() && number(current.qty?.value) > 0 && number(current.liquid?.value) > 0) {
        m.lastItemCode = code;
      }
      if (!['21', '22'].includes(code) || !loaded()) {
        m.fingerprint = '';
        m.since = Date.now();
        return;
      }
      const f = fields();
      if (!f.unit || !f.qty || f.unit.disabled || f.qty.disabled) return;
      const description = f.description && ('value' in f.description ? f.description.value : f.description.textContent);
      const fingerprint = `${code}|${description}`;
      if (m.fingerprint !== fingerprint) { m.fingerprint = fingerprint; m.since = Date.now(); return; }
      if (Date.now() - m.since < 700) return;
      const coefficient = number(values[`coefficient${code}`]);
      if (!(coefficient > 0)) return;
      if (!m.first) m.first = code;
      const unitKey = `${code}|${coefficient}`;
      if (m.unitKey !== unitKey) {
        m.unitKey = unitKey;
        numericValue(f.unit, coefficient, 3);
        return;
      }
      const liquid = number(f.liquid?.value);
      const fillKey = `${code}|${remaining}|${coefficient}`;
      const completeRemainder = m.phase === 'remaining' && code !== m.first;
      const exceeds = Number.isFinite(liquid) && liquid > remaining + .01;
      if ((completeRemainder || exceeds) && m.fillKey !== fillKey) {
        m.fillKey = fillKey;
        apply(remaining).catch(error => {
          if (state.multi !== m || state.disposed) return;
          m.paused = true;
          message(`Multiplo pausado: ${error.message}`, true);
        });
      }
    }

    function group(id) {
      const element = doc.createElement('div');
      element.id = id;
      element.className = 'ch-nd-fields';
      element.setAttribute('role', 'group');
      element.setAttribute('aria-label', 'Cálculo do valor final do produto');

      const definitions = [
        ['coefficient21', '21', 'success', 'Coeficiente do produto 21'],
        ['coefficient22', '22', 'success', 'Coeficiente do produto 22'],
        ['total', 'R$', 'primary', 'Valor final do item']
      ];

      for (const [key, iconText, color, accessibleLabel] of definitions) {
        if (key === 'total') {
          const multipleLabel = doc.createElement('label');
          multipleLabel.className = 'ch-nd-multiple';
          const checkbox = doc.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.className = 'form-check-input';
          checkbox.id = 'calebe-novodav-multiplo';
          checkbox.addEventListener('change', () => {
            ++state.serial;
            state.pending = false;
            state.multiple = checkbox.checked;
            state.multi = null;
            state.autoDone = productCode();
            if (checkbox.checked) {
              startMultiple();
              win.alert('Múltiplo: preencha e adicione primeiro os produtos diferentes de 21 e 22 (outros itens). Depois use os produtos 21 e 22 para completar o valor que faltar no Valor Final.');
            }
            else message('Multiplo desativado. Confirme o Valor Final para calcular um item.');
          });
          multipleLabel.append(checkbox, doc.createTextNode('Múltiplo'));
          element.appendChild(multipleLabel);
        }
        const control = doc.createElement('label');
        control.className = `ch-nd-control ch-nd-${color}`;
        control.dataset.fieldControl = key;
        control.title = accessibleLabel;
        control.setAttribute('aria-label', accessibleLabel);
        control.appendChild(iconSvg(iconText));

        const input = doc.createElement('input');
        input.type = 'text';
        input.inputMode = 'decimal';
        input.autocomplete = 'off';
        input.dataset.field = key;
        input.setAttribute('aria-label', accessibleLabel);
        input.title = key === 'total' ? 'Total desejado para este item. Enter ou Tab para calcular.' : 'Valor unitário utilizado no cálculo.';
        control.appendChild(input);
        element.appendChild(control);

        input.addEventListener('input', () => {
          ++state.serial;
          if (state.multi) state.multi.paused = true;
          if (key === 'total') state.total = input.value;
          else values[key] = input.value;
          for (const c of controllers.values()) c.sync(input);
          message('Confirme com Enter ou Tab.');
        });
        input.addEventListener('change', () => {
          if (key !== 'total' && number(input.value) > 0) save();
          if (state.total.trim()) confirmValue();
        });
        input.addEventListener('keydown', event => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          event.stopPropagation();
          if (key !== 'total' && number(input.value) > 0) save();
          confirmValue();
        });
      }
      state.groups.push(element);
      return element;
    }

    const statusGroup = CONFIG.barraStatus ? group('calebe-novodav-status') : null;

    function place() {
      if (!statusGroup) return;
      const status = doc.querySelector('.status-bar.status-C');
      const row = status?.closest('.d-flex.align-items-center.gap-3');
      if (!status || !row) {
        statusGroup.remove();
        return;
      }
      // Sempre depois do último status-C / último elemento da barra.
      if (statusGroup.parentElement !== row || row.lastElementChild !== statusGroup) row.appendChild(statusGroup);

      // A altura dos controles acompanha a altura real do status-C nativo.
      const h = Math.round(status.getBoundingClientRect().height);
      if (h > 0 && statusGroup.style.getPropertyValue('--ch-nd-height') !== `${h}px`) statusGroup.style.setProperty('--ch-nd-height', `${h}px`);
    }
    function tick() {
      if (state.disposed) return;
      place();
      const code = productCode();
      const signature = `${code}|${loaded()}`;
      if (signature !== state.signature) {
        const oldCode = state.signature.split('|')[0];
        state.signature = signature;
        if (oldCode !== code) {
          // Cancela apenas o cálculo anterior; preserva o Valor Final digitado.
          ++state.serial;
          state.pending = false;
          state.applied = false;
          state.autoDone = '';
          state.autoFingerprint = '';
          state.autoSince = Date.now();
          message('Valor Final mantido. Aguardando o carregamento do produto.');
        }
      }
      if (state.multiple) {
        try { tickMultiple(); }
        catch (error) {
          if (state.multi) state.multi.paused = true;
          message(`Multiplo pausado: ${error.message}`, true);
        }
        return;
      }
      // Uma aplicação por carregamento; não reescreve campos em todo intervalo.
      if (!loaded()) {
        state.autoDone = '';
        state.autoFingerprint = '';
        state.autoSince = Date.now();
      } else if (['21', '22'].includes(code) && state.autoDone !== code && !state.busy) {
        const f = fields();
        const description = f.description && ('value' in f.description ? f.description.value : f.description.textContent);
        const fingerprint = `${code}|${description}|${f.unit?.value}`;
        if (state.autoFingerprint !== fingerprint) {
          state.autoFingerprint = fingerprint;
          state.autoSince = Date.now();
        } else if (Date.now() - state.autoSince >= 700 && f.unit && !f.unit.disabled && f.qty && !f.qty.disabled) {
          const coefficient = number(values[`coefficient${code}`]);
          if (coefficient > 0) {
            // Marca antes de emitir eventos nativos para evitar reaplicação em ciclo.
            state.autoDone = code;
            if (number(state.total) > 0) {
              apply().catch(error => message(`Não foi possível calcular o item: ${error.message}`, true));
            } else {
              numericValue(f.unit, coefficient, 3);
              message('Coeficiente aplicado. Informe o Valor Final para calcular a quantidade.');
            }
          }
        }
      }
      // Adicionar um item pode zerar QTD; isso não deve apagar o Valor Final.
      if (state.applied && !state.busy && !(number(get('inlinePrdQtd')?.value) > 0)) state.applied = false;
    }
    function dispose() {
      state.disposed = true;
      ++state.serial;
      for (const el of state.groups) el.remove();
      style.remove();
      win.removeEventListener('resize', place);
      doc.removeEventListener('scroll', place, true);
      controllers.delete(doc);
    }
    controllers.set(doc, { tick, sync, dispose });
    win.addEventListener('resize', place);
    doc.addEventListener('scroll', place, true);
    sync();
    message('Informe o valor final deste item e pressione Enter ou Tab.');
    tick();
  }

  function scan() {
    if (stopped) return;
    const docs = new Set([document]);
    const frame = document.getElementById('mainIframe');
    if (frame) {
      if (!boundFrames.has(frame)) { boundFrames.add(frame); frame.addEventListener('load', scan); }
      try { if (frame.contentDocument) docs.add(frame.contentDocument); } catch (_) { /* Fora da origem do CALWEB. */ }
    }
    for (const [doc, controller] of controllers) {
      if (!docs.has(doc) || !doc.getElementById('inlinePrdQtd') || !doc.getElementById('btnObs')) controller.dispose();
    }
    for (const doc of docs) install(doc);
    for (const controller of controllers.values()) controller.tick();
  }
  load().then(() => {
    if (stopped) return;
    scan();
    // Também detecta trocas de iframe, renderização tardia e valores alterados pelo SATGO.
    const timer = setInterval(scan, 350);
    window.addEventListener('pagehide', event => {
      if (event.persisted) return;
      stopped = true;
      clearInterval(timer);
      for (const controller of [...controllers.values()]) controller.dispose();
    }, { once: true });
  });
})();

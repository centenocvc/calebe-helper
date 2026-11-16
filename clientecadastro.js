// clientecadastro.js
(() => {
  'use strict';

  const STYLE_ID = 'calebe-helper-cliente-cadastro-style';
  const GROUP_CLASS = 'calebe-helper-cadastro-salvar-dav';
  const FLOW_KEY = 'calebeHelperNewClientDavFlowV1';
  const FLOW_MAX_AGE_MS = 2 * 60 * 1000;
  const LOG = '[Calebe Cadastro]';

  let observedFrame = null;
  let observedFrameDocument = null;
  let frameObserver = null;
  let flowTimer = null;
  let busy = false;

  function getStorage() {
    try { return window.top.sessionStorage; }
    catch (_) { return window.sessionStorage; }
  }

  function readFlow() {
    try { return JSON.parse(getStorage().getItem(FLOW_KEY) || 'null'); }
    catch (_) { return null; }
  }

  function readActiveFlow() {
    const flow = readFlow();
    if (!flow) return null;

    const createdAt = Number(flow.createdAt) || 0;
    if (!createdAt || Date.now() - createdAt > FLOW_MAX_AGE_MS) {
//       console.warn(LOG, 'Fluxo de salvamento antigo descartado.');
      clearFlow();
      const doc = getFrameDocument();
      if (doc?.documentElement) setBusy(doc, false);
      return null;
    }

    return flow;
  }

  function writeFlow(flow) {
    getStorage().setItem(FLOW_KEY, JSON.stringify(flow));
    return flow;
  }

  function clearFlow() {
    try { getStorage().removeItem(FLOW_KEY); } catch (_) {}
    if (flowTimer) {
      clearTimeout(flowTimer);
      flowTimer = null;
    }
    busy = false;
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

      const currentFlow = readFlow();
      if (!currentFlow) return;

      if (readActiveFlow()) {
        scheduleFlowExpiry();
        return;
      }

      const doc = getFrameDocument();
      if (doc?.documentElement) setBusy(doc, false);

//       console.warn(LOG, 'Salvamento não confirmado a tempo. Botão + DAV reabilitado.');
    }, delay);
  }

  function getMainFrame() {
    return document.getElementById('mainIframe');
  }

  function getFrameDocument() {
    const frame = getMainFrame();
    try { return frame?.contentDocument || null; }
    catch (_) { return null; }
  }

  function getCurrentClientId(doc) {
    return String(
      doc?.getElementById('formClifor')
        ?.querySelector('input[name="id"]')
        ?.value || ''
    ).trim();
  }

  function isNewClientForm(doc) {
    const form = doc?.getElementById('formClifor');
    if (!form) return false;

    const id = getCurrentClientId(doc);

    // No SATGO, cadastro novo usa id="0".
    // Apenas IDs positivos representam clientes já cadastrados.
    if (isSavedClientId(id)) return false;
    if (id === '0') return true;

    let action = '';

    try {
      action = String(
        new URL(doc.location.href).searchParams.get('acao') || ''
      ).toLowerCase();
    } catch (_) {}

    return action === 'novo' || !id;
  }

  function isSavedClientId(value) {
    return /^\d+$/.test(String(value || '')) && Number(value) > 0;
  }

  function normalizeLookupText(value) {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
  }

  function captureClientIdentity(doc) {
    const form = doc?.getElementById('formClifor');
    if (!form) return null;

    const read = name => String(
      form.querySelector(`[name="${name}"]`)?.value ?? ''
    ).trim();

    const documentRaw = read('ClienteCGC');
    const nameRaw = read('ClienteRazaoSocial');

    return {
      document: documentRaw.replace(/\D/g, ''),
      documentRaw,
      name: normalizeLookupText(nameRaw),
      nameRaw,
      cep: normalizeLookupText(read('ClienteCep')),
      street: normalizeLookupText(read('ClienteLogradouro')),
      number: normalizeLookupText(read('ClienteNumero')),
      complement: normalizeLookupText(read('ClienteComplemento')),
      district: normalizeLookupText(read('ClienteBairro')),
      city: normalizeLookupText(read('ClienteMunicipio')),
      state: normalizeLookupText(read('ClienteUf')),
      chave: read('chave')
    };
  }

  function isClientListingPage(doc) {
    try {
      return /\/clca01\.php$/i.test(new URL(doc.location.href).pathname);
    } catch (_) {
      return false;
    }
  }

  function isClientListing(doc) {
    if (!doc?.documentElement) return false;
    if (isClientListingPage(doc)) return true;

    return Boolean(
      doc.getElementById('formFiltro') &&
      doc.querySelector('input[name="q"]')
    );
  }

  function getListingChave(doc, flow) {
    try {
      const chave = new URL(doc.location.href).searchParams.get('chave');
      if (chave) return chave;
    } catch (_) {}

    return String(
      doc.querySelector('input[name="chave"]')?.value ||
      flow?.identity?.chave ||
      ''
    ).trim();
  }

  function clientIdentityMatches(row, identity) {
    const document = String(row.ClienteCGC || '').replace(/\D/g, '');

    if (document && identity.document) {
      return document === identity.document;
    }

    if (identity.name) {
      return normalizeLookupText(row.ClienteRazaoSocial) === identity.name;
    }

    return false;
  }

  const ADDRESS_FIELDS = [
    ['cep', 'ClienteCep'],
    ['street', 'ClienteLogradouro'],
    ['number', 'ClienteNumero'],
    ['complement', 'ClienteComplemento'],
    ['district', 'ClienteBairro'],
    ['city', 'ClienteMunicipio'],
    ['state', 'ClienteUf']
  ];

  function clientAddressScore(row, identity) {
    return ADDRESS_FIELDS.reduce((score, [key, rowKey]) => {
      if (!identity[key]) return score;
      return score + (
        normalizeLookupText(row[rowKey]) === identity[key] ? 1 : 0
      );
    }, 0);
  }

  async function fetchClientListJson(doc, chave, field, term, page = 1) {
    const url = new URL('clca01.php', doc.location.href);
    url.searchParams.set('fmt', 'json');
    url.searchParams.set('p', String(page));
    url.searchParams.set('campo', field);
    url.searchParams.set('q', term);
    if (chave) url.searchParams.set('chave', chave);

    let lastError = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await (doc.defaultView || window).fetch(url.href, {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (!Array.isArray(data.rows)) throw new Error('Resposta JSON inválida.');
        return data;
      } catch (error) {
        lastError = error;
        await new Promise(resolve => setTimeout(resolve, attempt * 300));
      }
    }

    throw lastError;
  }

  async function fetchClientListRows(doc, chave, field, term) {
    const first = await fetchClientListJson(doc, chave, field, term, 1);
    const rows = [...first.rows];
    const pageSize = first.rows.length;

    if (!pageSize) return { rows, total: Number(first.total) || 0 };

    const total = Number(first.total) || pageSize;
    const lastPage = Math.ceil(total / pageSize);
    const pages = new Set();

    for (let page = 2; page <= Math.min(lastPage, 5); page++) pages.add(page);
    if (lastPage > 5) pages.add(lastPage);

    for (const page of pages) {
      try {
        const data = await fetchClientListJson(doc, chave, field, term, page);
        rows.push(...data.rows);
      } catch (error) {
//         console.warn(LOG, `Falha ao consultar a página ${page} da listagem.`, error);
        break;
      }
    }

    const seenCodes = new Set();
    return {
      total,
      rows: rows.filter(row => {
        const code = String(row.ClienteCodigo || '').trim();
        if (!code) return true;
        if (seenCodes.has(code)) return false;
        seenCodes.add(code);
        return true;
      })
    };
  }

  async function resolveNewClientFromListing(doc, flow) {
    const identity = flow?.identity || {};
    const chave = getListingChave(doc, flow);
    const queries = [];
    const seen = new Set();
    const matches = [];

    if (identity.documentRaw) queries.push(['ClienteCGC', identity.documentRaw]);
    if (identity.document && identity.document !== identity.documentRaw) {
      queries.push(['ClienteCGC', identity.document]);
    }
    if (identity.nameRaw) queries.push(['ClienteRazaoSocial', identity.nameRaw]);
    if (identity.name && identity.name !== identity.nameRaw) {
      queries.push(['ClienteRazaoSocial', identity.name]);
    }

    for (const [field, term] of queries) {
      const key = `${field}:${term}`;
      if (seen.has(key)) continue;
      seen.add(key);

      let result = { rows: [], total: 0 };
      try {
        result = await fetchClientListRows(doc, chave, field, term);
//         console.info(LOG, `Listagem por ${field} retornou ${result.rows.length} de ${result.total} linha(s).`);
      } catch (error) {
//         console.warn(LOG, `Falha ao consultar a listagem por ${field}.`, error);
        continue;
      }

      for (const row of result.rows) {
        if (!clientIdentityMatches(row, identity)) continue;
        const code = String(row.ClienteCodigo || '').trim();
        if (!isSavedClientId(code)) continue;
        matches.push({
          code,
          score: clientAddressScore(row, identity)
        });
      }

      if (matches.length) break;
    }

    if (!matches.length) return '';

    matches.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return Number(b.code) - Number(a.code);
    });

    return matches[0].code;
  }

  function installStyle(doc) {
    if (!doc?.documentElement || doc.getElementById(STYLE_ID)) return;

    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${GROUP_CLASS} {
        display: inline-flex;
        align-items: stretch;
        height: 38px;
        overflow: hidden;
        border-radius: var(--bs-border-radius, 0.375rem);
        vertical-align: middle;
      }

      .${GROUP_CLASS} > .calebe-cadastro-salvar {
        border-top-right-radius: 0 !important;
        border-bottom-right-radius: 0 !important;
        margin: 0 !important;
        height: 100%;
      }

      .${GROUP_CLASS} > .calebe-cadastro-dav {
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
        border-left: 1px solid rgba(255,255,255,0.25);
        border-top-right-radius: var(--bs-border-radius, 0.375rem);
        border-bottom-right-radius: var(--bs-border-radius, 0.375rem);

        white-space: nowrap;
        font-size: 11px;
        font-weight: 600;
        line-height: 1;
        cursor: pointer;

        transition:
          background-color 0.15s ease,
          color 0.15s ease;
      }

      .${GROUP_CLASS} > .calebe-cadastro-dav:hover {
        color: #fff;
        background: #157347;
      }

      .${GROUP_CLASS} > .calebe-cadastro-dav i {
        color: inherit;
        font-size: 13px;
        line-height: 1;
      }

      .${GROUP_CLASS} > button:focus {
        position: relative;
        z-index: 3;
      }

      .${GROUP_CLASS}.calebe-flow-busy {
        opacity: 0.65;
      }

      .${GROUP_CLASS}.calebe-flow-busy button {
        cursor: wait;
      }
    `;
    (doc.head || doc.documentElement).appendChild(style);
  }

  function setBusy(doc, value) {
    busy = value;
    for (const group of doc?.querySelectorAll(`.${GROUP_CLASS}`) || []) {
      group.classList.toggle('calebe-flow-busy', value);
      const dav = group.querySelector('.calebe-cadastro-dav');
      if (dav) dav.disabled = value;
    }
  }

  function dispatchNativeSave(doc) {
    const form = doc.getElementById('formClifor');
    if (!form) throw new Error('#formClifor não encontrado.');

    /*
     * O botão Salvar original pertence ao SATGO. Acioná-lo de fato é mais
     * fiel do que disparar um submit sintético, pois preserva validações,
     * confirmações e qualquer lógica ligada ao clique nativo.
     */
    const nativeSave = doc.querySelector(
      `.${GROUP_CLASS} > .calebe-cadastro-salvar`
    );

    if (nativeSave && typeof nativeSave.click === 'function') {
      nativeSave.click();
      return;
    }

    const win = doc.defaultView || window;
    form.dispatchEvent(new win.Event('submit', {
      bubbles: true,
      cancelable: true
    }));
  }

  function startSaveAndDav(doc) {
    if (busy || readActiveFlow()) return;

    if (!isNewClientForm(doc)) {
//       console.warn(LOG, 'O botão + DAV deste arquivo é exclusivo do cadastro de cliente novo.');
      return;
    }

    writeFlow({
      version: 1,
      stage: 'saving-new-client',
      createdAt: Date.now(),
      identity: captureClientIdentity(doc)
    });

//     console.info(LOG, 'Salvando novo cliente e preparando a abertura do DAV.');
    setBusy(doc, true);
    scheduleFlowExpiry();

    try {
      dispatchNativeSave(doc);
    } catch (error) {
      clearFlow();
      setBusy(doc, false);
//       console.error(LOG, error);
    }
  }

  function createGroup(doc, nativeSave) {
    const group = doc.createElement('div');
    group.className = GROUP_CLASS;
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Salvar novo cliente ou salvar e criar DAV');

    /*
     * O botão Salvar continua sendo o botão NATIVO do SATGO.
     * Apenas o movemos para dentro do grupo visual.
     */
    nativeSave.classList.add('calebe-cadastro-salvar');

    const dav = doc.createElement('button');
    dav.type = 'button';
    dav.className = 'calebe-cadastro-dav';
    dav.title = 'Salvar cliente e abrir novo DAV';
    dav.setAttribute('aria-label', 'Salvar cliente e abrir novo DAV');
    dav.innerHTML =
      '<i class="bi bi-plus-lg" aria-hidden="true"></i><span>DAV</span>';

    dav.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      startSaveAndDav(doc);
    });

    const parent = nativeSave.parentNode;
    parent.insertBefore(group, nativeSave);
    group.append(nativeSave, dav);

    return group;
  }

  function installButtons(doc) {
    if (!doc?.documentElement || !isNewClientForm(doc)) return;

    const form = doc.getElementById('formClifor');
    if (!form) return;

    /*
     * No cadastro novo o texto pode ser "Salvar" ou "Salvar Alterações",
     * dependendo da versão da tela. Só tratamos botões primários que
     * pertencem ao #formClifor ou acionam explicitamente seu submit.
     */
    const candidates = [...doc.querySelectorAll('button.btn.btn-primary')]
      .filter(button => {
        if (button.closest(`.${GROUP_CLASS}`)) return false;
        if (!button.getClientRects().length) return false;
        const text = String(button.textContent || '').trim();
        if (!/^Salvar(?:\s+Alterações)?$/i.test(text)) return false;

        const onclick = String(button.getAttribute('onclick') || '');
        return form.contains(button) || onclick.includes('formClifor');
      });

    for (const saveButton of candidates) {
      createGroup(doc, saveButton);
    }

    setBusy(doc, Boolean(readActiveFlow()));
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

  async function continueAfterSave(doc) {
    const flow = readActiveFlow();
    if (!flow || flow.stage !== 'saving-new-client') return;

    if (!isClientListing(doc) && hasVisibleSaveError(doc)) {
      clearFlow();
      setBusy(doc, false);
//       console.error(LOG, 'O SATGO exibiu erro ao salvar o novo cliente. O DAV não será aberto.');
      return;
    }

    let clientId = getCurrentClientId(doc);

    if (!isSavedClientId(clientId)) {
      if (!isClientListing(doc)) {
//         console.info(
//           LOG,
//           `Salvamento aguardando confirmação do código do cliente (id="${clientId || 'vazio'}").`
//         );
        return;
      }

      const resolvingFlow = readActiveFlow();
      if (!resolvingFlow) return;

      writeFlow({ ...resolvingFlow, stage: 'resolving-new-client' });
//       console.info(LOG, 'Salvamento concluído na listagem; localizando o novo cliente.');

      try {
        clientId = await resolveNewClientFromListing(doc, resolvingFlow);
      } catch (error) {
//         console.error(LOG, 'Falha ao localizar o novo cliente na listagem.', error);
        clientId = '';
      }

      if (!readActiveFlow()) return;

      if (!isSavedClientId(clientId)) {
        clearFlow();
        setBusy(doc, false);
//         console.warn(
//           LOG,
//           'Cliente salvo, mas o código não foi localizado na listagem. O DAV não foi aberto.'
//         );
        return;
      }

//       console.info(LOG, `Novo cliente ${clientId} localizado na listagem.`);
    }

    const api = window.calebeHelperClientDav;
    if (!api?.createDavForClient) {
      clearFlow();
      setBusy(doc, false);
//       console.error(LOG, 'clientedav.js não disponibilizou createDavForClient().');
      return;
    }

    writeFlow({
      ...flow,
      stage: 'opening-dav',
      clientId,
      createdAt: Date.now()
    });

    try {
      await api.createDavForClient({
        code: clientId,
        name: ''
      });
      clearFlow();
//       console.info(LOG, `Novo cliente ${clientId} salvo e DAV aberto.`);
    } catch (error) {
      clearFlow();
//       console.error(LOG, 'Cliente salvo, mas não foi possível abrir o DAV.', error);
    }
  }

  function handleCurrentFrame({ fromLoad = false } = {}) {
    const doc = getFrameDocument();
    if (!doc?.documentElement) return;

    installStyle(doc);
    installButtons(doc);

    const flow = readActiveFlow();
    if (!flow) return;

    scheduleFlowExpiry();

    if (flow.stage === 'saving-new-client' && fromLoad) {
      continueAfterSave(doc).catch(error => {
        clearFlow();
        setBusy(doc, false);
//         console.error(LOG, error);
      });
    }
  }

  function observeFrameDocument(doc) {
    if (!doc?.documentElement) return;

    frameObserver?.disconnect();
    observedFrameDocument = doc;

    frameObserver = new MutationObserver(() => {
      installStyle(doc);
      installButtons(doc);

      /*
       * Normalmente o SATGO recarrega o iframe após salvar. Este fallback
       * cobre o caso de o código do cliente aparecer na própria página,
       * sem nova navegação (ex.: salvamento via AJAX).
       */
      const flow = readActiveFlow();
      if (flow?.stage === 'saving-new-client') {
        const id = getCurrentClientId(doc);
        if (isSavedClientId(id) || isClientListingPage(doc)) {
          continueAfterSave(doc).catch(error => {
            clearFlow();
            setBusy(doc, false);
//             console.error(LOG, error);
          });
        }
      }
    });

    frameObserver.observe(doc.documentElement, {
      childList: true,
      subtree: true
    });
  }

  function bindCurrentFrame() {
    const frame = getMainFrame();
    if (!frame) return;

    if (frame !== observedFrame) {
      observedFrame = frame;

      frame.addEventListener('load', () => {
        const doc = getFrameDocument();

        if (doc && doc !== observedFrameDocument) {
          observeFrameDocument(doc);
        }

        handleCurrentFrame({ fromLoad: true });
      });
    }

    const doc = getFrameDocument();

    if (doc && doc !== observedFrameDocument) {
      observeFrameDocument(doc);
    }

    handleCurrentFrame({ fromLoad: false });
  }

  bindCurrentFrame();

  new MutationObserver(bindCurrentFrame).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
})();

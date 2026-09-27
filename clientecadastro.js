// clientecadastro.js
(() => {
  'use strict';

  const STYLE_ID = 'calebe-helper-cliente-cadastro-style';
  const GROUP_CLASS = 'calebe-helper-cadastro-salvar-dav';
  const FLOW_KEY = 'calebeHelperNewClientDavFlowV1';
  const LOG = '[Calebe Cadastro]';

  let observedFrame = null;
  let observedFrameDocument = null;
  let frameObserver = null;
  let busy = false;

  function getStorage() {
    try { return window.top.sessionStorage; }
    catch (_) { return window.sessionStorage; }
  }

  function readFlow() {
    try { return JSON.parse(getStorage().getItem(FLOW_KEY) || 'null'); }
    catch (_) { return null; }
  }

  function writeFlow(flow) {
    getStorage().setItem(FLOW_KEY, JSON.stringify(flow));
    return flow;
  }

  function clearFlow() {
    try { getStorage().removeItem(FLOW_KEY); } catch (_) {}
    busy = false;
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
    if (/^\d+$/.test(id) && Number(id) > 0) return false;

    const href = String(doc.location?.href || '');
    const action = String(
      new URL(href, href).searchParams.get('acao') || ''
    ).toLowerCase();

    return action === 'novo' || !id;
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

    const win = doc.defaultView || window;
    form.dispatchEvent(new win.Event('submit', {
      bubbles: true,
      cancelable: true
    }));
  }

  function startSaveAndDav(doc) {
    if (busy || readFlow()) return;

    if (!isNewClientForm(doc)) {
      console.warn(LOG, 'O botão + DAV deste arquivo é exclusivo do cadastro de cliente novo.');
      return;
    }

    writeFlow({
      version: 1,
      stage: 'saving-new-client',
      createdAt: Date.now()
    });

    setBusy(doc, true);

    try {
      dispatchNativeSave(doc);
    } catch (error) {
      clearFlow();
      setBusy(doc, false);
      console.error(LOG, error);
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
        const text = String(button.textContent || '').trim();
        if (!/^Salvar(?:\s+Alterações)?$/i.test(text)) return false;

        const onclick = String(button.getAttribute('onclick') || '');
        return form.contains(button) || onclick.includes('formClifor');
      });

    for (const saveButton of candidates) {
      createGroup(doc, saveButton);
    }

    setBusy(doc, Boolean(readFlow()));
  }

  function hasVisibleSaveError(doc) {
    return Boolean(doc.querySelector(
      '.alert-danger, .alert-error, .alert.alert-danger, .text-danger.alert'
    ));
  }

  async function continueAfterSave(doc) {
    const flow = readFlow();
    if (!flow || flow.stage !== 'saving-new-client') return;

    if (hasVisibleSaveError(doc)) {
      clearFlow();
      setBusy(doc, false);
      console.error(LOG, 'O SATGO exibiu erro ao salvar o novo cliente. O DAV não será aberto.');
      return;
    }

    const clientId = getCurrentClientId(doc);

    /*
     * Depois do salvamento o SATGO precisa nos fornecer o código real
     * do cliente. Não tentamos adivinhar código sequencial.
     */
    if (!/^\d+$/.test(clientId)) {
      /*
       * Se o servidor voltou para uma página que ainda não expõe o ID,
       * mantemos o fluxo pendente. Uma futura alteração/load pode trazer
       * o formulário de edição com o código confirmado.
       */
      return;
    }

    const api = window.calebeHelperClientDav;
    if (!api?.createDavForClient) {
      clearFlow();
      setBusy(doc, false);
      console.error(LOG, 'clientedav.js não disponibilizou createDavForClient().');
      return;
    }

    writeFlow({
      ...flow,
      stage: 'opening-dav',
      clientId
    });

    try {
      await api.createDavForClient({
        code: clientId,
        name: ''
      });
      clearFlow();
      console.info(LOG, `Novo cliente ${clientId} salvo e DAV aberto.`);
    } catch (error) {
      clearFlow();
      console.error(LOG, 'Cliente salvo, mas não foi possível abrir o DAV.', error);
    }
  }

  function handleCurrentFrame({ fromLoad = false } = {}) {
    const doc = getFrameDocument();
    if (!doc?.documentElement) return;

    installStyle(doc);
    installButtons(doc);

    const flow = readFlow();
    if (!flow) return;

    if (flow.stage === 'saving-new-client' && fromLoad) {
      continueAfterSave(doc).catch(error => {
        clearFlow();
        setBusy(doc, false);
        console.error(LOG, error);
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
       * Mutation não é usada como confirmação do salvamento.
       * O avanço para o DAV acontece somente após novo load do iframe.
       */
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

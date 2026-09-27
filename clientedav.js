(() => {
  'use strict';

  const BUTTON_CLASS = 'calebe-helper-novo-dav-cliente';
  const PENDING_KEY = 'calebeHelperPendingDavClientV1';
  const RETRY_INTERVAL_MS = 150;
  const PENDING_TIMEOUT_MS = 30000;

  let pendingClient = readPendingClient();
  let retryTimer = null;
  let observedFrame = null;
  let observedFrameDocument = null;
  let frameObserver = null;
  let lastLookupDocument = null;
  let lastLookupCode = '';
  let lastLookupAt = 0;
  let davNavigationStarted = false;
  let newDavClickStarted = false;
  let newDavCandidate = null;
  let newDavCandidateSince = 0;
  let closingClientDocument = null;
  let closingClientCode = '';
  let closingClientPromise = null;
  let activeOpenDavPromise = null;

  async function waitFor(test, { timeout = 12000, interval = 100, message = 'Tempo esgotado.' } = {}) {
    const startedAt = Date.now();
    let lastError;
    while (Date.now() - startedAt < timeout) {
      try {
        const result = test();
        if (result) return result;
      } catch (error) {
        lastError = error;
      }
      await new Promise(resolve => window.setTimeout(resolve, interval));
    }
    throw lastError || new Error(message);
  }

  function getStorage() {
    try {
      return window.top.sessionStorage;
    } catch {
      return window.sessionStorage;
    }
  }

  function normalizeClient(raw) {
    const code = String(raw?.code || '').trim();
    const name = String(raw?.name || '').replace(/\s+/g, ' ').trim();
    const createdAt = Number(raw?.createdAt) || Date.now();

    if (!/^\d+$/.test(code)) return null;
    if (Date.now() - createdAt > PENDING_TIMEOUT_MS) return null;

    return { code, name, createdAt };
  }

  function readPendingClient() {
    try {
      return normalizeClient(JSON.parse(getStorage().getItem(PENDING_KEY) || 'null'));
    } catch {
      return null;
    }
  }

  function savePendingClient(client) {
    pendingClient = normalizeClient({ ...client, createdAt: Date.now() });
    if (!pendingClient) return false;

    davNavigationStarted = false;
    newDavClickStarted = false;
    newDavCandidate = null;
    newDavCandidateSince = 0;

    try {
      getStorage().setItem(PENDING_KEY, JSON.stringify(pendingClient));
    } catch (error) {
      console.warn('[Calebe Helper] Não foi possível persistir o cliente do novo DAV.', error);
    }

    return true;
  }

  function clearPendingClient() {
    pendingClient = null;
    lastLookupDocument = null;
    lastLookupCode = '';
    lastLookupAt = 0;
    davNavigationStarted = false;
    newDavClickStarted = false;
    newDavCandidate = null;
    newDavCandidateSince = 0;
    try {
      getStorage().removeItem(PENDING_KEY);
    } catch {
      // A memória desta execução ainda é suficiente para encerrar o fluxo.
    }
    stopRetrying();
  }

  function getHostDocument() {
    try {
      return window.top.document;
    } catch {
      return document;
    }
  }

  function getMainFrame() {
    return getHostDocument().getElementById('mainIframe');
  }

  function getCalebeDocument() {
    const frame = getMainFrame();
    try {
      return frame?.contentDocument || document;
    } catch {
      return document;
    }
  }

  function getDocumentWindow(doc) {
    return doc?.defaultView || window;
  }

  function parseDeleteButton(button) {
    const onclick = button.getAttribute('onclick') || '';
    const match = onclick.match(
      /confirmarExclusao\s*\(\s*(\d+)\s*,\s*(['"])((?:\\.|(?!\2).)*)\2\s*\)/i
    );

    if (!match) return null;

    const quote = match[2];
    const escapedName = match[3];
    const name = escapedName
      .replace(new RegExp(`\\\\${quote}`, 'g'), quote)
      .replace(/\\\\/g, '\\');

    return normalizeClient({ code: match[1], name, createdAt: Date.now() });
  }

  function createClientDavButton(doc, client) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = `btn btn-sm btn-success ${BUTTON_CLASS}`;
    button.title = `Criar novo DAV para ${client.name || `cliente ${client.code}`}`;
    button.setAttribute('aria-label', button.title);
    button.dataset.clientCode = client.code;
    button.dataset.clientName = client.name;
    button.innerHTML = '<i class="bi bi-file-earmark-text" aria-hidden="true"></i>';

    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();

      const selectedClient = {
        code: button.dataset.clientCode,
        name: button.dataset.clientName
      };

      createDavForClient(selectedClient).catch(error => {
        console.error('[Calebe Helper] Falha ao criar o DAV para o cliente selecionado.', error);
      });
    });

    return button;
  }

  function installButtons(doc) {
    if (!doc?.documentElement) return;

    const pathname = String(doc.location?.pathname || '').toLowerCase();
    if (!pathname.includes('/clca01/')) return;

    const deleteButtons = doc.querySelectorAll(
      'button.btn-danger[onclick*="confirmarExclusao"]'
    );

    for (const deleteButton of deleteButtons) {
      const client = parseDeleteButton(deleteButton);
      if (!client) continue;

      const nextButton = deleteButton.nextElementSibling;
      if (nextButton?.classList.contains(BUTTON_CLASS)) {
        nextButton.dataset.clientCode = client.code;
        nextButton.dataset.clientName = client.name;
        continue;
      }

      deleteButton.insertAdjacentElement(
        'afterend',
        createClientDavButton(doc, client)
      );
    }
  }

  function findNativeNewDavButton() {
    const doc = getCalebeDocument();
    const button = doc?.getElementById('btnNovoDav');
    if (!button || doc.readyState !== 'complete') {
      newDavCandidate = null;
      newDavCandidateSince = 0;
      return null;
    }

    const style = getDocumentWindow(doc).getComputedStyle(button);
    const rect = button.getBoundingClientRect();
    const available = button.isConnected &&
      !button.disabled &&
      button.getAttribute('aria-disabled') !== 'true' &&
      !button.classList.contains('disabled') &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.pointerEvents !== 'none' &&
      rect.width > 0 &&
      rect.height > 0;

    if (!available) {
      newDavCandidate = null;
      newDavCandidateSince = 0;
      return null;
    }

    if (newDavCandidate !== button) {
      newDavCandidate = button;
      newDavCandidateSince = Date.now();
      return null;
    }

    return Date.now() - newDavCandidateSince >= 200 ? button : null;
  }

  function findDavNavigationLink() {
    return getHostDocument().querySelector(
      '#sidebar a.nav-link-l2[href*="modulos/dav01/dav01.php"]'
    );
  }

  function beginDavCreationFlow() {
    const currentDocument = getCalebeDocument();
    const newDavButtonPresent = currentDocument?.getElementById('btnNovoDav');
    const newDavButton = findNativeNewDavButton();
    if (newDavButton) {
      if (!newDavClickStarted) {
        newDavClickStarted = true;
        clickNativeElement(newDavButton);
      }
      return true;
    }

    if (newDavButtonPresent) return true;

    const davLink = findDavNavigationLink();
    if (!davLink) return false;

    if (!davNavigationStarted) {
      davNavigationStarted = true;
      clickNativeElement(davLink);
    }
    return true;
  }

  function clickNativeElement(element) {
    const win = element.ownerDocument.defaultView;
    element.scrollIntoView({ block: 'center' });
    element.dispatchEvent(new win.MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      view: win
    }));
    element.dispatchEvent(new win.MouseEvent('mouseup', {
      bubbles: true,
      cancelable: true,
      view: win
    }));
    element.click();
  }

  function clickNeutralArea(doc) {
    const win = doc.defaultView;
    const neutralArea = doc.createElement('span');
    neutralArea.setAttribute('aria-hidden', 'true');
    Object.assign(neutralArea.style, {
      position: 'fixed',
      left: '2px',
      bottom: '2px',
      width: '1px',
      height: '1px',
      opacity: '0',
      pointerEvents: 'auto',
      zIndex: '2147483647'
    });
    doc.body.appendChild(neutralArea);
    neutralArea.dispatchEvent(new win.MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      view: win
    }));
    neutralArea.dispatchEvent(new win.MouseEvent('mouseup', {
      bubbles: true,
      cancelable: true,
      view: win
    }));
    neutralArea.click();
    neutralArea.remove();
  }

  function waitInDocument(doc, delay) {
    return new Promise(resolve => getDocumentWindow(doc).setTimeout(resolve, delay));
  }

  async function closeClientAutocomplete(doc, nameInput, expectedCode) {
    await waitInDocument(doc, 300);
    const confirmedId = String(doc.getElementById('cliId')?.value || '').trim();
    if (confirmedId !== expectedCode || !doc.body) return;

    clickNeutralArea(doc);
    await waitInDocument(doc, 100);

    const autocomplete = doc.getElementById('cli_ac');
    if (autocomplete && autocomplete.style.display !== 'none') {
      clickNeutralArea(doc);
    }

    if (nameInput.isConnected) nameInput.focus();
  }

  function ensureClientAutocompleteClosed(doc, nameInput, expectedCode) {
    if (
      closingClientDocument === doc &&
      closingClientCode === expectedCode &&
      closingClientPromise
    ) {
      return closingClientPromise;
    }
    closingClientDocument = doc;
    closingClientCode = expectedCode;
    closingClientPromise = closeClientAutocomplete(doc, nameInput, expectedCode);
    return closingClientPromise;
  }

  function getDavClientControls(doc) {
    const nameInput = doc?.getElementById('cliNome');
    if (!nameInput) return null;

    return {
      nameInput,
      idInput: doc.getElementById('cliId'),
      win: getDocumentWindow(doc)
    };
  }

  function isClientLoaded(controls, client) {
    const loadedId = String(controls.idInput?.value || '').trim();
    const loadedName = String(controls.nameInput.value || '').trim();
    return loadedId === client.code && Boolean(loadedName);
  }

  function finishLoadedClient(doc, controls, client) {
    if (!isClientLoaded(controls, client)) return false;
    clearPendingClient();
    ensureClientAutocompleteClosed(doc, controls.nameInput, client.code).catch(error => {
      console.warn('[Calebe Helper] Cliente confirmado, mas o autocomplete não foi fechado.', error);
      if (controls.nameInput.isConnected) controls.nameInput.focus();
    });
    return true;
  }

  function waitForLoadedClient(client) {
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
      const check = () => {
        const doc = getCalebeDocument();
        const controls = getDavClientControls(doc);
        if (controls && isClientLoaded(controls, client)) {
          ensureClientAutocompleteClosed(doc, controls.nameInput, client.code)
            .then(() => resolve({ doc, controls }))
            .catch(reject);
          return;
        }
        if (Date.now() - startedAt >= PENDING_TIMEOUT_MS) {
          reject(new Error(`Cliente ${client.code} não foi confirmado em #cliId.`));
          return;
        }
        window.setTimeout(check, RETRY_INTERVAL_MS);
      };
      check();
    });
  }

  async function runOpenBlankDav() {
    console.log('[CLIENTEDAV] Abrindo listagem de DAVs.');
    const hostDocument = getHostDocument();
    const davLink = hostDocument.querySelector('#sidebar a.nav-link-l2[href*="modulos/dav01/dav01.php"]');
    if (!davLink) throw new Error('Link DAVs não encontrado no #sidebar.');
    const currentDocument = getCalebeDocument();
    const alreadyOnList = currentDocument?.getElementById('btnNovoDav') && /\/modulos\/dav01\/dav01\.php$/i.test(currentDocument.location.pathname);
    if (!alreadyOnList) clickNativeElement(davLink);
    const button = await waitFor(() => {
      const doc = getCalebeDocument();
      const candidate = doc?.getElementById('btnNovoDav');
      return doc?.readyState === 'complete' && candidate?.isConnected && !candidate.disabled ? candidate : null;
    }, { message: '#btnNovoDav não ficou disponível.' });
    console.log('[CLIENTEDAV] #btnNovoDav encontrado.');
    clickNativeElement(button);
    console.log('[CLIENTEDAV] #btnNovoDav clicado.');
    return waitFor(() => {
      const doc = getCalebeDocument();
      const nameInput = doc?.getElementById('cliNome');
      const idInput = doc?.getElementById('cliId');
      return nameInput && idInput ? { doc, win: getDocumentWindow(doc), nameInput, idInput } : null;
    }, { message: 'A tela da nova DAV não ficou pronta.' });
  }

  function openBlankDav() {
    if (activeOpenDavPromise) return activeOpenDavPromise;
    activeOpenDavPromise = runOpenBlankDav().finally(() => {
      activeOpenDavPromise = null;
    });
    return activeOpenDavPromise;
  }

  async function legacyCreateDavForClient(rawClient) {
    const client = normalizeClient({ ...rawClient, createdAt: Date.now() });
    if (!client || !savePendingClient(client)) throw new Error('Cliente inválido para criação do DAV.');
    if (!beginDavCreationFlow()) {
      clearPendingClient();
      throw new Error('Link nativo de acesso aos DAVs não encontrado no #sidebar.');
    }
    await waitForLoadedClient(client);
    return { clientCode: client.code };
  }

  /*
  function createDavForClient(rawClient) {
    const client = normalizeClient({ ...rawClient, createdAt: Date.now() });
    if (!client) return Promise.reject(new Error('Cliente inválido para criação do DAV.'));
    if (activeCreationPromise) {
      if (activeCreationCode === client.code) return activeCreationPromise;
      return Promise.reject(new Error(`Já existe uma DAV sendo criada para o cliente ${activeCreationCode}.`));
    }
  }

  */
  async function createDavForClient(rawClient) {
    const client = normalizeClient({ ...rawClient, createdAt: Date.now() });
    if (!client) throw new Error('Cliente inválido para criação do DAV.');
    await openBlankDav();
    const selectClient = await waitFor(() => window.calebeHelperSelectClientByCode, {
      message: 'Rotina compartilhada de seleção do cliente não ficou disponível.'
    });
    await selectClient(client.code, { clearFirst: false });
    /*
    */
    return { clientCode: client.code };
  }

  function setNativeValue(control, value) {
    const win = control.ownerDocument.defaultView;
    const prototype = win.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (setter) setter.call(control, value);
    else control.value = value;
  }

  function dispatchNativeClientLookup(controls, client) {
    const now = Date.now();
    if (
      lastLookupDocument === controls.nameInput.ownerDocument &&
      lastLookupCode === client.code &&
      now - lastLookupAt < 2000
    ) {
      return false;
    }

    lastLookupDocument = controls.nameInput.ownerDocument;
    lastLookupCode = client.code;
    lastLookupAt = now;

    const { nameInput, win } = controls;
    nameInput.focus();
    setNativeValue(nameInput, client.code);
    nameInput.dispatchEvent(new win.Event('input', { bubbles: true }));
    nameInput.dispatchEvent(new win.KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true
    }));
    return true;
  }

  function tryLoadPendingClient() {
    const client = pendingClient || readPendingClient();
    if (!client) return false;

    if (Date.now() - client.createdAt > PENDING_TIMEOUT_MS) {
      clearPendingClient();
      return false;
    }

    const doc = getCalebeDocument();
    const controls = getDavClientControls(doc);
    if (!controls) return false;

    if (finishLoadedClient(doc, controls, client)) return true;

    try {
      if (dispatchNativeClientLookup(controls, client)) {
        scheduleLoadedClientCheck(doc, client);
      }
      return true;
    } catch (error) {
      console.error('[Calebe Helper] Falha ao carregar o cliente no novo DAV.', error);
    }

    return false;
  }

  function scheduleLoadedClientCheck(doc, client) {
    const startedAt = Date.now();

    const check = () => {
      if (!pendingClient) return;

      const controls = getDavClientControls(doc);
      if (controls && finishLoadedClient(doc, controls, client)) return;

      if (Date.now() - startedAt < PENDING_TIMEOUT_MS) {
        window.setTimeout(check, RETRY_INTERVAL_MS);
      }
    };

    window.setTimeout(check, RETRY_INTERVAL_MS);
  }

  function startRetrying() {
    if (retryTimer || !(pendingClient || readPendingClient())) return;

    const startedAt = Date.now();
    retryTimer = window.setInterval(() => {
      observeCurrentFrame();
      installEverywhere();

      const controls = getDavClientControls(getCalebeDocument());
      if (controls) {
        tryLoadPendingClient();
      } else {
        beginDavCreationFlow();
      }

      if (!pendingClient || Date.now() - startedAt >= PENDING_TIMEOUT_MS) {
        if (pendingClient) {
          console.error('[Calebe Helper] A tela do novo DAV não ficou pronta para carregar o cliente.');
          clearPendingClient();
        } else {
          stopRetrying();
        }
      }
    }, RETRY_INTERVAL_MS);
  }

  function stopRetrying() {
    if (!retryTimer) return;
    window.clearInterval(retryTimer);
    retryTimer = null;
  }

  function installEverywhere() {
    installButtons(getCalebeDocument());
  }

  function observeDocument(doc) {
    if (!doc?.documentElement) return null;
    const observer = new MutationObserver(() => {
      installButtons(doc);
      if (pendingClient) tryLoadPendingClient();
    });
    observer.observe(doc.documentElement, { childList: true, subtree: true });
    return observer;
  }

  function observeCurrentFrame() {
    const frame = getMainFrame();

    if (frame && frame !== observedFrame) {
      observedFrame = frame;
      frame.addEventListener('load', () => {
        observeCurrentFrame();
        installEverywhere();
        if (pendingClient) startRetrying();
      });
    }

    let frameDocument = null;
    try {
      frameDocument = frame?.contentDocument || null;
    } catch {
      return;
    }

    if (!frameDocument || frameDocument === observedFrameDocument) return;

    frameObserver?.disconnect();
    observedFrameDocument = frameDocument;
    frameObserver = observeDocument(frameDocument);
    installButtons(frameDocument);
    if (pendingClient) tryLoadPendingClient();
  }

  observeDocument(document);
  observeCurrentFrame();
  installEverywhere();

  window.calebeHelperClientDav = Object.freeze({
    openBlankDav,
    createDavForClient
  });

  if (pendingClient) startRetrying();
  if (false && pendingClient) {
    createDavForClient(pendingClient).catch(error => {
      console.error('[Calebe Helper] Falha ao restaurar criação pendente.', error);
    });
  }
})();

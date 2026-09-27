(() => {
  'use strict';
  if (window.top !== window.self) return;
  if (window.__calebeHelperXmlDownloader) return;
  window.__calebeHelperXmlDownloader = true;

  let tableObserver = null;
  let tableObserverTarget = null;
  let processing = false;
  let toastHideTimer = null;
  let toastDismissed = false;
  const addressCache = new Map();
  const addressRequests = new Map();
  const addressQueue = [];
  let activeAddressRequests = 0;
  const maxAddressConcurrency = 2;

  function getFrame() { return document.getElementById('mainIframe'); }

  function getCalebeDoc() {
    const frame = getFrame();
    try { return frame?.contentDocument || null; } catch (_) { return null; }
  }

  function isNfe001Doc(doc) {
    try { return /\/modulos\/nfe001\/nfe001\.php$/i.test(doc?.defaultView?.location?.pathname || ''); }
    catch (_) { return false; }
  }

  function isEmitidas(doc) {
    return doc?.getElementById('filtAcao')?.value === 'emitidas';
  }

  function command(doc, action, payload = {}, timeout = 12000) {
    return new Promise((resolve, reject) => {
      const id = `xml-dl-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      let timer;
      const handler = event => {
        if (event.detail?.id !== id) return;
        clearTimeout(timer);
        doc.removeEventListener('calebe-helper:command-result', handler);
        event.detail.ok ? resolve(event.detail) : reject(new Error(event.detail.error || 'Falha no comando.'));
      };
      doc.addEventListener('calebe-helper:command-result', handler);
      doc.dispatchEvent(new CustomEvent('calebe-helper:command', { detail: { id, action, ...payload } }));
      timer = setTimeout(() => {
        doc.removeEventListener('calebe-helper:command-result', handler);
        reject(new Error(`Timeout: ${action}`));
      }, timeout);
    });
  }

  function clearToastTimer() {
    if (toastHideTimer) clearTimeout(toastHideTimer);
    toastHideTimer = null;
  }

  function ensureToast(doc) {
    let toast = doc.getElementById('xml-downloader-toast');
    if (toast) return toast;
    const footer = doc.querySelector('.nfe-footer');
    if (!footer) return null;
    const footerStyle = doc.defaultView?.getComputedStyle(footer);
    if (footerStyle && footerStyle.position === 'static') footer.style.position = 'relative';
    toast = doc.createElement('div');
    toast.id = 'xml-downloader-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.hidden = true;
    toast.innerHTML = `
      <div class="xml-downloader-toast-content">
        <i class="bi bi-download"></i>
        <span id="xml-downloader-toast-message">Preparando downloads...</span>
      </div>
      <button type="button" id="xml-downloader-toast-close" aria-label="Fechar" title="Fechar">
        <i class="bi bi-x-lg"></i>
      </button>
    `;
    toast.querySelector('#xml-downloader-toast-close')?.addEventListener('click', () => {
      toastDismissed = true;
      clearToastTimer();
      if (!toast.hidden) toast.hidden = true;
    });
    footer.appendChild(toast);
    return toast;
  }

  function showToast(doc, text, kind = '') {
    clearToastTimer();
    const toast = ensureToast(doc);
    if (!toast) return;
    const msg = toast.querySelector('#xml-downloader-toast-message');
    const nextText = text || '';
    if (msg && msg.textContent !== nextText) msg.textContent = nextText;
    if ((toast.dataset.kind || '') !== kind) toast.dataset.kind = kind;
    if (!toastDismissed && toast.hidden) toast.hidden = false;
  }

  function hideToastLater(doc, delay = 5000) {
    clearToastTimer();
    if (toastDismissed) return;
    toastHideTimer = setTimeout(() => {
      const toast = doc.getElementById('xml-downloader-toast');
      if (toast && !toast.hidden) toast.hidden = true;
      toastHideTimer = null;
    }, delay);
  }

  function removeToast(doc) {
    clearToastTimer();
    doc.getElementById('xml-downloader-toast')?.remove();
  }

  function ensureStyles(doc) {
    if (doc.getElementById('xml-downloader-style')) return;
    const style = doc.createElement('style');
    style.id = 'xml-downloader-style';
    style.textContent = `
      #xml-downloader-controles{min-width:260px}
      #xml-downloader-controles label{margin-bottom:0}
      #xml-downloader-controles>label{display:block;margin-bottom:2px}
      #xml-downloader-selecionar-todas{cursor:pointer;margin-right:6px}
      .xml-downloader-cell-wrap{display:flex;align-items:center;gap:.5rem;width:100%;min-width:0}
      .xml-downloader-nota{flex:0 0 auto;margin:0;cursor:pointer}
      .xml-downloader-cell-content{flex:1 1 auto;min-width:0}
      .xml-downloader-client-address{margin-top:2px;color:var(--text-muted,#6c757d);font-size:.60rem;font-weight:400;line-height:1.2;white-space:normal}
      #xml-downloader-toast{position:absolute;right:0;bottom:calc(100% + 8px);z-index:1060;display:flex;align-items:center;gap:14px;max-width:min(420px,calc(100vw - 32px));padding:10px 12px;color:var(--text,#212529);background:var(--card-bg,#fff);border:1px solid var(--border,#dee2e6);border-left:4px solid var(--accent,#0d6efd);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.18);pointer-events:none}
      #xml-downloader-toast[hidden]{display:none}
      #xml-downloader-toast[data-kind="warn"]{border-left-color:#ffc107}
      #xml-downloader-toast[data-kind="error"]{border-left-color:#dc3545}
      #xml-downloader-toast[data-kind="ok"]{border-left-color:#198754}
      .xml-downloader-toast-content{display:flex;align-items:center;gap:8px;min-width:0;flex:1}
      #xml-downloader-toast-message{font-size:.82rem;line-height:1.3}
      #xml-downloader-toast-close{flex:0 0 auto;padding:2px 4px;color:inherit;background:transparent;border:0;cursor:pointer;opacity:.65;pointer-events:auto}
      #xml-downloader-toast-close:hover{opacity:1}
    `;
    const root = doc.head || doc.documentElement;
    if (!root) return false;
    root.appendChild(style);
  }

  function ensureControls(doc) {
    if (doc.getElementById('xml-downloader-controles')) return;
    const unidade = doc.querySelector('.fg-unidade');
    if (!unidade) return;
    const controls = doc.createElement('div');
    controls.id = 'xml-downloader-controles';
    controls.className = 'fg';
    controls.innerHTML = `
      <label>Arquivos</label>
      <div class="d-flex align-items-center gap-3">
        <label class="d-flex align-items-center gap-1">
          <input type="checkbox" id="xml-downloader-xml" checked>
          XML
        </label>
        <label class="d-flex align-items-center gap-1">
          <input type="checkbox" id="xml-downloader-pdf">
          PDF
        </label>
        <label class="d-flex align-items-center gap-1">
          <input type="checkbox" id="xml-downloader-zip">
          ZIP
        </label>
        <button type="button" class="btn btn-success" id="xml-downloader-baixar">
          <i class="bi bi-download"></i>
          Baixar
        </button>
      </div>
    `;
    unidade.insertAdjacentElement('afterend', controls);
    doc.getElementById('xml-downloader-baixar')?.addEventListener('click', () => processDownloads(doc));
  }

  function removeControls(doc) {
    doc.getElementById('xml-downloader-controles')?.remove();
  }

  function ensureSelectedCounter(doc) {
    if (doc.getElementById('xml-downloader-selecionados-wrap')) return;
    const apresentados = doc.getElementById('ctApresentados');
    const anchor = apresentados?.closest('span');
    if (!anchor) return;
    const span = doc.createElement('span');
    span.id = 'xml-downloader-selecionados-wrap';
    span.innerHTML = 'Selecionados: <strong id="xml-downloader-ct-selecionados">0</strong>';
    anchor.insertAdjacentElement('afterend', span);
  }

  function removeSelectedCounter(doc) {
    doc.getElementById('xml-downloader-selecionados-wrap')?.remove();
  }

  function updateSelectedCounter(doc) {
    const counter = doc.getElementById('xml-downloader-ct-selecionados');
    if (!counter) return;
    const nextValue = String(doc.querySelectorAll('.xml-downloader-nota:checked').length);
    if (counter.textContent !== nextValue) counter.textContent = nextValue;
  }

  function getHeaderRow(doc) {
    return doc.querySelector('#tabelaNFE thead tr') || doc.querySelector('#tabelaNFE tr');
  }

  function stopCheckboxEvent(event) {
    event.stopPropagation();
  }

  function wireCheckbox(input, doc) {
    input.addEventListener('click', stopCheckboxEvent);
    input.addEventListener('mousedown', stopCheckboxEvent);
    input.addEventListener('change', event => {
      event.stopPropagation();
      updateMasterCheckbox(doc);
      updateSelectedCounter(doc);
    });
  }

  function repairPreviousColumnVersion(doc) {
    const oldHeaderInput = doc.getElementById('xml-downloader-selecionar-todas');
    const oldHeader = oldHeaderInput?.closest('th');
    if (oldHeader?.dataset?.xmlDownloaderColumn === '1') {
      oldHeader.remove();
      console.warn('[Calebe Helper] Colunas reparadas. Recarregue a página uma vez para restaurar o cabeçalho nativo.');
    }
    doc.querySelectorAll('th.xml-downloader-col,td.xml-downloader-col').forEach(cell => {
      cell.classList.remove('xml-downloader-col');
      delete cell.dataset.xmlDownloaderColumn;
    });
    doc.querySelectorAll('[data-xml-downloader-column]').forEach(cell => {
      delete cell.dataset.xmlDownloaderColumn;
    });
  }

  function ensureHeaderCheckbox(doc) {
    const headerRow = getHeaderRow(doc);
    const firstTh = headerRow?.querySelector('th');
    if (!firstTh || firstTh.querySelector('#xml-downloader-selecionar-todas')) return;
    const input = doc.createElement('input');
    input.type = 'checkbox';
    input.id = 'xml-downloader-selecionar-todas';
    input.title = 'Selecionar todas as notas apresentadas';
    input.addEventListener('click', event => {
      event.stopPropagation();
      setAllPresented(doc, event.currentTarget.checked);
    });
    input.addEventListener('mousedown', stopCheckboxEvent);
    input.addEventListener('change', stopCheckboxEvent);
    firstTh.insertAdjacentElement('afterbegin', input);
  }

  function removeHeaderCheckbox(doc) {
    doc.getElementById('xml-downloader-selecionar-todas')?.remove();
  }

  function extractCabCodigo(row) {
    const action = row.querySelector('[onclick*="baixarXmlPdf("]');
    const onclick = action?.getAttribute('onclick') || '';
    const match = onclick.match(/baixarXmlPdf\s*\(\s*(\d+)\s*\)/);
    return match ? match[1] : '';
  }

  function getXmlValue(root, name) {
    const nodes = root?.getElementsByTagNameNS?.('*', name);
    if (nodes?.length) return String(nodes[0].textContent || '').trim();
    const fallback = root?.getElementsByTagName?.(name);
    return fallback?.length ? String(fallback[0].textContent || '').trim() : '';
  }

  function decodeXmlBase64(base64) {
    const clean = String(base64 || '').replace(/^data:[^,]*,/, '');
    const binary = atob(clean);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  }

  function extractAddressFromXml(base64) {
    if (!base64) return null;
    const xml = new DOMParser().parseFromString(decodeXmlBase64(base64), 'application/xml');
    if (xml.querySelector('parsererror')) throw new Error('XML inválido.');
    const enderDest = [...xml.getElementsByTagNameNS('*', 'enderDest')][0]
      || [...xml.getElementsByTagName('enderDest')][0];
    if (!enderDest) return null;

    const streetParts = [
      getXmlValue(enderDest, 'xLgr'),
      getXmlValue(enderDest, 'nro'),
      getXmlValue(enderDest, 'xCpl')
    ].filter(Boolean);
    const street = streetParts.join(', ');
    const district = getXmlValue(enderDest, 'xBairro');
    const city = getXmlValue(enderDest, 'xMun');
    const uf = getXmlValue(enderDest, 'UF');
    const cityUf = [city, uf].filter(Boolean).join('/');
    return [street, district, cityUf].filter(Boolean).join(' — ') || null;
  }

  function renderClientAddress(doc, row, address) {
    if (!address || row.querySelector('[data-xml-downloader-client-address]')) return;
    const content = row.querySelector('.xml-downloader-cell-content');
    if (!content) return;
    const details = doc.createElement('div');
    details.className = 'xml-downloader-client-address';
    details.dataset.xmlDownloaderClientAddress = '1';
    details.textContent = address;
    const name = content.querySelector('strong');
    if (name) name.insertAdjacentElement('afterend', details);
    else content.appendChild(details);
  }

  function pumpAddressQueue() {
    while (activeAddressRequests < maxAddressConcurrency && addressQueue.length) {
      const task = addressQueue.shift();
      activeAddressRequests += 1;
      task().catch(() => {}).finally(() => {
        activeAddressRequests -= 1;
        pumpAddressQueue();
      });
    }
  }

  function enrichRowAddress(doc, row, cabCodigo) {
    if (!cabCodigo || row.dataset.xmlDownloaderClientState) return;
    if (row.querySelector('[data-xml-downloader-client-address]')) {
      row.dataset.xmlDownloaderClientState = 'ready';
      return;
    }
    row.dataset.xmlDownloaderClientState = 'loading';
    const key = String(cabCodigo);
    let request = addressRequests.get(key);
    if (!request) {
      request = new Promise((resolve, reject) => {
        addressQueue.push(async () => {
          try {
            const result = await command(doc, 'baixar-xml-pdf', { cabCodigo: key }, 30000);
            const response = result.result || {};
            if (response.sucesso === false) throw new Error(response.erro || 'Falha ao obter XML.');
            const xmlBase64 = response.xmlBase64;
            response.xmlBase64 = null;
            response.pdfBase64 = null;
            const address = extractAddressFromXml(xmlBase64);
            addressCache.set(key, address);
            resolve(address);
          } catch (err) {
            addressCache.set(key, null);
            reject(err);
          }
        });
        pumpAddressQueue();
      }).finally(() => addressRequests.delete(key));
      addressRequests.set(key, request);
    }
    request.then(address => {
      if (!isActiveDoc(doc) || !row.isConnected) return;
      if (address) {
        renderClientAddress(doc, row, address);
        row.dataset.xmlDownloaderClientState = 'ready';
      } else {
        row.dataset.xmlDownloaderClientState = 'unavailable';
      }
    }).catch(err => {
      row.dataset.xmlDownloaderClientState = 'error';
      if (window.__calebeHelperDebug) console.warn('[Calebe Helper] Falha ao obter endereço da nota.', err);
    });
  }

  function queueRowAddress(doc, row) {
    if (!row || row.dataset.xmlDownloaderClientState) return;
    const cabCodigo = extractCabCodigo(row);
    if (!cabCodigo || addressCache.has(String(cabCodigo))) {
      if (cabCodigo && addressCache.has(String(cabCodigo))) {
        const address = addressCache.get(String(cabCodigo));
        row.dataset.xmlDownloaderClientState = address ? 'ready' : 'unavailable';
        renderClientAddress(doc, row, address);
      }
      return;
    }
    enrichRowAddress(doc, row, cabCodigo);
  }

  function addRowCheckbox(doc, row) {
    if (row.querySelector('.xml-downloader-nota')) return;
    const cabCodigo = extractCabCodigo(row);
    if (!cabCodigo) return;
    const firstTd = row.querySelector('td');
    if (!firstTd || firstTd.querySelector('.xml-downloader-cell-wrap')) return;

    const wrap = doc.createElement('div');
    wrap.className = 'xml-downloader-cell-wrap';

    const input = doc.createElement('input');
    input.type = 'checkbox';
    input.className = 'xml-downloader-nota';
    input.value = cabCodigo;
    wireCheckbox(input, doc);
    wrap.appendChild(input);

    const content = doc.createElement('div');
    content.className = 'xml-downloader-cell-content';
    while (firstTd.firstChild) content.appendChild(firstTd.firstChild);
    wrap.appendChild(content);
    firstTd.appendChild(wrap);
    queueRowAddress(doc, row);
  }

  function ensureBodyRows(doc) {
    const tbody = doc.getElementById('tabelaBody');
    if (!tbody) return;
    [...tbody.querySelectorAll('tr')].forEach(row => {
      addRowCheckbox(doc, row);
      queueRowAddress(doc, row);
    });
    updateMasterCheckbox(doc);
  }

  function removeBodyCheckboxes(doc) {
    doc.querySelectorAll('#tabelaBody .xml-downloader-cell-wrap').forEach(wrap => {
      const cell = wrap.parentElement;
      const content = wrap.querySelector('.xml-downloader-cell-content');
      if (!cell || !content) return;
      while (content.firstChild) cell.insertBefore(content.firstChild, wrap);
      wrap.remove();
    });
    doc.querySelectorAll('#tabelaBody .xml-downloader-nota').forEach(input => input.remove());
  }

  function getPresentedCheckboxes(doc) {
    return [...doc.querySelectorAll('#tabelaBody .xml-downloader-nota')];
  }

  function setAllPresented(doc, checked) {
    getPresentedCheckboxes(doc).forEach(input => { input.checked = checked; });
    updateMasterCheckbox(doc);
    updateSelectedCounter(doc);
  }

  function updateMasterCheckbox(doc) {
    const master = doc.getElementById('xml-downloader-selecionar-todas');
    if (!master) return;
    const boxes = getPresentedCheckboxes(doc);
    const checked = boxes.filter(input => input.checked);
    master.checked = boxes.length > 0 && checked.length === boxes.length;
    master.indeterminate = checked.length > 0 && checked.length < boxes.length;
    updateSelectedCounter(doc);
  }

  function observeTable(doc) {
    const tbody = doc.getElementById('tabelaBody');
    if (!tbody) return;
    if (tableObserver && tableObserverTarget === tbody) return;
    disconnectTableObserver();
    tableObserverTarget = tbody;
    tableObserver = new MutationObserver(records => {
      if (!isActiveDoc(doc)) return;
      const rows = new Set();
      records.forEach(record => record.addedNodes.forEach(node => {
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        if (node.matches('tr')) rows.add(node);
        node.querySelectorAll?.('tr').forEach(row => rows.add(row));
      }));
      rows.forEach(row => {
        addRowCheckbox(doc, row);
        queueRowAddress(doc, row);
      });
      updateMasterCheckbox(doc);
    });
    tableObserver.observe(tbody, { childList: true, subtree: false });
  }

  function disconnectTableObserver() {
    if (tableObserver) tableObserver.disconnect();
    tableObserver = null;
    tableObserverTarget = null;
  }

  function isActiveDoc(doc) {
    return isNfe001Doc(doc) && isEmitidas(doc);
  }

  function installActive(doc) {
    ensureStyles(doc);
    ensureControls(doc);
    ensureSelectedCounter(doc);
    repairPreviousColumnVersion(doc);
    ensureHeaderCheckbox(doc);
    ensureBodyRows(doc);
    observeTable(doc);
  }

  function uninstallActive(doc) {
    disconnectTableObserver();
    removeControls(doc);
    removeSelectedCounter(doc);
    removeToast(doc);
    removeHeaderCheckbox(doc);
    removeBodyCheckboxes(doc);
  }

  function sync(doc = getCalebeDoc()) {
    if (!doc || !isNfe001Doc(doc)) return;
    if (isEmitidas(doc)) installActive(doc);
    else uninstallActive(doc);
  }

  function wireDoc(doc) {
    if (!doc?.documentElement || doc === document || doc.__xmlDownloaderWired) return false;
    doc.__xmlDownloaderWired = true;
    doc.addEventListener('change', event => {
      if (event.target?.id === 'filtAcao') setTimeout(() => sync(doc), 0);
    }, true);
    const observer = new MutationObserver(() => sync(doc));
    const root = doc.documentElement;
    if (!root) return false;
    observer.observe(root, { childList: true, subtree: true });
    sync(doc);
  }

  function wireFrame() {
    const frame = getFrame();
    if (!frame) return;
    if (!frame.dataset.xmlDownloaderWired) {
      frame.dataset.xmlDownloaderWired = '1';
      frame.addEventListener('load', () => setTimeout(() => wireDoc(getCalebeDoc()), 80));
    }
    wireDoc(getCalebeDoc());
  }

  function selectedFormats(doc) {
    return {
      xml: !!doc.getElementById('xml-downloader-xml')?.checked,
      pdf: !!doc.getElementById('xml-downloader-pdf')?.checked,
      zip: !!doc.getElementById('xml-downloader-zip')?.checked
    };
  }

  function saveBase64(name, mime, base64) {
    const clean = String(base64 || '').replace(/^data:[^,]*,/, '');
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name || 'download';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function base64ToBytes(base64) {
    const clean = String(base64 || '').replace(/^data:[^,]*,/, '');
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i += 1) {
      crc ^= bytes[i];
      for (let j = 0; j < 8; j += 1) {
        crc = (crc >>> 1) ^ ((crc & 1) ? 0xEDB88320 : 0);
      }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function zipDateTime(date = new Date()) {
    const year = Math.max(1980, date.getFullYear());
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
      date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
    };
  }

  function makeZip(files) {
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    const stamp = zipDateTime();

    const u16 = value => [value & 255, (value >>> 8) & 255];
    const u32 = value => [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255];

    files.forEach(file => {
      const nameBytes = encoder.encode(file.name || 'download');
      const data = file.bytes;
      const crc = crc32(data);
      const localHeader = new Uint8Array([
        0x50,0x4b,0x03,0x04, ...u16(20), ...u16(0x0800), ...u16(0),
        ...u16(stamp.time), ...u16(stamp.date), ...u32(crc),
        ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length), ...u16(0)
      ]);
      localParts.push(localHeader, nameBytes, data);

      const centralHeader = new Uint8Array([
        0x50,0x4b,0x01,0x02, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0),
        ...u16(stamp.time), ...u16(stamp.date), ...u32(crc),
        ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length),
        ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)
      ]);
      centralParts.push(centralHeader, nameBytes);
      offset += localHeader.length + nameBytes.length + data.length;
    });

    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const end = new Uint8Array([
      0x50,0x4b,0x05,0x06, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length),
      ...u32(centralSize), ...u32(offset), ...u16(0)
    ]);
    return new Blob([...localParts, ...centralParts, end], { type: 'application/zip' });
  }

  function saveBlob(name, blob) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name || 'downloads.zip';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function zipFileName() {
    const now = new Date();
    const pad = value => String(value).padStart(2, '0');
    return `NFe_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}.zip`;
  }

  async function downloadCabCodigo(doc, cabCodigo, formats) {
    const result = await command(doc, 'baixar-xml-pdf', { cabCodigo }, 30000);
    const res = result.result || {};
    if (!res.sucesso) throw new Error(res.erro || 'Falha ao gerar o XML/PDF.');
    if (!formats.zip) {
      if (formats.xml) saveBase64(res.xmlNome, 'application/xml', res.xmlBase64);
      if (formats.pdf) saveBase64(res.pdfNome, 'application/pdf', res.pdfBase64);
    }
    return res;
  }

  async function processDownloads(doc) {
    if (processing) return;
    const formats = selectedFormats(doc);
    if (!formats.xml && !formats.pdf) {
      toastDismissed = false;
      console.warn('[Calebe Helper] Selecione XML ou PDF.');
      return;
    }
    const selected = getPresentedCheckboxes(doc).filter(input => input.checked);
    if (!selected.length) {
      toastDismissed = false;
      console.warn('[Calebe Helper] Selecione pelo menos uma nota.');
      return;
    }

    const button = doc.getElementById('xml-downloader-baixar');
    const originalHtml = button?.innerHTML || '<i class="bi bi-download"></i> Baixar';
    processing = true;
    toastDismissed = false;
    if (button) {
      button.disabled = true;
      button.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>';
    }
    showToast(doc, 'Preparando downloads...');

    let ok = 0;
    let errors = 0;
    const zipFiles = [];
    try {
      for (let i = 0; i < selected.length; i += 1) {
        const cabCodigo = selected[i].value;
        showToast(doc, `Processando nota ${i + 1} de ${selected.length}...`);
        try {
          const res = await downloadCabCodigo(doc, cabCodigo, formats);
          const name = formats.xml ? res.xmlNome : res.pdfNome;
          if (formats.zip) {
            if (formats.xml && res.xmlBase64) zipFiles.push({ name: res.xmlNome || `${cabCodigo}.xml`, bytes: base64ToBytes(res.xmlBase64) });
            if (formats.pdf && res.pdfBase64) zipFiles.push({ name: res.pdfNome || `${cabCodigo}.pdf`, bytes: base64ToBytes(res.pdfBase64) });
            showToast(doc, `Adicionando ao ZIP ${i + 1} de ${selected.length} — ${name || cabCodigo}`);
          } else {
            showToast(doc, `Baixando ${i + 1} de ${selected.length} — ${name || cabCodigo}`);
          }
          ok += 1;
        } catch (err) {
          errors += 1;
          console.warn('[Calebe Helper] Falha ao baixar XML/PDF da nota.', err);
        }
      }
      if (formats.zip && zipFiles.length) {
        showToast(doc, `Gerando ZIP com ${zipFiles.length} arquivo${zipFiles.length === 1 ? '' : 's'}...`);
        saveBlob(zipFileName(), makeZip(zipFiles));
      }
      if (errors) console.warn(`[Calebe Helper] Downloads concluídos: ${ok} notas, ${errors} erros.`);
      const finalText = formats.zip
        ? `ZIP concluído: ${ok} notas, ${errors} erros.`
        : `Downloads concluídos: ${ok} notas, ${errors} erros.`;
      showToast(doc, finalText, errors ? '' : 'ok');
      hideToastLater(doc, 5000);
    } finally {
      processing = false;
      if (button) {
        button.disabled = false;
        button.innerHTML = originalHtml;
      }
    }
  }

  const rootObserver = new MutationObserver(() => wireFrame());
  rootObserver.observe(document.documentElement, { childList: true, subtree: true });
  wireFrame();
})();

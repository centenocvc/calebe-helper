(() => {
  'use strict';

  const STORAGE_KEY = 'calebeHelperStateV3';
  const DEFAULT_SETTINGS = {
    cpf: false,
    cnpj: false,
    multi: false,
    coefficient21: 2000,
    coefficient22: 2000,
    layout: 'test-one',
    theme: 'bootstrap',
    geometry: { left: null, top: 16, width: 760, height: null }
  };

  const paste = document.getElementById('paste');
  const status = document.getElementById('status');

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

  function normalizeOc(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    return /^OC\b/i.test(raw) ? raw.replace(/^oc\b/i, 'OC') : `OC ${raw}`;
  }

  function parseClipboard(text, settings) {
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

  async function notifyContentScript(action = 'show-panel') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { action });
    } catch (_) {}
  }

  document.getElementById('import').addEventListener('click', async () => {
    const saved = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] || {};
    const settings = { ...DEFAULT_SETTINGS, ...(saved.settings || {}), geometry: { ...DEFAULT_SETTINGS.geometry, ...(saved.settings?.geometry || {}) } };
    if (!saved.settings?.coefficient21 && Number(saved.settings?.coefficient) > 0) settings.coefficient21 = Number(saved.settings.coefficient);
    const rows = parseClipboard(paste.value, settings);
    if (!rows.length) {
      status.textContent = 'Nenhuma linha valida encontrada.';
      return;
    }
    await chrome.storage.local.set({ [STORAGE_KEY]: { rows, settings } });
    await notifyContentScript();
    window.close();
  });

  document.getElementById('clear').addEventListener('click', async () => {
    const saved = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] || {};
    const settings = { ...DEFAULT_SETTINGS, ...(saved.settings || {}), geometry: { ...DEFAULT_SETTINGS.geometry, ...(saved.settings?.geometry || {}) } };
    if (!saved.settings?.coefficient21 && Number(saved.settings?.coefficient) > 0) settings.coefficient21 = Number(saved.settings.coefficient);
    paste.value = '';
    await chrome.storage.local.set({ [STORAGE_KEY]: { rows: [], settings } });
    await notifyContentScript('clear-panel');
    status.textContent = 'Dados limpos.';
    paste.focus();
  });
})();

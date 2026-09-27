'use strict';

const SINTEGRA_PAGE = 'https://appasp.sefaz.go.gov.br/Sintegra/Consulta/default.html';
let sintegraLookupPromise = null;

function onlyDigits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function formatCnpj(cnpj) {
  return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

function waitForTabLoad(tabId) {
  return new Promise((resolve, reject) => {
    const listener = (updatedId, changeInfo, tab) => {
      if (updatedId !== tabId || changeInfo.status !== 'complete') return;
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(tab);
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).catch(error => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(error);
    });
  });
}

async function runSintegraQuery(tabId, cnpj) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async formattedCnpj => {
      const params = new URLSearchParams({
        rTipoDoc: '2', tDoc: formattedCnpj, tCNPJ: formattedCnpj,
        tCCE: '', tCPF: '', btCGC: 'Consultar'
      });
      const response = await fetch('/Sintegra/Consulta/consultar.asp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      });
      const html = await response.text();
      const pattern = /\b\d{2}\.\d{3}\.\d{3}-\d\b/g;
      const labelIndex = html.search(/inscri[cç][aã]o\s+estadual/i);
      const nearby = labelIndex >= 0 ? html.slice(labelIndex, labelIndex + 600).match(pattern) : null;
      return { status: response.status, tamanho: html.length, ie: nearby?.[0] || (html.match(pattern) || [])[0] || '' };
    },
    args: [formatCnpj(cnpj)]
  });
  if (!result?.result || result.result.status < 200 || result.result.status >= 300 || !result.result.tamanho) {
    throw new Error('Sintegra indisponível.');
  }
  return { ie: result.result.ie || '' };
}

async function consultarSintegraGo(rawCnpj) {
  const cnpj = onlyDigits(rawCnpj);
  if (cnpj.length !== 14) throw new Error('CNPJ inválido.');
  const existing = (await chrome.tabs.query({ url: 'https://appasp.sefaz.go.gov.br/Sintegra/Consulta/*' }))[0];
  let tab = existing;
  let created = false;
  try {
    if (!tab) {
      tab = await chrome.tabs.create({ url: SINTEGRA_PAGE, active: false });
      created = true;
      await waitForTabLoad(tab.id);
    }
    return await runSintegraQuery(tab.id, cnpj);
  } finally {
    if (created && tab?.id) await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'CALEBE_SINTEGRA_GO') return;
  if (sintegraLookupPromise) {
    sendResponse({ ok: false, error: 'Consulta Sintegra já está em andamento.' });
    return;
  }
  sintegraLookupPromise = consultarSintegraGo(message.cnpj);
  sintegraLookupPromise
    .then(result => sendResponse({ ok: true, ...result }))
    .catch(error => sendResponse({ ok: false, error: String(error?.message || error) }))
    .finally(() => { sintegraLookupPromise = null; });
  return true;
});

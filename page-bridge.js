(() => {
  'use strict';
  const markReady = () => { if (document.documentElement) document.documentElement.dataset.calebeHelperBridgeReady = '1'; };
  if (document.__calebeHelperBridgeV3) { markReady(); return; }
  document.__calebeHelperBridgeV3 = true;
  window.__calebeHelperBridgeV3 = true;
  markReady();
  if (!document.documentElement) document.addEventListener('DOMContentLoaded', markReady, { once: true });

  const emit = (name, detail = {}) => {
    document.dispatchEvent(new CustomEvent(`calebe-helper:${name}`, { detail }));
  };

  // Captura os dados completos devolvidos pela consulta por código para o overlay.
  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = async function (...args) {
      const response = await originalFetch.apply(this, args);
      try {
        const init = args[1] || {};
        const body = init.body;
        if (body instanceof FormData && body.get('acao') === 'get_cliente_por_codigo') {
          response.clone().json().then(row => {
            if (row && row.ClienteCodigo) {
              try { if (document.documentElement) document.documentElement.dataset.calebeHelperClientDetails = JSON.stringify(row); } catch (_) {}
              emit('cliente-detalhes', row);
            }
          }).catch(() => {});
        }
        if (body instanceof FormData && body.get('acao') === 'pesquisar') {
          response.clone().json().then(data => {
            const rows = Array.isArray(data?.rows) ? data.rows : [];
            const davClients = rows
              .filter(row => row && row.OrcamentoCodigo && row.OrcamentoCliente)
              .map(row => ({
                davId: Number(row.OrcamentoCodigo),
                clientCode: String(row.OrcamentoCliente || '').trim(),
                clientName: String(row.OrcamentoClienteRazaoSocial || '').trim()
              }))
              .filter(row => Number.isFinite(row.davId) && row.davId > 0 && row.clientCode);
            try { if (document.documentElement) document.documentElement.dataset.calebeHelperDavClients = JSON.stringify(davClients); } catch (_) {}
            emit('dav-clientes', davClients);
          }).catch(() => {});
        }
      } catch (_) {}
      return response;
    };
  }

  document.addEventListener('calebe-helper:command', async event => {
    const d = event.detail || {};
    try {
      if (d.action === 'lookup-client') {
        const code = String(d.code || '').trim();
        if (!code) throw new Error('Código do cliente vazio.');
        if (typeof window.acBuscarClientePorCodigo === 'function') {
          window.acBuscarClientePorCodigo(code);
          emit('command-result', { id: d.id, ok: true });
          return;
        }
        const input = document.getElementById('cliNome');
        if (!input) throw new Error('Campo cliNome não encontrado.');
        input.value = code;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
        emit('command-result', { id: d.id, ok: true });
        return;
      }
      if (d.action === 'get-client-details') {
        const code = String(d.code || '').trim();
        if (!code) throw new Error('Código do cliente vazio.');
        const fd = new FormData();
        fd.append('acao', 'get_cliente_por_codigo');
        fd.append('codigo', code);
        const response = await fetch('dav01_ajax.php', {
          method: 'POST',
          body: fd,
          credentials: 'same-origin',
          headers: {
            Accept: 'application/json, text/plain, */*'
          }
        });
        const text = await response.text();
        let row;
        try {
          row = JSON.parse(text);
        } catch {
          throw new Error(`Consulta do cliente retornou resposta inválida: HTTP ${response.status}.`);
        }
        if (!response.ok || row?.sessao === false || row?.sucesso === 0) {
          throw new Error(row?.erro || `Consulta do cliente falhou: HTTP ${response.status}.`);
        }
        if (!row?.ClienteCodigo) {
          throw new Error('Consulta do cliente não retornou um cadastro válido.');
        }
        emit('command-result', { id: d.id, ok: true, row });
        return;
      }
        /*
            lastError = new Error(`Consulta do cliente não retornou JSON: ${response.status}`);
          }
          try {
            row = JSON.parse(text);
            break;
          } catch {
            lastError = new Error(`Consulta de cliente retornou HTML em ${endpoint}.`);
          }
        }
        if (!row) throw lastError || new Error('Consulta de cliente não retornou dados.');
        emit('command-result', { id: d.id, ok: true, row });
        return;
      }
        */
      if (d.action === 'baixar-xml-pdf') {
        const cabCodigo = String(d.cabCodigo || '').trim();
        if (!cabCodigo) throw new Error('Código da nota vazio.');
        const fd = new FormData();
        fd.append('acao', 'baixar_xml_pdf');
        fd.append('cabCodigo', cabCodigo);
        const response = await fetch('nfe001_ajax.php', { method: 'POST', body: fd });
        if (!response.ok) throw new Error(`Download XML/PDF falhou: HTTP ${response.status}`);
        const result = await response.json();
        emit('command-result', { id: d.id, ok: true, result });
        return;
      }
      if (d.action === 'autofill-cash') {
        if (typeof window.autoFill === 'function') {
          window.autoFill('vlDinheiro');
          emit('command-result', { id: d.id, ok: true });
          return;
        }
        const btn = [...document.querySelectorAll('button')].find(b => /autoFill\(['\"]vlDinheiro['\"]\)/.test(b.getAttribute('onclick') || ''));
        if (!btn) throw new Error('Botão de preenchimento de dinheiro não encontrado.');
        btn.click();
        emit('command-result', { id: d.id, ok: true });
        return;
      }
    } catch (err) {
      emit('command-result', { id: d.id, ok: false, error: String(err?.message || err) });
    }
  });

  emit('bridge-ready');
})();

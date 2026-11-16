(() => {
  "use strict";
  const markReady = () => {
    if (document.documentElement)
      document.documentElement.dataset.calebeHelperBridgeReady = "1";
  };
  if (document.__calebeHelperBridgeV3) {
    markReady();
    return;
  }
  document.__calebeHelperBridgeV3 = true;
  window.__calebeHelperBridgeV3 = true;
  markReady();
  if (!document.documentElement)
    document.addEventListener("DOMContentLoaded", markReady, { once: true });

  const emit = (name, detail = {}) => {
    document.dispatchEvent(
      new CustomEvent(`calebe-helper:${name}`, { detail }),
    );
  };

  const trackedWindows = new Map();
  let trackedWindowSeq = 0;

  const postToController = (name, detail = {}) => {
    const payload = { source: "calebe-helper", event: name, ...detail };
    let controller = null;
    try {
      controller =
        window.top === window
          ? window.opener && window.opener.top
          : window.top;
    } catch (_) { }
    if (!controller || controller === window) return;
    try {
      controller.postMessage(payload, location.origin);
    } catch (_) { }
  };

  const closeTrackedWindow = (record) => {
    window.clearInterval(record.timer);
    trackedWindows.delete(record.id);
    emit("window-closed", {
      id: record.id,
      name: record.name,
      url: record.url,
    });
  };

  const confirmEmissionFromClick = (event) => {
    const target = event.target;
    if (!target || typeof target.closest !== "function") return;
    if (!target.closest("#btnFecharProgresso55")) return;
    const detail = { at: Date.now() };
    emit("emission-confirmed", detail);
    postToController("emission-confirmed", detail);
  };

  const wirePopupDocument = (record) => {
    let doc = null;
    try {
      doc = record.popup.document;
    } catch (_) {
      return;
    }
    if (!doc || record.doc === doc) return;
    record.doc = doc;
    doc.addEventListener("click", confirmEmissionFromClick, true);
  };

  const refreshTrackedWindow = (record) => {
    let closed = false;
    try {
      closed = Boolean(record.popup.closed);
    } catch (_) {
      return;
    }
    if (closed) return closeTrackedWindow(record);

    try {
      const href = String(record.popup.location?.href || "");
      if (href && href !== record.url) {
        record.url = href;
        emit("window-url", { id: record.id, url: href });
      }
    } catch (_) { }
    wirePopupDocument(record);
  };

  const checkTrackedWindows = () => {
    for (const record of [...trackedWindows.values()]) refreshTrackedWindow(record);
  };

  const trackWindow = (popup, target, url) => {
    if (!popup || popup === window) return;
    for (const record of trackedWindows.values()) {
      if (record.popup !== popup) continue;
      if (!record.url && url) record.url = String(url);
      return;
    }

    const id = `calebe-window-${++trackedWindowSeq}-${Date.now()}`;
    const record = {
      id,
      popup,
      name: String(target || ""),
      url: url && String(url) !== "about:blank" ? String(url) : "",
      timer: 0,
    };
    trackedWindows.set(id, record);
    emit("window-opened", { id, name: record.name, url: record.url });
    record.timer = window.setInterval(() => refreshTrackedWindow(record), 500);
  };

  const originalWindowOpen = window.open;
  if (typeof originalWindowOpen === "function") {
    window.open = function (url, target, features) {
      const popup = originalWindowOpen.call(window, url, target, features);
      try {
        trackWindow(popup, target, url);
      } catch (_) { }
      return popup;
    };
  }
  window.addEventListener("focus", checkTrackedWindows);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) checkTrackedWindows();
  });

  // Confirmação final do Caixa DAV: só depois deste clique o painel do Excel deve voltar.
  document.addEventListener("click", confirmEmissionFromClick, true);

  // Captura os dados completos devolvidos pela consulta por código para o overlay.
  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = async function (...args) {
      const response = await originalFetch.apply(this, args);
      try {
        const init = args[1] || {};
        const body = init.body;
        // O fechamento é confirmado pela mesma resposta que o SATGO usa antes de abrir o PDF nativo.
        if (body instanceof FormData && body.get("acao") === "fechar_dav") {
          try {
            const data = await response.clone().json();
            if (!data?.erro) {
              const formDavId =
                body.get("id") || body.get("davId") || body.get("dav_id");
              const responseDavId =
                data?.id ||
                data?.davId ||
                data?.dav_id ||
                data?.OrcamentoCodigo;
              const davId =
                Number(new URLSearchParams(window.location.search).get("id")) ||
                Number(formDavId) ||
                Number(responseDavId) ||
                null;
              emit("dav-close-confirmed", { davId, ok: true });
            }
          } catch (_) { }
        }
        if (
          body instanceof FormData &&
          body.get("acao") === "get_cliente_por_codigo"
        ) {
          response
            .clone()
            .json()
            .then((row) => {
              if (row && row.ClienteCodigo) {
                try {
                  if (document.documentElement)
                    document.documentElement.dataset.calebeHelperClientDetails =
                      JSON.stringify(row);
                } catch (_) { }
                emit("cliente-detalhes", row);
              }
            })
            .catch(() => { });
        }
        if (body instanceof FormData && body.get("acao") === "pesquisar") {
          response
            .clone()
            .json()
            .then((data) => {
              const rows = Array.isArray(data?.rows) ? data.rows : [];
              const davClients = rows
                .filter(
                  (row) => row && row.OrcamentoCodigo && row.OrcamentoCliente,
                )
                .map((row) => ({
                  davId: Number(row.OrcamentoCodigo),
                  clientCode: String(row.OrcamentoCliente || "").trim(),
                  clientName: String(
                    row.OrcamentoClienteRazaoSocial || "",
                  ).trim(),
                }))
                .filter(
                  (row) =>
                    Number.isFinite(row.davId) &&
                    row.davId > 0 &&
                    row.clientCode,
                );
              try {
                if (document.documentElement)
                  document.documentElement.dataset.calebeHelperDavClients =
                    JSON.stringify(davClients);
              } catch (_) { }
              emit("dav-clientes", davClients);
            })
            .catch(() => { });
        }
      } catch (_) { }
      return response;
    };
  }

  document.addEventListener("calebe-helper:command", async (event) => {
    const d = event.detail || {};
    try {
      if (d.action === "reserve-thermal-print-window") {
        const thermalWindowName = "calebeHelperThermalPrint";
        const popup = window.open("about:blank", thermalWindowName);
        if (!popup)
          throw new Error(
            "O navegador bloqueou a janela reservada para a impressão térmica.",
          );

        try {
          const doc = popup.document;
          doc.open();
          doc.write(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Fechando DAV...</title>
  <style>
    :root {
      --accent: #0099bb;
      --text-main: #1a2133;
      --text-muted: #4a5a78;
      --border: rgba(148, 163, 184, 0.35);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      height: 100%;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      background: #080C18;
    }
    @keyframes fadeInOv {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes pulsarOv {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.06); opacity: 0.85; }
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    #bloqueioOverlay {
      display: flex;
      position: fixed; inset: 0; z-index: 999999;
      background: rgba(240, 242, 247, 0.96);
      backdrop-filter: blur(8px);
      flex-direction: column; align-items: center; justify-content: center;
      gap: 16px; padding: 24px; text-align: center;
      animation: fadeInOv 0.25s ease;
    }
    #bloqueioIconWrap {
      width: 80px; height: 80px; border-radius: 22px;
      display: flex; align-items: center; justify-content: center;
      font-size: 2.2rem;
      background: rgba(0, 212, 255, 0.12);
      border: 1px solid rgba(0, 212, 255, 0.30);
      color: var(--accent);
      animation: pulsarOv 1.4s ease-in-out infinite;
    }
    #bloqueioNome {
      font-size: 1rem; font-weight: 700;
      color: var(--text-muted); letter-spacing: .03em;
      max-width: 560px;
    }
    .ov-spinner {
      width: 32px; height: 32px;
      border: 3px solid rgba(148, 163, 184, 0.2);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 0.75s linear infinite;
    }
    #bloqueioTimer {
      font-size: .72rem; color: var(--text-muted); letter-spacing: .04em;
    }
    #bloqueioAviso {
      font-size: .78rem; color: var(--text-muted);
      max-width: 420px; line-height: 1.5;
    }
  </style>
</head>
<body>
  <div id="bloqueioOverlay" tabindex="-1" class="on">
    <div id="bloqueioIconWrap">
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">
    <path fill-rule="evenodd" d="M8 0c-.69 0-1.843.265-2.928.56-1.111.3-2.291.683-3.112 1.087a.75.75 0 0 0-.417.666A12.3 12.3 0 0 0 1.5 6c0 4.036 2.462 6.867 4.958 8.25.10.10.0.3.10.0.1.4.784.15 1.084 0 .192-.084.396-.2.542-.328C12.038 12.867 14.5 10.036 14.5 6a12.3 12.3 0 0 0-.543-3.687.75.75 0 0 0-.417-.666C12.219 1.243 11.039.86 9.928.56 8.843.266 7.69 0 8 0m0 5a1.5 1.5 0 0 1 .5 2.915V9.5a.5.5 0 0 1-1 0V7.915A1.5 1.5 0 0 1 8 5"/>
  </svg>
</div>
    <div id="bloqueioNome">Fechando DAV...</div>
    <div class="ov-spinner"></div>
    <div id="bloqueioTimer">0s processando...</div>
    <div id="bloqueioAviso">
      Não feche nem saia desta tela enquanto a operação não terminar.
    </div>
  </div>
  <script>
    (function () {
      var start = Date.now();
      var el = document.getElementById('bloqueioTimer');
      setInterval(function () {
        var s = Math.floor((Date.now() - start) / 1000);
        el.textContent = s + 's processando...';
      }, 250);
    })();
  </script>
</body>
</html>`);
          doc.close();
        } catch (_) {
          try {
            popup.document.title = "Fechando DAV...";
            popup.document.body.textContent =
              "Aguardando a confirmação do fechamento do DAV.";
          } catch (__) { }
        }

        emit("thermal-window-reserved", { ok: true });
        return;
      }

      if (d.action === "print-thermal-dav") {
        const davId = Number(d.davId);
        if (!Number.isInteger(davId) || davId <= 0)
          throw new Error("Número do DAV inválido.");
        if (typeof window.abrirEspelhoDavTermico !== "function") {
          throw new Error(
            "A função abrirEspelhoDavTermico não está disponível neste iframe.",
          );
        }
        const originalOpen = window.open;
        try {
          window.open = function (url, target, features) {
            const requestedTarget =
              !target || target === "_blank"
                ? d.windowName || "calebeHelperThermalPrint"
                : target;
            return originalOpen.call(window, url, requestedTarget, features);
          };
          window.abrirEspelhoDavTermico(davId);
        } finally {
          window.open = originalOpen;
        }
        emit("thermal-print-result", { id: d.requestId, ok: true, davId });
        return;
      }
      if (d.action === "lookup-client") {
        const code = String(d.code || "").trim();
        if (!code) throw new Error("Código do cliente vazio.");
        if (typeof window.acBuscarClientePorCodigo === "function") {
          window.acBuscarClientePorCodigo(code);
          emit("command-result", { id: d.id, ok: true });
          return;
        }
        const input = document.getElementById("cliNome");
        if (!input) throw new Error("Campo cliNome não encontrado.");
        input.value = code;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            code: "Enter",
            bubbles: true,
          }),
        );
        emit("command-result", { id: d.id, ok: true });
        return;
      }
      if (d.action === "get-client-details") {
        const code = String(d.code || "").trim();
        if (!code) throw new Error("Código do cliente vazio.");
        const fd = new FormData();
        fd.append("acao", "get_cliente_por_codigo");
        fd.append("codigo", code);
        const response = await fetch("dav01_ajax.php", {
          method: "POST",
          body: fd,
          credentials: "same-origin",
          headers: {
            Accept: "application/json, text/plain, */*",
          },
        });
        const text = await response.text();
        let row;
        try {
          row = JSON.parse(text);
        } catch {
          throw new Error(
            `Consulta do cliente retornou resposta inválida: HTTP ${response.status}.`,
          );
        }
        if (!response.ok || row?.sessao === false || row?.sucesso === 0) {
          throw new Error(
            row?.erro || `Consulta do cliente falhou: HTTP ${response.status}.`,
          );
        }
        if (!row?.ClienteCodigo) {
          throw new Error(
            "Consulta do cliente não retornou um cadastro válido.",
          );
        }
        emit("command-result", { id: d.id, ok: true, row });
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
      if (d.action === "baixar-xml-pdf") {
        const cabCodigo = String(d.cabCodigo || "").trim();
        if (!cabCodigo) throw new Error("Código da nota vazio.");
        const fd = new FormData();
        fd.append("acao", "baixar_xml_pdf");
        fd.append("cabCodigo", cabCodigo);
        const response = await fetch("nfe001_ajax.php", {
          method: "POST",
          body: fd,
        });
        if (!response.ok)
          throw new Error(`Download XML/PDF falhou: HTTP ${response.status}`);
        const result = await response.json();
        emit("command-result", { id: d.id, ok: true, result });
        return;
      }
      if (d.action === "autofill-cash") {
        if (typeof window.autoFill === "function") {
          window.autoFill("vlDinheiro");
          emit("command-result", { id: d.id, ok: true });
          return;
        }
        const btn = [...document.querySelectorAll("button")].find((b) =>
          /autoFill\(['\"]vlDinheiro['\"]\)/.test(
            b.getAttribute("onclick") || "",
          ),
        );
        if (!btn)
          throw new Error("Botão de preenchimento de dinheiro não encontrado.");
        btn.click();
        emit("command-result", { id: d.id, ok: true });
        return;
      }
    } catch (err) {
      if (d.action === "print-thermal-dav") {
        emit("thermal-print-result", {
          id: d.requestId,
          ok: false,
          error: String(err?.message || err),
        });
      }
      emit("command-result", {
        id: d.id,
        ok: false,
        error: String(err?.message || err),
      });
    }
  });

  emit("bridge-ready");
})();

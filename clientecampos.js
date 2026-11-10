(() => {
  'use strict';

  if (window.top !== window.self) return;

  const LOG = '[Calebe Helper · Campos Cliente]';
  const DEFAULT_DDD = '62';
  const EMPTY_LANDLINE = '(00) 0000-0000';
  const EMPTY_MOBILE = '(00) 0 0000-0000';
  const EMAIL_SUGGESTIONS = [
    'comprasmoraisengenharia@gmail.com',
    'compras@isconstrutora.com'
  ];
  const WIRED_ATTR = 'calebeHelperCamposWired';
  const BIRTHDAY_HANDLED_ATTR = 'calebeHelperBirthdayHandled';
  const sintegraRequests = new Map();

  function getFrame() {
    return document.getElementById('mainIframe');
  }

  function getClientDoc() {
    const frame = getFrame();
    try {
      return frame?.contentDocument || document;
    } catch (_) {
      return document;
    }
  }

  function onlyDigits(value) {
    return String(value ?? '').replace(/\D/g, '');
  }

  function dispatchChange(el) {
    if (!el) return;
    const win = el.ownerDocument.defaultView || window;
    el.dispatchEvent(new win.Event('change', { bubbles: true }));
  }

  /* =========================================================
     CPF / CNPJ
     ========================================================= */

  function formatCpfCnpj(value) {
    const digits = onlyDigits(value).slice(0, 14);

    if (digits.length <= 11) {
      return digits
        .replace(/^(\d{3})(\d)/, '$1.$2')
        .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
        .replace(/\.(\d{3})(\d)/, '.$1-$2');
    }

    return digits
      .replace(/^(\d{2})(\d)/, '$1.$2')
      .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d)/, '.$1/$2')
      .replace(/(\d{4})(\d)/, '$1-$2');
  }

  function setPersonType(doc, wanted) {
    const type = doc.getElementById('ClienteTipoPessoa');
    if (!type || !wanted) return;

    const hasOption = [...type.options].some(option => option.value === wanted);
    if (!hasOption || type.value === wanted) return;

    type.value = wanted;
    dispatchChange(type);
  }

  function clearPersonTypeIfPossible(doc) {
    const type = doc.getElementById('ClienteTipoPessoa');
    if (!type) return;

    const emptyOption = [...type.options].find(option => option.value === '');
    if (!emptyOption || type.value === '') return;

    type.value = '';
    dispatchChange(type);
  }

  function ensureCpfCnpjCapacity(input) {
    if (!input) return;

    // O SATGO pode reduzir novamente o maxlength ao selecionar PF.
    // Mantemos sempre espaço para um CNPJ completo, permitindo apagar
    // um CPF e digitar outro documento sem o campo ficar preso em 11 dígitos.
    if (input.maxLength !== 18) input.maxLength = 18;
  }

  function normalizeCpfCnpj(doc) {
    const input = doc.getElementById('ClienteCGC');
    if (!input) return;

    ensureCpfCnpjCapacity(input);

    const digits = onlyDigits(input.value).slice(0, 14);
    const formatted = formatCpfCnpj(digits);

    if (input.value !== formatted) input.value = formatted;

    if (digits.length === 11) {
      setPersonType(doc, 'PF');
      // A troca para PF pode fazer o SATGO reaplicar limite de CPF.
      ensureCpfCnpjCapacity(input);
      return;
    }

    if (digits.length === 14) {
      setPersonType(doc, 'PJ');
      ensureCpfCnpjCapacity(input);
      return;
    }

    // Documento incompleto: libera a seleção automática, quando houver
    // opção vazia, e mantém o campo apto a receber até 14 dígitos.
    clearPersonTypeIfPossible(doc);
    ensureCpfCnpjCapacity(input);
  }

  function wireCpfCnpj(doc) {
    const input = doc.getElementById('ClienteCGC');
    if (!input || input.dataset[WIRED_ATTR]) return;

    input.dataset[WIRED_ATTR] = '1';
    input.setAttribute('inputmode', 'numeric');
    input.setAttribute('autocomplete', 'off');
    ensureCpfCnpjCapacity(input);

    input.addEventListener('input', () => normalizeCpfCnpj(doc));
    input.addEventListener('paste', () => {
      setTimeout(() => normalizeCpfCnpj(doc), 0);
    });
    input.addEventListener('blur', () => normalizeCpfCnpj(doc));

    normalizeCpfCnpj(doc);
  }

  /* =========================================================
     INSCRIÇÃO ESTADUAL / MUNICIPAL
     ========================================================= */

  function formatGoiasIE(value) {
    const digits = onlyDigits(value).slice(0, 9);

    return digits
      .replace(/^(\d{2})(\d)/, '$1.$2')
      .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d)/, '.$1-$2');
  }

  function formatGoianiaIM(value) {
    // Em Goiânia, a inscrição municipal é o CAE. Os serviços oficiais
    // apresentam o CAE como número de 7 dígitos, sem pontuação.
    return onlyDigits(value).slice(0, 7);
  }

  function isPJ(doc, cnpj) {
    const type = doc.getElementById('ClienteTipoPessoa');
    return cnpj.length === 14 && (!type || /pj|jur[ií]dica/i.test(`${type.value} ${type.options?.[type.selectedIndex]?.text || ''}`));
  }

  function querySintegra(doc, requestedCnpj) {
    const current = doc.getElementById('ClienteCGC');
    const ie = doc.getElementById('ClienteIERG');
    if (!current || !ie || onlyDigits(current.value) !== requestedCnpj || ie.value.trim()) return;
    const request = chrome.runtime.sendMessage({ type: 'CALEBE_SINTEGRA_GO', cnpj: requestedCnpj })
      .then(response => {
        if (!response?.ok) throw new Error(response?.error || 'Resposta inválida do background.');
        const latestCnpj = doc.getElementById('ClienteCGC');
        const latestIe = doc.getElementById('ClienteIERG');
        const value = response.ie || '';
        if (value && latestCnpj && latestIe && onlyDigits(latestCnpj.value) === requestedCnpj && !latestIe.value.trim()) {
          latestIe.value = formatGoiasIE(value);
          const win = latestIe.ownerDocument.defaultView || window;
          latestIe.dispatchEvent(new win.Event('input', { bubbles: true }));
          latestIe.dispatchEvent(new win.Event('change', { bubbles: true }));
        } else if (!value) console.info(LOG, 'Sintegra não retornou IE para o CNPJ informado.');
      })
      .catch(error => console.warn(LOG, 'Consulta Sintegra indisponível:', error.message))
      .finally(() => sintegraRequests.delete(requestedCnpj));
    sintegraRequests.set(requestedCnpj, request);
  }

  function wireSintegraLookup(doc) {
    const button = doc.getElementById('btnBuscarCNPJ');
    if (!button || button.dataset.calebeHelperSintegraWired) return;
    button.dataset.calebeHelperSintegraWired = '1';
    button.addEventListener('click', () => {
      const cnpj = onlyDigits(doc.getElementById('ClienteCGC')?.value);
      if (!isPJ(doc, cnpj) || sintegraRequests.has(cnpj)) return;
      querySintegra(doc, cnpj);
    });
  }

  function wireNumericMask(el, formatter, maxLength, placeholder = '') {
    if (!el || el.dataset[WIRED_ATTR]) return;
    el.dataset[WIRED_ATTR] = '1';
    el.setAttribute('inputmode', 'numeric');
    if (maxLength) el.maxLength = maxLength;
    if (placeholder) el.placeholder = placeholder;

    const normalize = () => {
      const next = formatter(el.value);
      if (el.value !== next) el.value = next;
    };

    el.addEventListener('input', normalize);
    el.addEventListener('paste', () => setTimeout(normalize, 0));
    el.addEventListener('blur', normalize);
    normalize();
  }

  /* =========================================================
     RAZÃO SOCIAL / E-MAIL
     ========================================================= */

  function wireUppercaseField(el) {
    if (!el || el.dataset[WIRED_ATTR]) return;
    el.dataset[WIRED_ATTR] = '1';

    const normalize = () => {
      const next = String(el.value ?? '').toLocaleUpperCase('pt-BR');
      if (el.value !== next) el.value = next;
    };

    el.addEventListener('input', normalize);
    el.addEventListener('paste', () => queueMicrotask(normalize));
    el.addEventListener('blur', normalize);
    normalize();
  }

  function wireLowercaseField(el) {
    if (!el || el.dataset[WIRED_ATTR]) return;
    el.dataset[WIRED_ATTR] = '1';

    const normalize = () => {
      const next = String(el.value ?? '').toLocaleLowerCase('pt-BR');
      if (el.value !== next) el.value = next;
    };

    el.addEventListener('input', normalize);
    el.addEventListener('paste', () => queueMicrotask(normalize));
    el.addEventListener('blur', normalize);
    normalize();
  }

  function wireEmailSuggestions(doc) {
    const input = doc.querySelector('[name="ClienteEmail"]');
    if (!input) return;
    const listId = 'calebe-helper-clientes-email-sugestoes';
    let list = doc.getElementById(listId);
    if (!list) {
      list = doc.createElement('datalist');
      list.id = listId;
      for (const email of EMAIL_SUGGESTIONS) {
        const option = doc.createElement('option');
        option.value = email;
        list.appendChild(option);
      }
      doc.body.appendChild(list);
    }
    input.setAttribute('list', listId);
    input.setAttribute('autocomplete', 'off');
  }

  /* =========================================================
     ENDEREÇO — EVITA TEXTO INTEIRO EM MAIÚSCULAS
     ========================================================= */

  const LOWERCASE_WORDS = new Set([
    'a', 'as', 'o', 'os',
    'de', 'da', 'das', 'do', 'dos',
    'e', 'em', 'na', 'nas', 'no', 'nos'
  ]);

  function isAllUpperText(value) {
    const letters = String(value ?? '').replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, '');
    return letters.length > 1 && letters === letters.toLocaleUpperCase('pt-BR');
  }

  function smartAddressCase(value) {
    const raw = String(value ?? '').trim();
    if (!raw || !isAllUpperText(raw)) return raw;

    return raw
      .toLocaleLowerCase('pt-BR')
      .split(/(\s+)/)
      .map((part, index) => {
        if (/^\s+$/.test(part)) return part;

        // Mantém abreviações curtas comuns: QD, LT, AV, R, ST etc.
        const lettersOnly = part.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, '');
        if (lettersOnly && lettersOnly.length <= 3 && !LOWERCASE_WORDS.has(lettersOnly)) {
          return part.toLocaleUpperCase('pt-BR');
        }

        const lower = part.toLocaleLowerCase('pt-BR');
        if (index > 0 && LOWERCASE_WORDS.has(lower)) return lower;

        return lower.replace(
          /^([A-Za-zÀ-ÖØ-öø-ÿ])/,
          char => char.toLocaleUpperCase('pt-BR')
        );
      })
      .join('');
  }

  function wireAddressField(el) {
    if (!el || el.dataset[WIRED_ATTR]) return;
    el.dataset[WIRED_ATTR] = '1';

    const normalize = () => {
      const next = smartAddressCase(el.value);
      if (el.value !== next) el.value = next;
    };

    // Não interfere enquanto o usuário digita; corrige ao sair ou após colar.
    el.addEventListener('blur', normalize);
    el.addEventListener('paste', () => {
      setTimeout(normalize, 0);
    });
  }

  /* =========================================================
     TELEFONE / CELULAR / FAX
     Baseado no comportamento do client(2).js:
     - aceita +55
     - DDD padrão 62 para número local
     - celular local de 8 dígitos recebe o 9
     ========================================================= */

  function stripBrazilCountryCode(raw) {
    let digits = onlyDigits(raw);
    const original = String(raw ?? '').trim();

    if ((original.startsWith('+55') || digits.length > 11) && digits.startsWith('55')) {
      digits = digits.slice(2);
    }

    return digits;
  }

  function formatMobileComplete(raw) {
    let digits = stripBrazilCountryCode(raw);

    if (digits.length === 8) {
      digits = DEFAULT_DDD + '9' + digits;
    } else if (digits.length === 9) {
      digits = DEFAULT_DDD + digits;
    } else if (digits.length === 10) {
      // Mesmo princípio do client(2).js: DDD + 8 dígitos locais -> insere o 9.
      digits = digits.slice(0, 2) + '9' + digits.slice(2);
    }

    digits = digits.slice(0, 11);
    if (digits.length !== 11) return raw;

    const ddd = digits.slice(0, 2);
    const local = digits.slice(2);

    return `(${ddd}) ${local[0]} ${local.slice(1, 5)}-${local.slice(5, 9)}`;
  }

  function formatLandlineComplete(raw) {
    let digits = stripBrazilCountryCode(raw);

    if (digits.length === 8) {
      digits = DEFAULT_DDD + digits;
    }

    digits = digits.slice(0, 10);
    if (digits.length !== 10) return raw;

    const ddd = digits.slice(0, 2);
    const local = digits.slice(2);

    return `(${ddd}) ${local.slice(0, 4)}-${local.slice(4, 8)}`;
  }

  function formatMobileTyping(raw) {
    let digits = stripBrazilCountryCode(raw).slice(0, 11);

    if (!digits) return '';
    if (digits.length <= 2) return `(${digits}`;
    if (digits.length <= 3) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;

    const ddd = digits.slice(0, 2);
    const local = digits.slice(2);

    if (local.length <= 1) return `(${ddd}) ${local}`;
    if (local.length <= 5) return `(${ddd}) ${local[0]} ${local.slice(1)}`;
    return `(${ddd}) ${local[0]} ${local.slice(1, 5)}-${local.slice(5, 9)}`;
  }

  function formatLandlineTyping(raw) {
    let digits = stripBrazilCountryCode(raw).slice(0, 10);

    if (!digits) return '';
    if (digits.length <= 2) return `(${digits}`;

    const ddd = digits.slice(0, 2);
    const local = digits.slice(2);

    if (local.length <= 4) return `(${ddd}) ${local}`;
    return `(${ddd}) ${local.slice(0, 4)}-${local.slice(4, 8)}`;
  }

  function wirePhone(el, kind) {
    if (!el || el.dataset[WIRED_ATTR]) return;
    el.dataset[WIRED_ATTR] = '1';
    el.setAttribute('inputmode', 'tel');

    const typingFormatter = kind === 'mobile'
      ? formatMobileTyping
      : formatLandlineTyping;

    const completeFormatter = kind === 'mobile'
      ? formatMobileComplete
      : formatLandlineComplete;

    const onInput = () => {
      const next = typingFormatter(el.value);
      if (next !== el.value) el.value = next;
    };

    const onBlur = () => {
      if (!onlyDigits(el.value)) {
        el.value = kind === 'mobile' ? EMPTY_MOBILE : (kind === 'fax' ? '' : EMPTY_LANDLINE);
        return;
      }
      const next = completeFormatter(el.value);
      if (next !== el.value) el.value = next;
    };

    el.addEventListener('input', onInput);
    el.addEventListener('focus', () => {
      if (el.value === EMPTY_LANDLINE || el.value === EMPTY_MOBILE) el.select();
    });
    el.addEventListener('paste', () => setTimeout(onBlur, 0));
    el.addEventListener('blur', onBlur);

    onBlur();
  }

  /* =========================================================
     AVISO DE ANIVERSÁRIO
     ========================================================= */

  function isBirthdayWarningText(text) {
    const normalized = String(text ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('pt-BR');

    return normalized.includes('nenhum aniversariante informado') || (normalized.includes('anivers') &&
      (
        normalized.includes('nao existe') ||
        normalized.includes('nao ha') ||
        normalized.includes('sem inform') ||
        normalized.includes('nenhuma inform') ||
        normalized.includes('informacao')
      ));
  }

  function suppressClientWarnings(doc) {
    const ok = doc.getElementById('btnAlertaOk') || doc.getElementById('calConfirmOk');
    if (!ok || ok.dataset[BIRTHDAY_HANDLED_ATTR]) return false;

    const candidates = [
      ok.closest('.modal'),
      ok.closest('[role="dialog"]'),
      ok.parentElement?.parentElement,
      ok.parentElement
    ].filter(Boolean);

    const dialog = candidates.find(el => {
      const text = String(el.textContent || '');
      return isBirthdayWarningText(text) || /possível cadastro duplicado/i.test(text);
    });
    if (!dialog) return false;

    ok.dataset[BIRTHDAY_HANDLED_ATTR] = '1';

    // O aviso é apenas informativo/confirmatório; confirma automaticamente
    // para que o salvamento siga sem exigir interação.
    setTimeout(() => {
      try {
        if (ok.isConnected) ok.click();
      } finally {
        delete ok.dataset[BIRTHDAY_HANDLED_ATTR];
      }
    }, 0);

    return true;
  }

  function installBirthdayObserver(doc) {
    if (!doc?.documentElement || doc.documentElement.dataset.calebeHelperBirthdayObserver) {
      return;
    }

    doc.documentElement.dataset.calebeHelperBirthdayObserver = '1';

    const observer = new MutationObserver(() => {
      suppressClientWarnings(doc);
    });

    observer.observe(doc.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style']
    });

    suppressClientWarnings(doc);
  }

  /* =========================================================
     NORMALIZAÇÃO ANTES DE SALVAR
     ========================================================= */

  function normalizeBeforeSubmit(doc) {
    normalizeCpfCnpj(doc);

    const ie = doc.getElementById('ClienteIERG');
    if (ie) ie.value = formatGoiasIE(ie.value);

    const im = doc.getElementById('ClienteIM');
    if (im) im.value = formatGoianiaIM(im.value);

    const razao = doc.querySelector('[name="ClienteRazaoSocial"]');
    if (razao) {
      razao.value = String(razao.value ?? '').toLocaleUpperCase('pt-BR');
    }

    const email = doc.querySelector('[name="ClienteEmail"]');
    if (email) {
      email.value = String(email.value ?? '').toLocaleLowerCase('pt-BR');
    }

    const site = doc.querySelector('[name="ClienteSite"]');
    if (site) {
      site.value = String(site.value ?? '').toLocaleLowerCase('pt-BR');
    }

    const mobile = doc.querySelector('[name="ClienteCelular"]');
    if (mobile) mobile.value = onlyDigits(mobile.value) ? formatMobileComplete(mobile.value) : EMPTY_MOBILE;

    for (const name of ['ClienteFone1', 'ClienteFax']) {
      const el = doc.querySelector(`[name="${name}"]`);
      if (el) el.value = onlyDigits(el.value) ? formatLandlineComplete(el.value) :
        (name === 'ClienteFone1' ? EMPTY_LANDLINE : '');
    }

    for (const name of ['ClienteLogradouro', 'ClienteComplemento', 'ClienteBairro']) {
      const el = doc.querySelector(`[name="${name}"]`);
      if (el?.value) el.value = smartAddressCase(el.value);
    }
  }

  function wireForm(doc) {
    const form = doc.getElementById('formClifor');
    if (!form || form.dataset[WIRED_ATTR]) return false;

    form.dataset[WIRED_ATTR] = '1';

    wireCpfCnpj(doc);
    wireNumericMask(doc.getElementById('ClienteIERG'), formatGoiasIE, 12, '00.000.000-0');
    wireNumericMask(doc.getElementById('ClienteIM'), formatGoianiaIM, 7, '0000000');
    wireUppercaseField(doc.querySelector('[name="ClienteRazaoSocial"]'));
    wireLowercaseField(doc.querySelector('[name="ClienteEmail"]'));
    wireEmailSuggestions(doc);
    wireLowercaseField(doc.querySelector('[name="ClienteSite"]'));
    wireSintegraLookup(doc);

    wirePhone(doc.querySelector('[name="ClienteFone1"]'), 'landline');
    wirePhone(doc.querySelector('[name="ClienteCelular"]'), 'mobile');
    wirePhone(doc.querySelector('[name="ClienteFax"]'), 'fax');

    wireAddressField(doc.querySelector('[name="ClienteLogradouro"]'));
    wireAddressField(doc.querySelector('[name="ClienteComplemento"]'));
    wireAddressField(doc.querySelector('[name="ClienteBairro"]'));

    form.addEventListener('submit', () => {
      normalizeBeforeSubmit(doc);
      // O aviso pode ser criado logo após a tentativa de submit.
      setTimeout(() => suppressClientWarnings(doc), 0);
    }, true);

    installBirthdayObserver(doc);

    console.info(LOG, 'Padronizações instaladas no formulário de cliente.');
    return true;
  }

  function install() {
    const doc = getClientDoc();
    if (!doc || doc === document) return false;

    wireForm(doc);
    return true;
  }

  function wireFrame() {
    const frame = getFrame();
    if (!frame || frame.dataset.calebeHelperCamposClienteFrame) return;

    frame.dataset.calebeHelperCamposClienteFrame = '1';

    frame.addEventListener('load', () => {
      install();
    });
  }

  function initialize() {
    wireFrame();
    install();

    const observer = new MutationObserver(() => {
      wireFrame();
      install();
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  initialize();
})();

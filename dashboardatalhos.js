// dashboardatalhos.js
(() => {
    'use strict';

    const STYLE_ID = 'calebe-helper-dashboard-atalhos-style';
    const CONTAINER_ID = 'calebe-helper-dashboard-atalhos';

    const SHORTCUT_COLORS = {
        atualizar: { background: '#ffffff', color: '#4a5a78', iconColor: '#8a9abc', hoverBackground: '#EEF0F1', hoverColor: '#3B4046' },
        clientes: { background: '#ffffff', color: '#4a5a78', iconColor: '#8a9abc', hoverBackground: '#ecf4ff', hoverColor: '#3B4046' },
        davs: { background: '#ffffff', color: '#4a5a78', iconColor: '#8a9abc', hoverBackground: '#eaffe8', hoverColor: '#3B4046' },
        nfe: { background: '#ffffff', color: '#4a5a78', iconColor: '#b4bbc9', hoverBackground: '#f6e9fd', hoverColor: '#3B4046' },
        complementar: { background: '#ffffff', color: '#4a5a78', iconColor: '#8a9abc', hoverBackground: '#dfe3ff', hoverColor: '#3B4046' }
    };

    let pendingAction = null;


    /* =========================================================
       CSS
       ========================================================= */

    const CSS = `
        #${CONTAINER_ID} {
            display: flex;
            flex-wrap: nowrap;
            align-items: center;
            gap: 12px;
            margin: 0 12px 0 auto;
            min-width: 0;
            flex: 0 1 auto;
        }

        #${CONTAINER_ID} .calebe-atalho-grupo {
            display: inline-flex;
            align-items: stretch;
            height: 34px;
            background: #fff;
            border: 1px solid #e4e4e4;
            border-radius: 8px;
            overflow: hidden;
        }

        #${CONTAINER_ID} .calebe-dashboard-atalho {
            box-sizing: border-box;
            height: 34px;
            padding: 4px 10px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            color: var(--calebe-atalho-color, #495057);
            background: var(--calebe-atalho-bg, #fff);
            border: 0;
            text-decoration: none;
            white-space: nowrap;
            font-size: 12px;
            font-weight: 500;
            line-height: 1;
            cursor: pointer;
            transition: color 0.15s ease, background-color 0.15s ease, border-color 0.15s ease;
        }

        #${CONTAINER_ID} .calebe-dashboard-atalho i {
            color: var(--calebe-atalho-icon-color, #0d6efd);
            font-size: 15px;
            line-height: 1;
            flex: 0 0 auto;
        }

        #${CONTAINER_ID} .calebe-dashboard-atalho:hover {
            color: var(--calebe-atalho-hover-color, #0d6efd);
            background: var(--calebe-atalho-hover-bg, #f5f9ff);
            text-decoration: none;
        }

        #${CONTAINER_ID} > .calebe-dashboard-atalho {
            border: 1px solid #e4e4e4;
            border-radius: 8px;
        }

        #${CONTAINER_ID} .calebe-atalho-acao {
            box-sizing: border-box;
            height: 34px;
            width: 34px;
            padding: 4px 8px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            text-align: center;
            gap: 4px;
            border: 0;
            border-left: 1px solid rgba(0,0,0,0.1);
            white-space: nowrap;
            font-size: 11px;
            font-weight: 600;
            cursor: pointer;
            transition: background-color 0.15s ease, color 0.15s ease;
        }

        #${CONTAINER_ID} .calebe-atalho-acao i {
            color: inherit;
            font-size: 12px;
            line-height: 1;
        }

        #${CONTAINER_ID} .calebe-acao-primary { color: #3783FD; background: #d9e9ff; }
        #${CONTAINER_ID} .calebe-acao-primary:hover { color: #2863c1; background: #c9e0ff; }
        #${CONTAINER_ID} .calebe-acao-success { color: #42BD83; background: #d3fbd0; }
        #${CONTAINER_ID} .calebe-acao-success:hover { color: #2b7a55; background: #cff5cc; }

        #${CONTAINER_ID} a:focus,
        #${CONTAINER_ID} button:focus {
            position: relative;
            z-index: 3;
            outline: 0;
            box-shadow: inset 0 0 0 2px rgba(13, 110, 253, 0.35);
        }

        #${CONTAINER_ID} button:active,
        #${CONTAINER_ID} a:active { filter: brightness(0.96); }

        @media (max-width: 1180px) {
            #${CONTAINER_ID} { display: none !important; }
        }
    `;


    /* =========================================================
       DOCUMENTO PRINCIPAL / IFRAME
       ========================================================= */

    function getMainIframe() {
        return document.getElementById('mainIframe');
    }


    function getFrameDocument() {
        const iframe = getMainIframe();

        if (!iframe) {
            return null;
        }

        try {
            return iframe.contentDocument;
        } catch {
            return null;
        }
    }


    /* =========================================================
       CSS
       ========================================================= */

    function installStyle(doc) {
        if (!doc) {
            return;
        }

        if (doc.getElementById(STYLE_ID)) {
            return;
        }

        const root = doc.head || doc.documentElement;

        if (!root) {
            return;
        }

        const style = doc.createElement('style');

        style.id = STYLE_ID;
        style.textContent = CSS;

        root.appendChild(style);
    }


    /* =========================================================
       LOCALIZAÇÃO DOS LINKS NATIVOS DO MENU
       ========================================================= */

    function findNativeMenuLink({
        hrefContains = null,
        title = null
    }) {
        const links = document.querySelectorAll(
            'a.nav-link-l2'
        );

        for (const link of links) {

            if (
                hrefContains &&
                link.getAttribute('href')?.includes(hrefContains)
            ) {
                return link;
            }

            if (
                title &&
                link.getAttribute('title') === title
            ) {
                return link;
            }
        }

        return null;
    }


    /* =========================================================
       CLIQUE NO MENU NATIVO
       ========================================================= */

    function clickNativeMenuLink(config) {
        const link = findNativeMenuLink(config);

        if (!link) {
            console.warn(
                '[Calebe Helper] Item do menu não encontrado.'
            );

            return false;
        }

        link.click();

        return true;
    }


    /* =========================================================
       NAVEGAÇÕES
       ========================================================= */

    function openClients() {
        pendingAction = null;

        clickNativeMenuLink({
            hrefContains: 'modulos/clca01/clca01.php'
        });
    }


    function openDavs() {
        pendingAction = null;

        clickNativeMenuLink({
            hrefContains: 'modulos/dav01/dav01.php'
        });
    }


    function openNfe() {
        pendingAction = null;

        clickNativeMenuLink({
            hrefContains: 'modulos/nfe001/nfe001.php'
        });
    }


    function openComplementaryInvoice() {
        pendingAction = null;

        clickNativeMenuLink({
            title: 'Emissor Nota Complementar'
        });
    }


    /* =========================================================
       NOVO CLIENTE
       ========================================================= */

    function openNewClient() {
        pendingAction = 'new-client';

        const opened = clickNativeMenuLink({
            hrefContains: 'modulos/clca01/clca01.php'
        });

        if (!opened) {
            pendingAction = null;
        }
    }


    function executeNewClient(doc) {
        const button = doc.querySelector(
            'a.btn.btn-primary[href^="clca01_form.php?acao=novo"]'
        );

        if (!button) {
            return false;
        }

        pendingAction = null;

        button.click();

        return true;
    }


    /* =========================================================
       NOVO DAV
       ========================================================= */

    function openNewDav() {
        pendingAction = 'new-dav';

        const opened = clickNativeMenuLink({
            hrefContains: 'modulos/dav01/dav01.php'
        });

        if (!opened) {
            pendingAction = null;
        }
    }


    function executeNewDav(doc) {
        const button = doc.getElementById('btnNovoDav');

        if (!button) {
            return false;
        }

        if (button.disabled) {
            return false;
        }

        pendingAction = null;

        /*
         * Clicamos no botão original.
         *
         * Portanto continua sendo executado:
         *
         * onclick="novoDav()"
         */
        button.click();

        return true;
    }


    /* =========================================================
       AÇÃO PENDENTE
       ========================================================= */

    function executePendingAction(doc) {
        if (!pendingAction || !doc) {
            return;
        }

        if (pendingAction === 'new-client') {
            executeNewClient(doc);
            return;
        }

        if (pendingAction === 'new-dav') {
            executeNewDav(doc);
        }
    }


    /* =========================================================
       COMPONENTES
       ========================================================= */

    function createShortcut(
        doc,
        {
            text,
            icon,
            title,
            onClick,
            colorKey = null
        }
    ) {
        const link = doc.createElement('a');

        link.href = '#';
        link.className = 'calebe-dashboard-atalho';
        link.title = title || text;

        const colorConfig = colorKey ? SHORTCUT_COLORS[colorKey] : null;

        if (colorConfig) {
            link.style.setProperty('--calebe-atalho-bg', colorConfig.background);
            link.style.setProperty('--calebe-atalho-color', colorConfig.color);
            link.style.setProperty('--calebe-atalho-icon-color', colorConfig.iconColor);
            link.style.setProperty('--calebe-atalho-hover-bg', colorConfig.hoverBackground);
            link.style.setProperty('--calebe-atalho-hover-color', colorConfig.hoverColor);
        }

        const iconElement = doc.createElement('i');

        iconElement.className = `bi ${icon}`;
        iconElement.setAttribute(
            'aria-hidden',
            'true'
        );

        const label = doc.createElement('span');

        label.textContent = text;

        link.appendChild(iconElement);
        link.appendChild(label);

        link.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();

            onClick();
        });

        return link;
    }


    function createActionButton(
        doc,
        {
            text,
            variant,
            title,
            onClick
        }
    ) {
        const button = doc.createElement('button');

        button.type = 'button';

        button.className =
            `calebe-atalho-acao calebe-acao-${variant}`;

        button.title = title || text;


        const icon = doc.createElement('i');

        icon.className = 'bi bi-plus-lg';
        icon.setAttribute(
            'aria-hidden',
            'true'
        );


        const label = doc.createElement('span');

        label.textContent = text;


        button.appendChild(icon);
        if (text) button.appendChild(label);


        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();

            onClick();
        });


        return button;
    }


    function createGroup(
        doc,
        shortcut,
        action
    ) {
        const group = doc.createElement('div');

        group.className = 'calebe-atalho-grupo';

        group.appendChild(shortcut);
        group.appendChild(action);

        return group;
    }


    /* =========================================================
       ATUALIZAR / TOPBAR
       ========================================================= */

    const REFRESH_SIDEBAR_ID =
        'calebe-helper-sidebar-atualizar';


    function removeLegacySidebarRefresh() {
        document.getElementById(REFRESH_SIDEBAR_ID)?.remove();
    }


    function removeShortcuts() {
        document.getElementById(CONTAINER_ID)?.remove();
    }


    function createRefreshShortcut(doc) {
        return createShortcut(doc, {
            text: 'Atualizar',
            icon: 'bi-arrow-clockwise',
            title: 'Atualizar (F5)',
            colorKey: 'atualizar',
            onClick: () => window.location.reload()
        });
    }



    /* =========================================================
       INSTALAÇÃO DOS ATALHOS
       ========================================================= */

    function installShortcuts() {
        /*
         * Os atalhos pertencem ao documento principal do CALWEB.
         * Eles devem permanecer disponíveis independentemente da
         * página atualmente carregada em #mainIframe.
         */
        const topbar = document.getElementById('topbar');
        const topbarRight = topbar?.querySelector(':scope > .topbar-right');

        if (!topbar || !topbarRight) {
            return false;
        }

        let container = document.getElementById(CONTAINER_ID);

        if (!container) {
            container = document.createElement('div');
            container.id = CONTAINER_ID;

            container.appendChild(createRefreshShortcut(document));

            const clients = createShortcut(document, {
                text: 'Clientes/Fornecedores',
                icon: 'bi-people',
                title: 'Clientes/Fornecedores',
                colorKey: 'clientes',
                onClick: openClients
            });

            const newClient = createActionButton(document, {
                /* text: 'Novo', */
                text: '',
                variant: 'primary',
                title: 'Novo cliente/fornecedor',
                onClick: openNewClient
            });

            container.appendChild(createGroup(document, clients, newClient));

            const dav = createShortcut(document, {
                text: 'DAVs',
                icon: 'bi-grid',
                title: 'DAVs',
                colorKey: 'davs',
                onClick: openDavs
            });

            const newDav = createActionButton(document, {
                /* text: 'Novo', */
                text: '',
                variant: 'success',
                title: 'Novo DAV',
                onClick: openNewDav
            });

            container.appendChild(createGroup(document, dav, newDav));

            container.appendChild(createShortcut(document, {
                text: 'Emissor NF-e / NFC-e',
                icon: 'bi-receipt',
                title: 'Emissor NF-e / NF-ce',
                colorKey: 'nfe',
                onClick: openNfe
            }));

            container.appendChild(createShortcut(document, {
                text: 'Nota Complementar',
                icon: 'bi-file-earmark-text',
                title: 'Emissor Nota Complementar',
                colorKey: 'complementar',
                onClick: openComplementaryInvoice
            }));
        }

        if (container.parentNode !== topbar ||
            container.nextElementSibling !== topbarRight) {
            topbar.insertBefore(container, topbarRight);
        }

        return true;
    }



    /* =========================================================
       PÁGINA DO IFRAME CARREGADA
       ========================================================= */

    function handleCurrentPage() {
        const doc = getFrameDocument();

        installStyle(document);
        removeLegacySidebarRefresh();
        installShortcuts();

        if (!doc?.documentElement) {
            return;
        }

        /*
         * O iframe continua sendo acompanhado somente para concluir
         * ações pendentes, como Novo Cliente e Novo DAV.
         * A existência dos atalhos não depende mais da página do iframe.
         */
        executePendingAction(doc);
    }



    /* =========================================================
       IFRAME
       ========================================================= */

    function bindIframe(iframe) {
        if (!iframe) {
            return;
        }

        if (
            iframe.dataset
                .calebeDashboardAtalhosBound === '1'
        ) {
            handleCurrentPage();

            return;
        }

        iframe.dataset
            .calebeDashboardAtalhosBound = '1';


        iframe.addEventListener(
            'load',
            handleCurrentPage
        );


        /*
         * Trata também a página que já estiver carregada.
         */
        handleCurrentPage();
    }


    /* =========================================================
       INICIALIZAÇÃO
       ========================================================= */

    function initialize() {
        installStyle(document);
        removeLegacySidebarRefresh();
        installShortcuts();

        const iframe = getMainIframe();

        if (iframe) {
            bindIframe(iframe);
        }
    }


    initialize();


    /* =========================================================
       PROTEÇÃO CASO O IFRAME SEJA RECRIADO
       ========================================================= */

    const observer =
        new MutationObserver(() => {

            removeLegacySidebarRefresh();
            installShortcuts();

            const iframe = getMainIframe();

            if (iframe) {
                bindIframe(iframe);
            }
        });


    observer.observe(
        document.documentElement,
        {
            childList: true,
            subtree: true
        }
    );

})();

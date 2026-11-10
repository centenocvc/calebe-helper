# Calebe Helper — documentação de continuidade

**Atualização:** 03/11/2026  
**Sistema:** Calweb / SATGO — `https://s1.satgo.com.br/calweb`  
**Projeto:** extensão Google Chrome Manifest V3  
**Descrição:** `Importação do Excel e automação assistida de DAVs no Calebe`

> Este documento consolida decisões e diagnósticos registrados nas conversas. Ele não substitui a conferência dos arquivos atuais. Implementações propostas ou discutidas, mas não confirmadas em um pacote instalado, estão identificadas como pendentes de validação.

## 1. Objetivo do projeto

O Calebe Helper acrescenta ao Calweb recursos de importação de planilhas, preenchimento assistido de DAVs, pesquisa e tratamento de cadastros de clientes, duplicação de cadastros, atalhos e automações de etapas repetitivas.

Princípios definidos durante o desenvolvimento:

- Manter os recursos separados em módulos JavaScript.
- Corrigir uma função sem reescrever ou remover partes não relacionadas.
- Preservar funções existentes e evitar regressões.
- Não presumir que o DOM do Calweb continua igual após atualizações do sistema.
- Inspecionar o HTML real antes de definir seletores.
- Entregar arquivos JavaScript modificados também em ZIP.
- Registrar versão, arquivos alterados, testes e pendências.

## 2. Ambiente e arquitetura

- Navegador: Google Chrome.
- Plataforma: Calweb/SATGO.
- URL principal: `https://s1.satgo.com.br/calweb`.
- Extensão: Manifest V3.
- Arquivos centrais: `manifest.json`, `popup.html`, `sw.js` e scripts de conteúdo.
- O Calweb utiliza iframes e navegação dinâmica. Os módulos não podem presumir que a tela ativa está sempre no documento principal.

### Estrutura lógica de módulos identificados

A lista abaixo reúne arquivos mencionados em diferentes versões; nem todos necessariamente estão presentes em todas elas.

```text
Calebe Helper/
├── manifest.json
├── popup.html
├── sw.js
├── clientedav.js
├── clientecadastro.js
├── clientecampos.js
├── clienteduplicar.js
├── clientepesquisa.js
├── dav1.js
├── dashboardatalhos.js
├── fillexcel_modal.js
├── novodav.js
├── novodav_emitir.js
└── xml-downloader.js
```

### Manifesto

A ordem de carregamento pode importar quando um módulo depende de elementos ou funções de outro. Uma ordem de referência registrada anteriormente foi:

```json
[
  "clientedav.js",
  "clientecadastro.js",
  "clienteduplicar.js",
  "clientepesquisa.js",
  "dav1.js",
  "dashboardatalhos.js",
  "fillexcel_modal.js",
  "xml-downloader.js"
]
```

Em versões posteriores foram trabalhados também `clientecampos.js`, `novodav.js` e `novodav_emitir.js`. O módulo `novodav_emitir.js` foi planejado para ser declarado depois de `dav1.js`, pois utiliza o botão `.calebe-helper-caixa-dav` criado/fornecido pelo fluxo de DAV.

Permissões já utilizadas ou discutidas: `storage`, `activeTab`, `tabs`, `scripting` e host permission para SATGO/Calweb. Conferir o manifesto real antes de modificar permissões.

## 3. Histórico resumido

### 3.1 Primeira ideia: importação do Excel

O primeiro fluxo previa colar dados de uma planilha e preencher o Calweb por linha.

Mapeamento informado:

| Coluna | Conteúdo |
|---|---|
| A | Valor total |
| B | Quantidade |
| C | OC / observação |
| D | Código do cliente |

O mapeamento automático por clique não se mostrou confiável. A preferência passou a ser informar manualmente os IDs/seletores e o trajeto de cada etapa. Foi trabalhada uma interface com seletores CSS editáveis e ações para testar, focar e salvar.

Atalhos registrados em uma versão inicial:
- `F3`: focar o campo de OC/observação.
- `F2`: ocultar/mostrar o painel.

### 3.2 Integração cliente/DAV

Foi mencionada a API interna:

```js
window.calebeHelperClientDav.createDavForClient(...)
```

A assinatura e a implementação atuais precisam ser conferidas em `clientedav.js` antes de reutilizá-la.

### 3.3 Robustez do contexto da extensão

`fillexcel_modal.js` recebeu proteções para situações de `Extension context invalidated`, incluindo operações envolvendo `chrome.runtime`, `chrome.storage`, listeners, bridge/injeção e `clampGeometry`.

Após atualizar a extensão, o procedimento registrado foi recarregar a extensão no Chrome e atualizar o Calweb com F5.

### 3.4 Versões

O histórico identifica Calebe Helper v1.5.3 como versão-base de diagnóstico e registra a preparação de um pacote v1.5.10 contendo `novodav_emitir.js`. Isso não confirma qual versão está instalada atualmente. Sempre conferir `manifest.json` e o ZIP efetivamente utilizado.

## 4. Módulos

### `popup.html`
Interface do popup. A lógica operacional do Calweb deve permanecer nos módulos apropriados, não concentrada desnecessariamente no popup.

### `sw.js`
Service worker Manifest V3. Deve conter operações de background, sem depender diretamente do DOM das páginas.

### `fillexcel_modal.js`
Módulo da importação Excel e do painel/modal de preenchimento.

Responsabilidades conhecidas:
- receber/importar dados;
- exibir dados por linha;
- preencher campos do DAV;
- controlar painel e geometria;
- comunicar-se com a página por bridge quando necessário;
- lidar com contexto da extensão invalidado.

Problemas e requisitos já registrados:
- flags/campos de itens nem sempre atualizam o total da nota;
- em alguns casos foi usado ajuste da quantidade como fallback;
- uma correção de fluxo identificada como v1.57 resolveu parte do preenchimento, mas perdeu comportamento de minimizar/restaurar;
- foi solicitado pausar o processo quando o Calweb perde o foco e retomar quando o foco voltar.

**Regressão obrigatória:** ao corrigir o preenchimento, testar também minimizar/restaurar, pausa/retomada, quantidade, valores, observação e total final.

### `clientepesquisa.js` — prioridade de aprimoramento

Este é um dos principais pontos que o usuário deseja aprimorar.

#### Diagnóstico registrado

**No dashboard inicial:**
- existe `#mainIframe`;
- título do iframe: Dashboard;
- `formFiltro` existe;
- `input[name="q"]` não existe;
- `select[name="campo"]` não existe;
- nenhum card foi encontrado.

**Depois de abrir Clientes/Fornecedores pelo menu:**
- seletor do link: `a.nav-link-l2[title="Clientes/Fornecedores"]`;
- destino observado: `modulos/clca01/clca01.php`;
- navegação realizada por `abrirIframe`;
- título do iframe: `Clientes / Fornecedores — calweb`;
- `formFiltro` existe;
- `input[name="q"]` existe;
- `select[name="campo"]` existe;
- foi encontrado 1 card.

**Conclusão:** não inicializar a pesquisa de clientes presumindo que o dashboard já contém os campos reais. A pesquisa deve detectar a tela Clientes/Fornecedores no iframe correto, após a navegação.

Campos de cadastro que não foram encontrados naquele diagnóstico:
- `ClienteRazaoSocial`
- `ClienteNomeFantazia` (grafia observada)
- `ClienteCGC`
- `ClienteMunicipio`
- `ClienteCodigo`

A ausência desses campos naquele documento/estado não prova que os IDs sejam inválidos em todas as telas.

#### Próximos passos para aprimorar a pesquisa

1. Separar a detecção do dashboard da detecção da tela Clientes/Fornecedores.
2. Detectar a navegação por `abrirIframe`/mudança do iframe e aguardar o documento correto.
3. Localizar `formFiltro`, `input[name="q"]` e `select[name="campo"]` dentro do documento do iframe.
4. Inspecionar as opções de `select[name="campo"]`, registrando `value` e texto visível.
5. Identificar o botão/ação real que executa a pesquisa.
6. Inspecionar a estrutura dos resultados e como selecionar/abrir um cliente.
7. Tratar carregamento tardio, troca de documento do iframe, retorno ao dashboard e reabertura da tela.
8. Evitar listeners duplicados e injeção repetida.
9. Testar clientes encontrados, não encontrados, nomes semelhantes e os identificadores que o próprio filtro realmente oferecer.
10. Não inventar IDs de cadastro: inspecionar o DOM atual antes de preencher campos.

**Dados ainda necessários:** HTML atual do formulário de filtro, opções do select, botão de pesquisa e estrutura de um resultado. O diagnóstico anterior não contém esses detalhes.

#### Roteiro de diagnóstico do DOM

Ao retomar, registrar no console, no documento do iframe correto:
- URL e título;
- quantidade de iframes e títulos;
- existência de `formFiltro`;
- atributos de `input[name="q"]`;
- opções de `select[name="campo"]` (`value` e texto);
- botão que executa a pesquisa;
- estrutura de um resultado;
- ação executada ao selecionar o resultado.

Usar dados fictícios ou ocultar CPF/CNPJ e outros dados pessoais nos logs.

#### Casos de teste

| Caso | Resultado esperado |
|---|---|
| Pesquisar por código | Encontrar o cliente correto, se o filtro oferecer essa modalidade |
| Pesquisar por razão social | Exibir correspondências |
| Pesquisar por nome fantasia | Exibir correspondências, se disponível |
| Pesquisar por CPF/CNPJ | Encontrar o cadastro, se disponível |
| Nenhum resultado | Exibir estado vazio sem travar |
| Resultados semelhantes | Permitir identificar o registro correto |
| Reabrir a tela | Funcionar sem duplicar listeners |
| Voltar ao dashboard | Não pesquisar no documento errado |

Os tipos de pesquisa acima são casos a verificar, não uma afirmação de que todos estejam disponíveis no Calweb.

### `clientecadastro.js`

Detalhes confirmados do fluxo de novo cadastro SATGO:
- formulário: `#formClifor`;
- action: `clca01_form.php`;
- método: `POST`;
- `acao=salvar`;
- `id=0` para novo cadastro.

Os botões nativos “Salvar” foram observados como `button.btn.btn-primary`, fora do formulário. Eles disparam o submit por:

```js
formClifor.dispatchEvent(
  new Event('submit', { bubbles: true, cancelable: true })
);
```

Regra definida:
- `id === "0"`: novo cadastro;
- ID maior que zero: cadastro existente.

Não presumir que os botões Salvar estejam dentro de `#formClifor`.

### `clienteduplicar.js`

Problema relatado: `.calebe-duplicar-principal` não estava duplicando o cadastro mantendo o original.

A suspeita foi direcionada a `clienteduplicar.js`, em contraste com `clientecadastro.js`, mas a causa não foi confirmada.

Testar:
1. selecionar um cadastro de referência;
2. duplicar;
3. confirmar que o original permanece intacto;
4. confirmar que o novo formulário representa um cadastro novo;
5. verificar cópia dos campos;
6. testar o submit nativo;
7. verificar conflito com `clientecadastro.js` ou `clientecampos.js`.

### `clientecampos.js`

Arquivo presente em versões posteriores e relacionado a campos do cliente. Responsabilidade exata e seletores atuais precisam ser conferidos no fonte. Não atribuir funções não verificadas.

### `clientedav.js`

Integração entre cliente e DAV. Foi mencionada a função `window.calebeHelperClientDav.createDavForClient(...)`. Conferir parâmetros e implementação antes de reutilizar.

### `dav1.js`

Módulo relacionado ao DAV. O botão `.calebe-helper-caixa-dav` é a ação de referência para abrir/acionar a etapa de caixa/emissão após finalizar um DAV. `novodav_emitir.js` foi planejado para acionar esse mesmo botão, evitando duplicar sua lógica.

### `novodav.js`

Módulo relacionado ao fluxo de criação de novo DAV. Conferir o arquivo atual para determinar responsabilidades e dependências exatas.

### `novodav_emitir.js` — emissão automática ao finalizar

Objetivo: adicionar o checkbox `Emitir nota ao finalizar` ao cabeçalho de criação do DAV e, quando marcado, acionar a mesma ação `.calebe-helper-caixa-dav` após o novo DAV aparecer na listagem.

#### Posição desejada

```text
[ Voltar | DAV (novo) | Em Digitação ]          [☐ Emitir nota ao finalizar] [ Voltar2 | Detalhes | Obs | Fechar ]
```

HTML observado:

```html
<div class="d-flex align-items-center justify-content-between mb-3 flex-wrap gap-2">
  <div class="d-flex align-items-center gap-3">
    <!-- Voltar, título, status -->
  </div>
  <div class="d-flex gap-2">
    <!-- btnVoltar2, btnDetalhes, btnObs, btnFecharDav -->
  </div>
</div>
```

Seletores/IDs relevantes:
- `#btnVoltar`
- `#davTituloNumero`
- `#calebe-novodav-status`
- `#btnVoltar2`
- `#btnDetalhes`
- `#btnObs`
- `#btnFecharDav`
- `.d-flex.align-items-center.justify-content-between.mb-3.flex-wrap.gap-2`
- `.d-flex.align-items-center.gap-3`
- `.d-flex.gap-2`

A posição correta é imediatamente antes do grupo `.d-flex.gap-2` que contém os botões de ação. Para manter o checkbox à direita, próximo dos botões, foi proposta a classe:

```js
wrapper.className =
  'form-check form-check-inline mb-0 me-2 ms-auto flex-shrink-0';
```

A função `installCheckbox(doc)` proposta:

```js
function installCheckbox(doc) {
  if (!isDavCreationPage(doc)) return;
  if (doc.getElementById(CHECKBOX_ID)) return;

  // ⬛ Bloco: localiza a linha principal do cabeçalho.
  const headerRow = doc.querySelector(
    '.d-flex.align-items-center.justify-content-between.mb-3.flex-wrap.gap-2'
  );

  if (!headerRow) return;

  // ⬛ Bloco: localiza o grupo de botões à direita.
  const actionGroup = [...headerRow.children].find(el =>
    el.matches('.d-flex.gap-2') &&
    el.querySelector(
      '#btnObs, #btnFecharDav, #btnDetalhes, #btnVoltar2'
    )
  );

  if (!actionGroup) return;

  // ⬛ Bloco: insere o checkbox imediatamente antes dos botões.
  const input = createCheckbox(doc, actionGroup);

  input.setAttribute('aria-checked', 'false');

  input.addEventListener('change', () => {
    input.setAttribute('aria-checked', String(input.checked));
  });
}
```

#### Persistência de marcado/desmarcado

Requisito explícito:
- marcou: a preferência continua marcada nos próximos DAVs;
- desmarcou: continua desmarcada e o próximo DAV não emite automaticamente.

Trecho proposto para persistir a escolha:

```js
// ⬛ Bloco: restaura a preferência persistente.
const input = createCheckbox(doc, actionGroup);
const STORAGE_KEY = 'calebeHelperEmitirNotaAutomaticamente';

input.checked = localStorage.getItem(STORAGE_KEY) === 'true';
input.setAttribute('aria-checked', String(input.checked));

// ⬛ Bloco: salva cada alteração para os próximos DAVs.
input.addEventListener('change', () => {
  localStorage.setItem(STORAGE_KEY, String(input.checked));
  input.setAttribute('aria-checked', String(input.checked));
});
```

**Estado:** posicionamento e persistência foram discutidos e os trechos acima foram propostos. Este registro não confirma que tenham sido integrados ao arquivo completo, testados e instalados. Conferir `novodav_emitir.js` real antes de prosseguir.

#### Lógica funcional planejada

- O módulo detecta documentos de criação/listagem, inclusive iframes.
- Evita considerar o botão “Novo DAV” como finalização.
- Quando o checkbox está marcado e uma ação de finalização ocorre, registra uma emissão pendente.
- Registra os DAVs existentes para distinguir o DAV recém-criado.
- Aguarda o novo DAV aparecer na listagem.
- Localiza e aciona o `.calebe-helper-caixa-dav` correspondente.
- Tempo máximo de espera registrado: 45 segundos.
- O estado pendente pode ser recuperado após navegação/recarregamento.

Constantes registradas:

```js
const MODULE_ID = 'calebe-helper-emitir-nota';
const CHECKBOX_ID = 'calebe-helper-emitir-nota-finalizar';
const PENDING_KEY = 'calebeHelperEmitirNotaPendenteV1';
const SCAN_INTERVAL_MS = 500;
const WAIT_NEW_DAV_MS = 45000;
```

Testar também timeout, cancelamento, navegação entre iframes e garantia de que desmarcado não dispara a emissão.

## 5. Problemas conhecidos / estado

| Área | Problema ou observação | Situação registrada |
|---|---|---|
| `clientepesquisa.js` | Campos reais não existem no dashboard; aparecem na tela Clientes/Fornecedores em iframe | Diagnóstico feito; aprimoramento pendente |
| `clienteduplicar.js` | Duplicação não preservava claramente o original | Causa não confirmada |
| `clientecadastro.js` | `id=0` e botões Salvar externos ao formulário | Regras identificadas |
| `fillexcel_modal.js` | Contexto da extensão invalidado | Proteções foram trabalhadas |
| `fillexcel_modal.js` | Flags/itens podem não fechar o total da nota | Regressão a testar |
| `fillexcel_modal.js` | Minimizar/restaurar regrediu em correção anterior | Regressão a testar |
| `fillexcel_modal.js` | Pausar sem foco e retomar com foco | Requisito solicitado |
| `novodav_emitir.js` | Checkbox à direita, antes dos botões | Código proposto; validar |
| `novodav_emitir.js` | Persistir marcado/desmarcado entre DAVs | Código proposto; validar |
| `novodav_emitir.js` | Acionar `.calebe-helper-caixa-dav` após DAV novo | Lógica planejada; validar |

## 6. Processo de desenvolvimento e entrega

### Regras de alteração

1. Não remover funções existentes sem autorização.
2. Não reescrever módulos inteiros quando uma alteração localizada resolve.
3. Preservar comentários e blocos existentes.
4. Não fazer mudanças visuais não solicitadas.
5. Conferir dependências entre módulos.
6. Não assumir que o DOM permaneceu igual após atualização do Calweb.
7. Não afirmar que algo foi corrigido sem validar arquivo e comportamento.
8. Quando faltarem seletores, solicitar/inspecionar o HTML real.
9. Registrar versão, arquivos alterados, testes e pendências.

### Convenções de código

- JavaScript compatível com Chrome Manifest V3.
- Funções pequenas e responsabilidades claras.
- Evitar listeners duplicados em varreduras periódicas.
- Controlar instâncias de `MutationObserver` e `setInterval`.
- Considerar iframes e documentos substituídos.
- Verificar a existência dos elementos antes de acessá-los.
- Usar prefixo `calebe-helper-` em IDs/classes injetados.
- Marcar blocos importantes com comentários `// ⬛ Bloco:`.
- Preferir acionar ações nativas existentes quando seguro e verificável.

### Empacotamento

Preferências registradas:
- entregar JavaScript alterado também em ZIP;
- incluir apenas arquivos alterados/necessários, evitando arquivos inalterados sem motivo;
- manter o nome funcional do módulo dentro do ZIP;
- colocar a versão no nome do ZIP e no manifesto, não como sufixo no nome do JS.

Exemplo ilustrativo:

```text
Calebe-Helper-vX.Y.Z-descricao.zip
```

### Validação antes da entrega

- conferir os arquivos do ZIP;
- conferir `manifest.json`, versão, permissões e hosts;
- validar sintaxe dos JS (`node --check`);
- confirmar que todos os scripts declarados existem;
- confirmar ordem de carregamento;
- verificar se não há arquivos duplicados/conflitantes;
- informar precisamente o que mudou.

### Teste no Chrome

1. Abrir `chrome://extensions`.
2. Atualizar/carregar a extensão.
3. Atualizar o Calweb com F5.
4. Abrir o console do documento/iframe correto.
5. Testar a funcionalidade alterada.
6. Navegar para outra tela e voltar, repetindo o teste.
7. Verificar regressões dos módulos relacionados.

Quando aparecer `Extension context invalidated`, recarregar a extensão e atualizar o Calweb antes de concluir que o código continua falhando.

## 7. Plano de retomada recomendado

### Etapa 1 — recuperar o estado real

- Localizar o ZIP mais recente realmente utilizado.
- Extrair e conferir `manifest.json`.
- Registrar a versão.
- Listar os scripts em `content_scripts`.
- Comparar o pacote com os arquivos de trabalho.
- Não começar a partir de um ZIP antigo sem identificar as diferenças.

### Etapa 2 — aprimorar pesquisa de clientes

Prioridade principal:
- coletar HTML atual de Clientes/Fornecedores;
- identificar opções do filtro e ação de pesquisa;
- entender a estrutura dos resultados;
- corrigir detecção/espera do iframe;
- evitar listeners duplicados;
- testar os filtros que realmente existem.

### Etapa 3 — cadastro e duplicação

- validar `id=0` para novo cadastro;
- confirmar botões Salvar externos ao formulário;
- corrigir duplicação mantendo original intacto;
- verificar integração entre `clientecadastro.js`, `clienteduplicar.js` e `clientecampos.js`.

### Etapa 4 — regressão do Excel/DAV

- validar importação;
- preencher um e vários itens;
- conferir quantidade, valores, flags e total;
- conferir OC/observação;
- testar minimizar/restaurar;
- testar pausa e retomada ao perder/recuperar foco.

### Etapa 5 — concluir emissão automática

- confirmar posição do checkbox;
- confirmar persistência do estado;
- confirmar que desmarcado não emite;
- confirmar que marcado aguarda o DAV novo;
- confirmar que aciona o botão correto `.calebe-helper-caixa-dav`;
- testar timeout, cancelamento e iframes.

### Etapa 6 — empacotar e documentar

- atualizar versão;
- validar manifesto e sintaxe;
- gerar ZIP com arquivos alterados/necessários;
- registrar resumo e testes;
- atualizar este documento.

## 8. Modelo de registro de versão

Copiar a cada entrega:

```markdown
## Calebe Helper vX.Y.Z — AAAA-MM-DD

### Objetivo
- ...

### Arquivos alterados
- `arquivo.js`: ...

### Arquivos adicionados/removidos
- ...

### Alterações técnicas
- ...

### Dependências / ordem no manifest
- ...

### Testes executados
- [ ] `node --check`
- [ ] Manifesto validado
- [ ] Extensão recarregada
- [ ] F5 no Calweb
- [ ] Teste funcional na tela
- [ ] Teste após navegação/iframe
- [ ] Regressão dos recursos anteriores

### Resultado
- ...

### Pendências
- ...

### ZIP
- `...zip`
```

## 9. Arquivos a recuperar para uma retomada completa

Prioridade para análise do estado real:

1. `manifest.json` — versão, permissões, hosts e ordem.
2. `clientepesquisa.js` — prioridade de aprimoramento.
3. `clientecadastro.js` — criação e salvamento.
4. `clienteduplicar.js` — duplicação preservando original.
5. `clientecampos.js` — campos do cliente.
6. `clientedav.js` — integração cliente/DAV.
7. `dav1.js` — ação `.calebe-helper-caixa-dav`.
8. `fillexcel_modal.js` — importação e preenchimento.
9. `novodav.js` — fluxo de novo DAV.
10. `novodav_emitir.js` — emissão automática e persistência.
11. `popup.html` e `sw.js` — interface e background.

## 10. Texto para iniciar uma nova conversa

> Estou retomando o projeto Calebe Helper, uma extensão Chrome Manifest V3 para o Calweb/SATGO (`https://s1.satgo.com.br/calweb`). Leia primeiro o documento de continuidade e os arquivos atuais antes de alterar qualquer código. A prioridade é aprimorar `clientepesquisa.js`: o diagnóstico anterior mostrou que o dashboard não contém os campos reais de pesquisa; eles aparecem depois de abrir “Clientes/Fornecedores” pelo menu `a.nav-link-l2[title="Clientes/Fornecedores"]`, carregado via `abrirIframe` em `modulos/clca01/clca01.php`. A tela carregada tem `formFiltro`, `input[name="q"]` e `select[name="campo"]`. Preserve os módulos e funções existentes, não adivinhe seletores e valide o DOM atual. Também há trabalho pendente/para validar em `clienteduplicar.js`, `fillexcel_modal.js` e `novodav_emitir.js`. Entregue JavaScript alterado também em ZIP, com o nome funcional do módulo dentro do pacote e versão no nome do ZIP/manifesto. Registre as alterações e os testes para que o projeto possa ser retomado novamente no futuro.

---

**Fim da documentação.**

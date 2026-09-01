/* Equipe — mapa consolidado de todas as lojas e ações, compartilhado
   (não filtra pela loja atual, ao contrário do resto do app). Cada
   linha principal é uma loja cadastrada; dentro dela, uma sub-linha
   por responsável (Fred/Manu/Laura/Outros) com uma barra por task
   "Geral" (mesma coleção `tasks` que Próximos Passos usa pra ações
   sem negócio vinculado — ver js/data/funil.js). As colunas são meses,
   calculadas a partir do intervalo real das tasks (do mês mais cedo ao
   mês mais tarde que aparecer). Clicar numa barra edita a task na
   hora — a mudança aparece tanto aqui quanto no "A Fazer" da loja dona
   dela, porque é o mesmo dado. A linha CRM é só informativa: sempre
   esticada do primeiro ao último mês, sem clique. */

import { store } from "../data/store.js";
import { esc } from "../ui/dom.js";
import { openModal, fieldText, fieldTextarea, readValue } from "../ui/modal.js";
import { fieldResponsavel, wireResponsavelField, readResponsaveis } from "../ui/campo-responsavel.js";
import { corDe, bucketDe, responsaveisDe, responsaveisSemBucket, MES_NOMES } from "../data/funil.js";

function avisarMudanca() {
  window.dispatchEvent(new CustomEvent("data-changed"));
}

// intervalo de meses [{ano,mes}] cobrindo do início mais cedo ao prazo
// mais tarde entre todas as tasks — tasks sem dataInicio usam o
// próprio prazo como início (evento de "1 mês só", mesmo fallback já
// usado no calendário de Próximos Passos).
function mesesDoIntervalo(tasks) {
  let minIso = null, maxIso = null;
  for (const t of tasks) {
    const fim = t.dueDate;
    if (!fim) continue;
    const inicio = t.dataInicio && t.dataInicio <= fim ? t.dataInicio : fim;
    if (!minIso || inicio < minIso) minIso = inicio;
    if (!maxIso || fim > maxIso) maxIso = fim;
  }
  if (!minIso) return [];
  const [anoIni, mesIni] = minIso.slice(0, 7).split("-").map(Number);
  const [anoFim, mesFim] = maxIso.slice(0, 7).split("-").map(Number);
  const meses = [];
  let ano = anoIni, mes = mesIni;
  while (ano < anoFim || (ano === anoFim && mes <= mesFim)) {
    meses.push({ ano, mes });
    mes++;
    if (mes > 12) { mes = 1; ano++; }
  }
  return meses;
}
// cada mês é dividido em SUBCOLS_POR_MES colunas (~semanas) pra uma
// tarefa que termina, por exemplo, na 2ª semana do mês não ocupar
// visualmente o mês inteiro — só a fração correspondente. O cabeçalho,
// as guias verticais e as pistas de barra usam todos a mesma grade fina
// (meses.length * SUBCOLS_POR_MES colunas), garantindo alinhamento
// pixel-a-pixel entre eles; só a linha de guia de fim de mês (a cada 4
// colunas) fica visível, as subdivisões internas da semana não desenham
// borda pra não poluir visualmente.
const SUBCOLS_POR_MES = 4;

// linhas verticais finas dividindo as colunas de mês — UMA linha contínua
// cobrindo a altura inteira do mapa (não por linha/pista), com z-index
// negativo (ver .mapa-col-guias no CSS) pra ficar sempre atrás de
// qualquer conteúdo — título de loja, texto de barra etc. — sem nunca
// tampar palavra nenhuma, já que quem cobre a linha é sempre o que está
// por cima dela, não o contrário.
function colGuiasHtml(numMeses) {
  const n = numMeses * SUBCOLS_POR_MES;
  return `<div class="mapa-col-guias" style="grid-template-columns:repeat(${n},1fr)">${
    Array.from({ length: n }).map((_, i) => `<div class="mapa-col-guia${(i + 1) % SUBCOLS_POR_MES === 0 ? " mapa-col-guia--mes" : ""}"></div>`).join("")
  }</div>`;
}

// linha vermelha marcando o dia de hoje — posição em % contínuo (não
// travada nas subcolunas de semana usadas pelas barras) pra "andar" um
// pouco a cada dia que passa, não só a cada mudança de subcoluna. Some
// da tela quando hoje cai fora do intervalo de meses exibido (mesmo
// critério de "não achou o mês" que subColunaDeData usa).
function hojeLinhaHtml(meses) {
  const hoje = new Date();
  const ano = hoje.getFullYear(), mes = hoje.getMonth() + 1, dia = hoje.getDate();
  const idxMes = meses.findIndex((m) => m.ano === ano && m.mes === mes);
  if (idxMes === -1) return "";
  const diasNoMes = new Date(ano, mes, 0).getDate();
  const pct = ((idxMes + (dia - 1) / diasNoMes) / meses.length) * 100;
  return `<div class="mapa-linha-hoje"><div class="mapa-linha-hoje-marca" style="left:${pct.toFixed(3)}%" title="Hoje"></div></div>`;
}

// coluna absoluta (0-based) na grade fina de meses.length*SUBCOLS_POR_MES,
// combinando o mês da data com a fração do mês em que o dia cai (dia 1
// do mês → subcoluna 0, fim do mês → última subcoluna).
function subColunaDeData(meses, iso) {
  const [ano, mes, dia] = iso.slice(0, 10).split("-").map(Number);
  const idxMes = meses.findIndex((m) => m.ano === ano && m.mes === mes);
  if (idxMes === -1) return null;
  const diasNoMes = new Date(ano, mes, 0).getDate();
  const sub = Math.min(SUBCOLS_POR_MES - 1, Math.floor((dia - 1) * SUBCOLS_POR_MES / diasNoMes));
  return idxMes * SUBCOLS_POR_MES + sub;
}

export async function renderEquipe(app) {
  const [lojas, tasks] = await Promise.all([
    store.listLojas(),
    store.listTasksTodasLojas(),
  ]);
  const lojasOrdenadas = [...lojas].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const meses = mesesDoIntervalo(tasks);

  app.innerHTML = `
    <div class="page-head">
      <div><h1 class="page-title">Equipe</h1></div>
      <div class="toolbar edit-only">
        <button class="btn btn-primary" data-act="nova-acao-equipe">+ Cadastrar ação</button>
      </div>
    </div>
    ${meses.length
      ? `<div class="mapa-equipe" id="mapa-equipe"></div>`
      : `<div class="empty">Nenhuma demanda cadastrada ainda — clique em "+ Cadastrar ação" pra criar a primeira.</div>`}
  `;

  app.querySelector(".page-head .toolbar").addEventListener("click", (e) => {
    if (e.target.closest("[data-act='nova-acao-equipe']")) abrirCadastrarAcaoEquipe(lojasOrdenadas);
  });

  if (!meses.length) return;

  const porLoja = new Map(lojasOrdenadas.map((l) => [l.id, []]));
  for (const t of tasks) {
    if (porLoja.has(t.lojaId)) porLoja.get(t.lojaId).push(t);
  }

  const mapa = app.querySelector("#mapa-equipe");
  mapa.innerHTML = `
    ${colGuiasHtml(meses.length)}
    ${hojeLinhaHtml(meses)}
    <div class="mapa-cabecalho">
      <div class="mapa-cabecalho-label"></div>
      <div class="mapa-cabecalho-meses" style="grid-template-columns:repeat(${meses.length * SUBCOLS_POR_MES},1fr)">
        ${meses.map((m, i) => `<div class="mapa-mes" style="grid-column:${i * SUBCOLS_POR_MES + 1}/${i * SUBCOLS_POR_MES + SUBCOLS_POR_MES + 1}">${esc(MES_NOMES[m.mes - 1].slice(0, 3).toUpperCase())}</div>`).join("")}
      </div>
    </div>
    ${lojasOrdenadas.map((loja) => lojaBlocoHtml(loja, porLoja.get(loja.id), meses)).join("")}
    ${crmBlocoHtml(meses)}
  `;

  mapa.addEventListener("click", (e) => {
    const bar = e.target.closest("[data-task-id]");
    if (!bar) return;
    const task = tasks.find((t) => t.id === bar.dataset.taskId);
    if (!task) return;
    const loja = lojasOrdenadas.find((l) => l.id === task.lojaId);
    abrirEditarTarefa(task, loja?.nome || "", bar.dataset.responsavel);
  });
}

function lojaBlocoHtml(loja, tasksDaLoja, meses) {
  const porResponsavel = new Map();
  for (const t of tasksDaLoja) {
    const nomes = responsaveisDe(t);
    const buckets = nomes.length ? [...new Set(nomes.map(bucketDe))] : ["Outros"];
    for (const b of buckets) {
      if (!porResponsavel.has(b)) porResponsavel.set(b, []);
      porResponsavel.get(b).push(t);
    }
  }
  const buckets = [...porResponsavel.entries()];
  return `
    <div class="mapa-loja">
      <div class="mapa-loja-nome">${esc(loja.nome)}</div>
      ${buckets.length
        ? buckets.map(([responsavel, itens]) => subLinhaHtml(responsavel, itens, meses)).join("")
        : `<div class="mapa-vazio muted">Nenhuma demanda cadastrada.</div>`}
    </div>
  `;
}

function subLinhaHtml(responsavel, itens, meses) {
  const totalCols = meses.length * SUBCOLS_POR_MES;
  const posicionadas = itens
    .map((t) => {
      const fim = t.dueDate;
      const inicio = t.dataInicio && t.dataInicio <= fim ? t.dataInicio : fim;
      const idxIni = Math.max(0, subColunaDeData(meses, inicio) ?? 0);
      const idxFim = Math.min(totalCols - 1, subColunaDeData(meses, fim) ?? totalCols - 1);
      return { ...t, idxIni, idxFim };
    })
    .sort((a, b) => a.idxIni - b.idxIni);

  // mesmo algoritmo guloso de pistas do calendário-agenda (ver
  // js/views/kanban-proximos-passos.js:semanaHtml), só que por mês em
  // vez de por dia — duas demandas da mesma pessoa que se sobrepõem no
  // tempo ganham pistas separadas em vez de se sobrepor visualmente.
  const finalPorPista = [];
  const comPista = posicionadas.map((t) => {
    let pista = finalPorPista.findIndex((fim) => fim < t.idxIni);
    if (pista === -1) { pista = finalPorPista.length; finalPorPista.push(t.idxFim); }
    else finalPorPista[pista] = t.idxFim;
    return { ...t, pista };
  });

  return `
    <div class="mapa-sub-linha">
      <div class="mapa-sub-nome"><span class="pp-cor-dot pp-cor-dot--${corDe(responsavel)}"></span>${esc(responsavel)}</div>
      <div class="mapa-sub-pistas">
        ${finalPorPista.map((_, pistaIdx) => `
          <div class="mapa-pista" style="grid-template-columns:repeat(${totalCols},1fr)">
            ${comPista.filter((t) => t.pista === pistaIdx).map((t) => `
              <div class="mapa-bar pp-bar--${corDe(responsavel)}${t.concluidaEm ? " acao-concluida" : ""}" style="grid-column:${t.idxIni + 1}/${t.idxFim + 2}" data-task-id="${esc(t.id)}" data-responsavel="${esc(responsavel)}" title="${esc(t.description)}${t.concluidaEm ? " (feita)" : ""}">${esc(t.description)}</div>
            `).join("")}
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function crmBlocoHtml(meses) {
  return `
    <div class="mapa-loja mapa-loja--crm">
      <div class="mapa-loja-nome">CRM <span class="muted" style="font-weight:400;font-size:11px">(atividade contínua)</span></div>
      <div class="mapa-sub-linha">
        <div class="mapa-sub-nome"></div>
        <div class="mapa-sub-pistas">
          <div class="mapa-pista" style="grid-template-columns:repeat(${meses.length * SUBCOLS_POR_MES},1fr)">
            <div class="mapa-bar mapa-bar--crm" style="grid-column:1/${meses.length * SUBCOLS_POR_MES + 1}">Manutenção do CRM, ajustes, alimentação e análise de dados</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function opcoesLojaHtml(lojas) {
  return lojas.map((l) => `<option value="${esc(l.id)}">${esc(l.nome)}</option>`).join("");
}

// "Cadastrar ação" a partir da Equipe — diferente do mesmo botão no
// Kanban → Próximos Passos (que já sabe a loja pelo contexto do
// sidebar), aqui a loja precisa ser escolhida explicitamente, já que
// o mapa mostra todas de uma vez.
async function abrirCadastrarAcaoEquipe(lojasOrdenadas) {
  openModal({
    title: "Cadastrar ação",
    submitLabel: "Salvar",
    bodyHtml: `
      <div class="field">
        <label for="f_lojaId">Loja *</label>
        <select id="f_lojaId" name="lojaId" required>
          <option value="">Selecione...</option>
          ${opcoesLojaHtml(lojasOrdenadas)}
        </select>
      </div>
      ${fieldTextarea("description", "Descrição", { placeholder: "Ex.: Levantamento e contato parceiros" })}
      <div class="field-2col">
        ${fieldText("dataInicio", "Início (opcional)", { type: "date" })}
        ${fieldText("dueDate", "Prazo", { type: "date", required: true })}
      </div>
      ${fieldResponsavel([])}
    `,
    onMount: wireResponsavelField,
    onSubmit: async (form) => {
      const lojaId = readValue(form, "lojaId");
      const description = readValue(form, "description");
      const dueDate = readValue(form, "dueDate");
      const dataInicio = readValue(form, "dataInicio") || new Date().toISOString().slice(0, 10);
      const responsaveis = readResponsaveis(form);
      if (!lojaId) throw new Error("Selecione a loja.");
      if (!description) throw new Error("Descreva a ação.");
      if (!dueDate) throw new Error("Informe o prazo.");
      await store.addTaskGeral({ lojaId, description, dueDate, dataInicio, responsaveis });
      avisarMudanca();
    },
  });
}

// responsavelContexto: sub-linha (Fred/Manu/Laura/Outros) de onde a barra
// clicada veio — quando a demanda tem mais de um responsável, "Excluir"
// remove só esse (a demanda continua pros outros); só apaga de vez quando
// sobra ninguém, igual ao mesmo ajuste já feito no "A Fazer" (ver
// js/views/kanban-proximos-passos.js).
async function abrirEditarTarefa(task, lojaNome, responsavelContexto) {
  const restantes = responsavelContexto ? responsaveisSemBucket(task, responsavelContexto) : [];
  const removeSoDoContexto = responsavelContexto && restantes.length > 0;
  openModal({
    title: "Editar demanda",
    subtitle: lojaNome,
    submitLabel: "Salvar",
    bodyHtml: `
      ${fieldTextarea("description", "Descrição", { required: true, value: task.description || "" })}
      <div class="field-2col">
        ${fieldText("dataInicio", "Início (opcional)", { type: "date", value: task.dataInicio || "" })}
        ${fieldText("dueDate", "Prazo", { type: "date", required: true, value: task.dueDate || "" })}
      </div>
      ${fieldResponsavel(responsaveisDe(task))}
      <label class="checkbox-inline" style="margin-top:4px">
        <input type="checkbox" name="concluida" ${task.concluidaEm ? "checked" : ""}> Marcar como feita
      </label>
    `,
    onMount: wireResponsavelField,
    onDelete: async () => {
      if (removeSoDoContexto) {
        await store.updateTaskGeral(task.id, { responsaveis: restantes });
      } else {
        await store.removeTaskGeral(task.id);
      }
      avisarMudanca();
    },
    deleteLabel: removeSoDoContexto ? `🗑 Remover de ${responsavelContexto}` : "🗑 Excluir",
    deleteConfirm: removeSoDoContexto
      ? `Remover "${task.description}" de ${responsavelContexto}? A demanda continua para os outros responsáveis.`
      : `Excluir a demanda "${task.description}"? Isso apaga pra todos os responsáveis. Não dá pra desfazer.`,
    onSubmit: async (form) => {
      const description = readValue(form, "description");
      const dueDate = readValue(form, "dueDate");
      const dataInicio = readValue(form, "dataInicio") || "";
      const responsaveis = readResponsaveis(form);
      const feita = form.elements["concluida"].checked;
      const concluidaEm = feita ? (task.concluidaEm || new Date().toISOString().slice(0, 10)) : null;
      if (!description) throw new Error("Descreva a demanda.");
      if (!dueDate) throw new Error("Informe o prazo.");
      await store.updateTaskGeral(task.id, { description, dueDate, dataInicio, responsaveis, concluidaEm });
      avisarMudanca();
    },
  });
}

/* Backup e dados — exportar/importar JSON e migrar/popular o
   Firestore. Rota #/backup (link discreto na sidebar, não é uma
   aba principal). Mesmo propósito do admin.js da Plataforma Giros
   Imagens, enxuto pro modelo de dados do 2V (parceiros/lançamentos). */

import { store } from "../data/store.js";
import { USE_FIRESTORE } from "../config/firebase-config.js";
import * as mock from "../data/mock.js";
import { esc } from "../ui/dom.js";
import { getLojaAtualId, setLojaAtualId } from "../data/loja-atual.js";
import { geocodeEndereco } from "../util/geocoding.js";

const LS_KEY = "2v-parcerias-db-v1";

function bundleExemplo() {
  return structuredClone({ parceiros: mock.parceiros, lancamentos: mock.lancamentos, listas: mock.listas });
}

function baixarJSON(obj, nome) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export async function renderBackup(app) {
  const backend = USE_FIRESTORE ? "Firestore (nuvem)" : "Local (neste navegador)";
  const lojas = await store.listLojas();

  app.innerHTML = `
    <a class="back-link" href="#/">← Voltar</a>
    <div class="page-head"><div>
      <h1 class="page-title">Backup e dados</h1>
      <div class="page-sub">Backend atual: <strong>${backend}</strong></div>
    </div></div>

    <div class="dash-cols" style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">
      <div class="chart-card">
        <h3 style="margin-bottom:10px">Exportar backup</h3>
        <p class="muted" style="margin-top:0;font-size:13.5px">Baixa um JSON com parceiros, lançamentos e listas. Faça isso periodicamente.</p>
        <button class="btn btn-primary" id="btn-export">⬇ Exportar JSON</button>
      </div>

      <div class="chart-card edit-only">
        <h3 style="margin-bottom:10px">Importar backup</h3>
        <p class="muted" style="margin-top:0;font-size:13.5px">Restaura a partir de um JSON exportado. Registros são gravados pelos mesmos IDs.</p>
        <input type="file" id="file-import" accept="application/json" style="display:none" />
        <button class="btn" id="btn-import">⬆ Escolher arquivo…</button>
        <div id="import-status" class="muted" style="font-size:13px;margin-top:8px"></div>
      </div>

      <div class="chart-card edit-only">
        <h3 style="margin-bottom:10px">Migrar localStorage → Firestore</h3>
        <p class="muted" style="margin-top:0;font-size:13.5px">Envia os dados salvos neste navegador para o Firestore. Use uma vez, depois de ligar USE_FIRESTORE.</p>
        <button class="btn btn-primary" id="btn-migrar">🔄 Migrar para Firestore</button>
        <div id="migrar-status" class="muted" style="font-size:13px;margin-top:8px"></div>
      </div>

      <div class="chart-card edit-only">
        <h3 style="margin-bottom:10px">Dados atuais (seed)</h3>
        <p class="muted" style="margin-top:0;font-size:13.5px">Grava o conjunto de dados atual (o já importado da planilha) no backend ativo. Sobrescreve itens de mesmo ID.</p>
        <button class="btn" id="btn-seed">Popular com dados atuais</button>
        <div id="seed-status" class="muted" style="font-size:13px;margin-top:8px"></div>
      </div>

      <div class="chart-card edit-only" style="border-color:var(--c-red-fg)">
        <h3 style="margin-bottom:10px">Editar lojas</h3>
        <p class="muted" style="margin-top:0;font-size:13.5px">Renomear, apagar só os lançamentos (mantém parceiros e cupons) ou excluir a loja inteira.</p>
        <div class="field" style="margin-bottom:14px">
          <select class="input" id="loja-edit-select">
            ${lojas.map((l) => `<option value="${esc(l.id)}">${esc(l.nome)}</option>`).join("")}
          </select>
        </div>

        <div style="margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--border)">
          <label for="loja-edit-nome" style="font-size:13px;font-weight:700">Nome da loja</label>
          <div style="display:flex;gap:8px;margin-top:6px">
            <input class="input" id="loja-edit-nome" type="text" style="flex:1" />
            <button class="btn" id="btn-renomear-loja">Salvar nome</button>
          </div>
          <div id="renomear-status" class="muted" style="font-size:13px;margin-top:6px"></div>
        </div>

        <div style="margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--border)">
          <label for="loja-edit-endereco" style="font-size:13px;font-weight:700">Endereço da loja</label>
          <p class="muted" style="font-size:12.5px;margin:2px 0 6px">Usado pra centralizar o mapa da Prospecção e calcular distância até cada negócio.</p>
          <div style="display:flex;gap:8px">
            <input class="input" id="loja-edit-endereco" type="text" style="flex:1" placeholder="Ex.: Praia do Flamengo, 154 - Flamengo" />
            <button class="btn" id="btn-salvar-endereco">Salvar endereço</button>
          </div>
          <div id="endereco-status" class="muted" style="font-size:13px;margin-top:6px"></div>
        </div>

        <div style="margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--border)">
          <p style="font-size:13px;margin:0 0 8px"><strong>Apagar base de dados</strong> — apaga todos os lançamentos desta loja. Parceiros e cupons continuam cadastrados. Não dá pra desfazer.</p>
          <label for="loja-wipe-confirma" style="font-size:13px">Digite o nome da loja pra confirmar</label>
          <input class="input" id="loja-wipe-confirma" type="text" autocomplete="off" style="margin:6px 0;display:block;width:100%" />
          <button class="btn btn-danger" id="btn-wipe-loja" disabled>🗑 Apagar lançamentos desta loja</button>
          <div id="wipe-loja-status" class="muted" style="font-size:13px;margin-top:8px"></div>
        </div>

        <div>
          <p style="font-size:13px;margin:0 0 8px"><strong>Excluir loja</strong> — apaga a loja inteira: parceiros, cupons, lançamentos e andamento no Pipeline. Não dá pra desfazer.</p>
          <label for="del-loja-confirma" style="font-size:13px">Digite o nome da loja pra confirmar</label>
          <input class="input" id="del-loja-confirma" type="text" autocomplete="off" style="margin:6px 0;display:block;width:100%" />
          <button class="btn btn-danger" id="btn-del-loja" disabled>🗑 Excluir esta loja</button>
          <div id="del-loja-status" class="muted" style="font-size:13px;margin-top:8px"></div>
        </div>
      </div>
    </div>
  `;

  app.querySelector("#btn-export").addEventListener("click", async () => {
    const dados = await store.exportAll();
    const carimbo = new Date().toISOString().slice(0, 10);
    baixarJSON({ versao: 1, exportadoEm: new Date().toISOString(), ...dados }, `2v-parcerias-backup-${carimbo}.json`);
  });

  const fileInput = app.querySelector("#file-import");
  const importStatus = app.querySelector("#import-status");
  app.querySelector("#btn-import").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (!confirm("Importar este backup? Itens com o mesmo ID serão sobrescritos.")) { fileInput.value = ""; return; }
    importStatus.textContent = "Importando…";
    try {
      const dados = JSON.parse(await file.text());
      await store.importAll(dados);
      importStatus.textContent = "✓ Importado. Recarregando…";
      setTimeout(() => { location.hash = "#/"; location.reload(); }, 600);
    } catch (err) {
      importStatus.textContent = "✗ Erro: " + err.message;
    }
    fileInput.value = "";
  });

  const migrarStatus = app.querySelector("#migrar-status");
  app.querySelector("#btn-migrar").addEventListener("click", async () => {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) { migrarStatus.textContent = "✗ Nenhum dado encontrado no localStorage."; return; }
    if (!confirm("Enviar todos os dados do localStorage para o Firestore? Itens com mesmo ID serão sobrescritos.")) return;
    migrarStatus.textContent = "Migrando…";
    try {
      const dados = JSON.parse(raw);
      await store.importAll(dados);
      migrarStatus.textContent = "✓ Migração concluída. Recarregando…";
      setTimeout(() => { location.hash = "#/"; location.reload(); }, 600);
    } catch (err) {
      migrarStatus.textContent = "✗ Erro: " + err.message;
    }
  });

  const seedStatus = app.querySelector("#seed-status");
  app.querySelector("#btn-seed").addEventListener("click", async () => {
    if (!confirm(`Gravar os dados atuais em: ${backend}?`)) return;
    seedStatus.textContent = "Gravando…";
    try {
      await store.importAll(bundleExemplo());
      seedStatus.textContent = "✓ Concluído. Recarregando…";
      setTimeout(() => { location.hash = "#/"; location.reload(); }, 600);
    } catch (err) {
      seedStatus.textContent = "✗ Erro: " + err.message;
    }
  });

  const lojaSelect = app.querySelector("#loja-edit-select");
  function lojaSelecionada() {
    return lojas.find((l) => l.id === lojaSelect.value);
  }

  // ---- renomear ----
  const nomeInput = app.querySelector("#loja-edit-nome");
  const renomearBtn = app.querySelector("#btn-renomear-loja");
  const renomearStatus = app.querySelector("#renomear-status");
  function preencherNomeAtual() {
    nomeInput.value = lojaSelecionada()?.nome || "";
    renomearStatus.textContent = "";
  }
  preencherNomeAtual();
  renomearBtn.addEventListener("click", async () => {
    const id = lojaSelect.value;
    const novoNome = nomeInput.value.trim();
    if (!novoNome) { renomearStatus.textContent = "✗ Informe um nome."; return; }
    if (novoNome === lojaSelecionada()?.nome) return;
    renomearStatus.textContent = "Salvando…";
    try {
      await store.updateLoja(id, { nome: novoNome });
      renomearStatus.textContent = "✓ Nome atualizado. Recarregando…";
      setTimeout(() => { location.reload(); }, 600);
    } catch (err) {
      renomearStatus.textContent = "✗ Erro: " + err.message;
    }
  });

  // ---- endereço (usado pelo mapa da Prospecção) ----
  const enderecoInput = app.querySelector("#loja-edit-endereco");
  const salvarEnderecoBtn = app.querySelector("#btn-salvar-endereco");
  const enderecoStatus = app.querySelector("#endereco-status");
  function preencherEnderecoAtual() {
    enderecoInput.value = lojaSelecionada()?.endereco || "";
    enderecoStatus.textContent = "";
  }
  preencherEnderecoAtual();
  salvarEnderecoBtn.addEventListener("click", async () => {
    const id = lojaSelect.value;
    const novoEndereco = enderecoInput.value.trim();
    if (!novoEndereco) { enderecoStatus.textContent = "✗ Informe um endereço."; return; }
    enderecoStatus.textContent = "Localizando endereço…";
    try {
      const coord = await geocodeEndereco(novoEndereco);
      await store.updateLoja(id, { endereco: novoEndereco, lat: coord?.lat ?? null, lng: coord?.lng ?? null });
      enderecoStatus.textContent = coord
        ? "✓ Endereço salvo e localizado no mapa. Recarregando…"
        : "✓ Endereço salvo, mas não consegui localizar no mapa — o mapa da Prospecção fica desativado até achar um endereço mais específico. Recarregando…";
      setTimeout(() => { location.reload(); }, 900);
    } catch (err) {
      enderecoStatus.textContent = "✗ Erro: " + err.message;
    }
  });

  // ---- botões de "digite o nome pra confirmar" (apagar base / excluir loja) ----
  function wireConfirmacaoPorNome(inputEl, btnEl) {
    btnEl.disabled = true;
    inputEl.addEventListener("input", () => {
      btnEl.disabled = inputEl.value.trim() !== (lojaSelecionada()?.nome || "");
    });
  }
  const wipeConfirma = app.querySelector("#loja-wipe-confirma");
  const wipeBtn = app.querySelector("#btn-wipe-loja");
  const wipeStatus = app.querySelector("#wipe-loja-status");
  wireConfirmacaoPorNome(wipeConfirma, wipeBtn);

  const delConfirma = app.querySelector("#del-loja-confirma");
  const delBtn = app.querySelector("#btn-del-loja");
  const delStatus = app.querySelector("#del-loja-status");
  wireConfirmacaoPorNome(delConfirma, delBtn);

  lojaSelect.addEventListener("change", () => {
    preencherNomeAtual();
    preencherEnderecoAtual();
    wipeConfirma.value = ""; wipeBtn.disabled = true; wipeStatus.textContent = "";
    delConfirma.value = ""; delBtn.disabled = true; delStatus.textContent = "";
  });

  wipeBtn.addEventListener("click", async () => {
    const id = lojaSelect.value;
    const nome = lojaSelecionada()?.nome || "";
    if (wipeConfirma.value.trim() !== nome) return;
    if (!confirm(`Apagar TODOS os lançamentos de "${nome}"? Parceiros e cupons continuam cadastrados. Não dá pra desfazer.`)) return;
    wipeStatus.textContent = "Apagando…";
    try {
      const n = await store.wipeLancamentosDaLoja(id);
      wipeStatus.textContent = `✓ ${n} lançamento(s) apagado(s). Recarregando…`;
      setTimeout(() => { location.reload(); }, 600);
    } catch (err) {
      wipeStatus.textContent = "✗ Erro: " + err.message;
    }
  });

  delBtn.addEventListener("click", async () => {
    const id = lojaSelect.value;
    const nome = lojaSelecionada()?.nome || "";
    if (delConfirma.value.trim() !== nome) return;
    if (!confirm(`Excluir a loja "${nome}"? Isso apaga TODOS os parceiros, cupons e lançamentos dela. Não dá pra desfazer.`)) return;
    delStatus.textContent = "Excluindo…";
    try {
      await store.removeLoja(id);
      if (getLojaAtualId() === id) {
        const restante = lojas.find((l) => l.id !== id);
        setLojaAtualId(restante ? restante.id : "");
      }
      delStatus.textContent = "✓ Loja excluída. Recarregando…";
      setTimeout(() => { location.hash = "#/"; location.reload(); }, 600);
    } catch (err) {
      delStatus.textContent = "✗ Erro: " + err.message;
    }
  });
}

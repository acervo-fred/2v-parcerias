/* Lista de Prospecção — cadastro simples de lugares que podem virar
   parceiro (só tipo/nome/local/responsável/contato/observações, sem
   Área nem Status). O estágio de cada negócio é sempre derivado do
   Kanban (ver js/views/kanban.js): sem nenhum registro em `partners`
   (ou stage "lead"), a linha aparece "crua"; assim que alguém arrasta
   o card pra "Negociação / Em contato" no Kanban, a linha aqui ganha
   o badge "Em contato". O botão "Fechar parceria" (que registra o
   cupom e marca ehParceiro=true — ver cadastros.js:abrirFecharParceria)
   fica disponível o tempo todo, desde o cadastro até fechar — não
   precisa esperar o card avançar no Kanban.

   "Ver parceiro →" aparece pra registros já fechados (ehParceiro=true);
   clicar em qualquer outro ponto da linha leva pra página do negócio. */

import { store } from "../data/store.js";
import { esc } from "../ui/dom.js";
import { badge } from "../ui/badges.js";
import { abrirNovoProspecto, abrirFecharParceria } from "./cadastros.js";
import { geocodeEndereco, geocodeEnderecoEstruturado, distanciaMetros, formatarDistancia } from "../util/geocoding.js";

export async function renderProspeccao(app) {
  const [negocios, partners, loja] = await Promise.all([
    store.listParceiros(), store.listPartners(), store.getLojaAtual(),
  ]);
  const partnersById = Object.fromEntries(partners.map((p) => [p.id, p]));
  const lojaComMapa = !!(loja?.lat != null && loja?.lng != null);

  let busca = "";

  app.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Prospecção</h1>
        <div class="page-sub" id="contador">${negocios.length} negócios</div>
      </div>
      <div class="toolbar edit-only">
        <button class="btn btn-primary" data-act="novo">+ Nova prospecção</button>
      </div>
    </div>

    ${lojaComMapa
      ? `<div class="chart-card" style="margin-bottom:16px;padding:0"><div id="prospeccao-mapa"></div></div>`
      : `<div class="chart-card" style="margin-bottom:16px"><div id="prospeccao-mapa-aviso" class="muted">Defina o endereço da loja em <a href="#/backup">Backup e dados → Editar lojas</a> pra habilitar o mapa de prospecção.</div></div>`}

    <div class="toolbar" style="margin-bottom:16px">
      <input class="input" id="busca" type="search" placeholder="Buscar por nome, local ou responsável…" />
    </div>

    <div class="list-card" id="lista"></div>
  `;

  const lista = app.querySelector("#lista");
  const porId = Object.fromEntries(negocios.map((p) => [p.id, p]));

  function desenhar() {
    const termo = busca.trim().toLowerCase();
    const arr = negocios.filter((p) => !termo
      || p.nome.toLowerCase().includes(termo)
      || (p.local || "").toLowerCase().includes(termo)
      || (p.responsavel || "").toLowerCase().includes(termo)
      || (p.contato || "").toLowerCase().includes(termo)
    ).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

    lista.innerHTML = arr.length
      ? arr.map((p) => row(p, partnersById, loja)).join("")
      : `<div class="empty">Nenhum negócio encontrado.</div>`;

    app.querySelector("#contador").textContent = `${arr.length} negócios`;
  }
  desenhar();

  app.querySelector("#busca").addEventListener("input", (e) => { busca = e.target.value; desenhar(); });

  app.querySelector(".page-head .toolbar").addEventListener("click", (e) => {
    if (e.target.closest("[data-act='novo']")) abrirNovoProspecto();
  });

  lista.addEventListener("click", async (e) => {
    const id = e.target.closest("[data-id]")?.dataset.id;
    if (!id) return;
    const p = porId[id];
    if (!p) return;
    const action = e.target.dataset.action;
    if (action === "editar") return abrirNovoProspecto(p);
    if (action === "fechar") return abrirFecharParceria(p);
    if (action === "excluir") {
      if (!confirm(`Excluir "${p.nome}" da prospecção?`)) return;
      await store.removeParceiro(p.id);
      window.dispatchEvent(new CustomEvent("data-changed"));
      return;
    }
    location.hash = `#/parceiro/${id}`;
  });

  if (!lojaComMapa) return;
  inicializarMapa(loja, negocios, desenhar);
}

/* mapa Leaflet (via CDN, ver index.html) + geocodificação preguiçosa dos
   negócios que ainda não têm coordenada cacheada. Usa L.circleMarker (SVG
   nativo do Leaflet) em vez do ícone padrão pra não depender dos arquivos
   de imagem marker-icon.png que o pacote normalmente serve — só carregamos
   o CSS/JS do Leaflet via CDN, sem os assets extras. */
function inicializarMapa(loja, negocios, desenhar) {
  const mapa = L.map("prospeccao-mapa", { scrollWheelZoom: false }).setView([loja.lat, loja.lng], 15);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors", maxZoom: 19,
  }).addTo(mapa);
  L.circleMarker([loja.lat, loja.lng], { radius: 10, color: "#fff", weight: 2, fillColor: "#376946", fillOpacity: 1 })
    .addTo(mapa).bindPopup(`<strong>${esc(loja.nome)}</strong><br>Sua loja`);

  let marcadores = [];
  function atualizarPins() {
    marcadores.forEach((m) => mapa.removeLayer(m));
    marcadores = negocios.filter((p) => p.lat != null && p.lng != null).map((p) => {
      const dist = formatarDistancia(distanciaMetros(loja.lat, loja.lng, p.lat, p.lng));
      return L.circleMarker([p.lat, p.lng], { radius: 6, color: "#fff", weight: 1.5, fillColor: "#2a65d7", fillOpacity: 0.9 })
        .addTo(mapa)
        .bindPopup(`<strong>${esc(p.nome)}</strong><br>${esc(p.tipo || "")}<br>${esc(dist)}`);
    });
  }
  atualizarPins();

  // fila sequencial (rate-limit já garantido por geocodeEndereco) — só
  // quem tem endereço preenchido e ainda não foi geocodificado com o
  // endereço atual (localGeocodado divergente cobre tanto "nunca tentou"
  // quanto "endereço mudou desde a última tentativa"); falha também
  // grava localGeocodado, pra não bater na mesma tentativa ruim de novo
  // a cada vez que a tela abre.
  (async () => {
    const pendentes = negocios.filter((p) => (p.local || "").trim() && p.localGeocodado !== p.local);
    for (const p of pendentes) {
      const bias = { lat: loja.lat, lng: loja.lng };
      // cadastros novos/editados vêm com rua/número/CEP separados (mais
      // confiável — ver js/ui/endereco-fields.js); cadastros antigos, só
      // com o texto livre de "local", caem no geocodeEndereco de sempre.
      const coord = (p.enderecoRua || "").trim()
        ? await geocodeEnderecoEstruturado({ rua: p.enderecoRua, numero: p.enderecoNumero, cep: p.enderecoCep, bairro: p.enderecoBairro }, bias)
        : await geocodeEndereco(p.local, bias);
      p.lat = coord?.lat ?? null;
      p.lng = coord?.lng ?? null;
      p.localGeocodado = p.local;
      store.updateParceiro(p.id, { lat: p.lat, lng: p.lng, localGeocodado: p.local })
        .catch((err) => console.error("Falha ao salvar geocode do endereço:", err));
      desenhar();
      atualizarPins();
    }
  })();
}

function row(p, partnersById, loja) {
  const partes = [p.tipo, p.tipoDetalhe, p.local, p.responsavel, p.contato].filter(Boolean);
  if (loja?.lat != null && loja?.lng != null && p.lat != null && p.lng != null) {
    partes.push(formatarDistancia(distanciaMetros(loja.lat, loja.lng, p.lat, p.lng)));
  }
  const stage = partnersById[p.id]?.stage;
  const acao = p.ehParceiro
    ? `<a class="btn btn-sm btn-ghost" href="#/parceiro/${esc(p.id)}">Ver parceiro →</a>`
    : `<button class="btn btn-sm btn-primary edit-only" data-action="fechar" data-id="${esc(p.id)}">Fechar parceria</button>`;
  const statusBadge = !p.ehParceiro && stage === "negociacao" ? badge("Em contato", "amber")
    : !p.ehParceiro && stage === "perdido" ? badge("Perdido", "red")
    : "";
  return `<div class="list-row" data-id="${esc(p.id)}">
    <div class="lr-main">
      <div class="lr-title">${esc(p.nome)} ${statusBadge}</div>
      <div class="lr-sub">${esc(partes.join(" · "))}</div>
      ${p.observacoes ? `<div class="lr-sub">${esc(p.observacoes)}</div>` : ""}
    </div>
    ${acao}
    <span class="lr-actions edit-only">
      <button class="icon-btn" data-action="editar" data-id="${esc(p.id)}" title="Editar">✎</button>
      <button class="icon-btn danger" data-action="excluir" data-id="${esc(p.id)}" title="Excluir">🗑</button>
    </span>
  </div>`;
}

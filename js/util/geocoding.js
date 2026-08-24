/* Geocodificação de endereço em texto livre → coordenada, via Nominatim
   (OpenStreetMap) — gratuito, sem chave de API. Usado pra colocar pin no
   mapa da Prospecção e calcular distância até a loja.

   "Melhor esforço": endereço vago ("Flamengo - praia", "São Luiz") pode
   não geocodificar ou geocodificar errado — geocodeEndereco só devolve
   null nesse caso, nunca lança erro; quem chama decide o que fazer
   (não colocar pin, não travar cadastro nenhum).

   Nominatim pede uso comedido (~1 req/s, sem paralelismo) — a fila
   sequencial abaixo garante isso mesmo se várias telas chamarem
   geocodeEndereco ao mesmo tempo. */

const INTERVALO_MIN_MS = 1100;
let filaLiberadaEm = 0;

function aguardarVez() {
  const agora = Date.now();
  const espera = Math.max(0, filaLiberadaEm - agora);
  filaLiberadaEm = Math.max(agora, filaLiberadaEm) + INTERVALO_MIN_MS;
  return espera > 0 ? new Promise((r) => setTimeout(r, espera)) : Promise.resolve();
}

// endereço colado de WhatsApp/planilha costuma vir com ruído que atrapalha
// o Nominatim (nome de prédio antes de "·", sala/loja/bloco, "- RJ"
// redundante com o "Rio de Janeiro" já anexado) — uma versão "limpa" como
// segunda tentativa recupera boa parte dos casos que a busca com o texto
// cru não acha.
function limparEndereco(texto) {
  return texto
    .replace(/^.*·\s*/, "") // "Edifício X · Rua Y, 20" -> "Rua Y, 20" (o nome do prédio raramente ajuda o geocoder, só atrapalha)
    .replace(/\b(LJ|LOJA|SL|SALA|APT?O?|BLOCO|BL|ANDAR|CJ|CONJUNTO)\.?\s*[\w°º-]*/gi, " ")
    .replace(/-\s*RJ\b/gi, " ")
    .replace(/,\s*,/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/^,|,$/g, "")
    .trim();
}

function extrairCep(texto) {
  const m = texto.match(/\d{5}-?\d{3}/);
  return m ? m[0] : null;
}

// só rua + número (primeiros dois pedaços separados por vírgula) — última
// tentativa antes de desistir. Bairro/cidade digitado errado ou impreciso
// faz o Nominatim não achar NADA (em vez de ignorar aquele pedaço), então
// tentar só o miolo mais confiável do endereço recupera esses casos.
function apenasRuaNumero(texto) {
  const partes = texto.split(",").map((p) => p.trim()).filter(Boolean);
  return partes.length > 2 ? partes.slice(0, 2).join(", ") : null;
}

async function buscarNominatim(texto, bias) {
  await aguardarVez();
  const params = new URLSearchParams({
    format: "json", limit: "1",
    q: /rio de janeiro/i.test(texto) ? `${texto}, Brasil` : `${texto}, Rio de Janeiro, Brasil`,
  });
  if (bias?.lat != null && bias?.lng != null) {
    const d = 0.2; // ~20km de raio de prioridade ao redor da loja
    params.set("viewbox", `${bias.lng - d},${bias.lat + d},${bias.lng + d},${bias.lat - d}`);
    params.set("bounded", "0"); // prioriza sem excluir resultados fora da caixa
  }
  try {
    const resp = await fetch(`https://nominatim.openstreetmap.org/search?${params}`);
    if (!resp.ok) return null;
    const resultados = await resp.json();
    const primeiro = resultados[0];
    if (!primeiro) return null;
    const lat = Number(primeiro.lat), lng = Number(primeiro.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

// bias: { lat, lng } da loja, pra priorizar resultados próximos quando o
// endereço for ambíguo (ex.: nome de rua comum em mais de um bairro).
// Tenta o texto como veio; se não achar, tenta uma versão limpa (sem
// sala/loja/bloco) e, por último, só o CEP (se tiver um no texto) — cada
// tentativa é uma chamada extra à API, então só entra em cascata quando a
// anterior falha de verdade, não em todo endereço.
export async function geocodeEndereco(texto, bias = null) {
  const q = (texto || "").trim();
  if (!q) return null;

  const tentativas = [q];
  const limpo = limparEndereco(q);
  if (limpo && limpo !== q) tentativas.push(limpo);
  const ruaNumero = apenasRuaNumero(limpo || q);
  if (ruaNumero && !tentativas.includes(ruaNumero)) tentativas.push(ruaNumero);
  const cep = extrairCep(q);
  if (cep) tentativas.push(cep);

  for (const tentativa of tentativas) {
    const resultado = await buscarNominatim(tentativa, bias);
    if (resultado) return resultado;
  }
  return null;
}

// fórmula de haversine — distância em metros entre duas coordenadas.
export function distanciaMetros(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (g) => (g * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatarDistancia(metros) {
  if (metros < 1000) return `${Math.round(metros)} m`;
  return `${(metros / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km`;
}

// Robot de Veeduría Caucasia (Vibras Positivas HM)
// Corre en GitHub Actions cada 30 minutos. Trae noticias reales de obras y
// parques de Caucasia y los contratos de obra pública de Caucasia que aparecen
// en los datos abiertos del SECOP II. Guarda data/noticias.json y data/secop.json.
// No necesita librerías: solo Node 20.
import { readFile, writeFile } from "node:fs/promises";

const BUSQUEDAS = [
  'Caucasia "parque El Palmar"',
  'Caucasia parque obra',
  'Caucasia obra suspendida',
  'Caucasia contratista obra',
  'Caucasia "parque lineal"',
  'Caucasia "El Camello" parque',
  'Caucasia acueducto Procuraduría',
  'Caucasia alcaldía contrato',
  'Caucasia veeduría',
  'Caucasia Contraloría obra',
  '"Jhoan Montes" Caucasia',
  'Bajo Cauca obras inconclusas',
  'EDURHABA Caucasia',
  'EDURHABA Palmar'
];
// Una noticia entra si habla de Caucasia y de obras, contratos o plata pública
const LUGAR = ["caucasia"];
const TEMA = ["parque", "obra", "contrat", "palmar", "acueducto", "alcantarill", "puente", "vía", "via ", "procurad", "contralor", "fiscal", "veedur", "alcald", "licitac", "regalías", "regalias", "plata", "millones", "eduan", "edurhaba", "malecón", "malecon", "cancha", "coliseo", "colegio", "hospital"];
const UA = { "user-agent": "Mozilla/5.0 (compatible; VeeduriaCaucasiaBot/1.0; +https://github.com/haroldco45)" };

const limpiar = s => String(s || "")
  .replace(/<!\[CDATA\[|\]\]>/g, "")
  .replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/\s+/g, " ").trim();
const tag = (xml, t) => { const m = xml.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, "i")); return m ? m[1] : ""; };

async function traer(url, ms = 15000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(url, { headers: UA, signal: c.signal, redirect: "follow" }); if (!r.ok) throw new Error(r.status); return await r.text(); }
  finally { clearTimeout(t); }
}

async function google(q) {
  const xml = await traer(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=es-419&gl=CO&ceid=CO:es-419`);
  return xml.split("<item>").slice(1).map(it => {
    let titulo = limpiar(tag(it, "title"));
    const fuente = limpiar(tag(it, "source"));
    if (fuente && titulo.endsWith(" - " + fuente)) titulo = titulo.slice(0, -(fuente.length + 3));
    return { titulo, url: limpiar(tag(it, "link")), fecha: new Date(limpiar(tag(it, "pubDate"))).toISOString(), fuente, resumen: "", imagen: null };
  });
}

async function bing(q) {
  const xml = await traer(`https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&setlang=es-co&cc=co`);
  return xml.split("<item>").slice(1).map(it => {
    let url = limpiar(tag(it, "link"));
    try { const u = new URL(url); if (u.searchParams.get("url")) url = u.searchParams.get("url"); } catch {}
    const img = (it.match(/<News:Image>([\s\S]*?)<\/News:Image>/i) || [])[1];
    return { titulo: limpiar(tag(it, "title")), url, fecha: new Date(limpiar(tag(it, "pubDate"))).toISOString(), fuente: limpiar(tag(it, "News:Source")), resumen: limpiar(tag(it, "description")).slice(0, 280), imagen: img ? limpiar(img) : null };
  });
}

async function imagenDe(url) {
  if (!url || url.includes("news.google.com")) return null;
  try {
    const html = (await traer(url, 8000)).slice(0, 200000);
    const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image/i);
    return m ? new URL(m[1], url).href : null;
  } catch { return null; }
}

const clave = n => n.titulo.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, "").slice(0, 70);
const relevante = n => { const s = (n.titulo + " " + n.resumen).toLowerCase(); return LUGAR.some(k => s.includes(k)) && TEMA.some(k => s.includes(k)); };

async function noticias() {
  let previas = [];
  try { previas = JSON.parse(await readFile("data/noticias.json", "utf8")).noticias || []; } catch {}
  const todas = [...previas];
  for (const q of BUSQUEDAS) {
    for (const f of [google, bing]) {
      try { todas.push(...(await f(q))); } catch (e) { console.log("Falló", f.name, q, e.message); }
    }
  }
  const vistos = new Map();
  for (const n of todas) {
    if (!n.titulo || !n.url || isNaN(new Date(n.fecha))) continue;
    if (!relevante(n)) continue;
    const k = clave(n);
    const ya = vistos.get(k);
    if (!ya) vistos.set(k, n);
    else { if (!ya.imagen && n.imagen) ya.imagen = n.imagen; if (ya.url.includes("news.google.com") && !n.url.includes("news.google.com")) ya.url = n.url; }
  }
  const lista = [...vistos.values()].sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).slice(0, 100);
  let buscadas = 0;
  for (const n of lista) { if (!n.imagen && buscadas < 20) { n.imagen = await imagenDe(n.url); buscadas++; } }
  return lista;
}

// ===== SECOP II (datos abiertos de Colombia Compra Eficiente) =====
async function socrata(ds, q) {
  const t = await traer(`https://www.datos.gov.co/resource/${ds}.json?$q=${encodeURIComponent(q)}&$limit=200`, 30000);
  return JSON.parse(t);
}
const OBRA = /PARQUE|ESPACIO P[UÚ]BLICO|PALMAR|CAMELLO|TRI[AÁ]NGULO|POLIDEPORTIV|CANCHA|COLISEO|MALEC[OÓ]N|ACUEDUCTO|ALCANTARILLAD|PAVIMENT|PLACA HUELLA|PUENTE|ANDEN|ANDÉN|CONSTRUCCI[OÓ]N|ADECUACI[OÓ]N|MEJORAMIENTO/;
const enCaucasia = o => { const s = JSON.stringify(o).toUpperCase(); return s.includes("CAUCASIA") || (s.includes("EDURHABA") && s.includes("PALMAR")); };

// Saca solo los campos que sirven, aguantando nombres distintos
const de = (o, ...ks) => { for (const k of ks) if (o[k] != null && o[k] !== "") return o[k]; return null; };
const url = o => { const u = de(o, "urlproceso", "url_proceso"); return u && typeof u === "object" ? u.url : u; };
const contrato = o => ({
  tipo: "contrato",
  id: de(o, "id_contrato", "referencia_del_contrato"),
  entidad: de(o, "nombre_entidad", "entidad"),
  objeto: limpiar(de(o, "objeto_del_contrato", "descripcion_del_proceso") || ""),
  contratista: de(o, "proveedor_adjudicado"),
  valor: Number(de(o, "valor_del_contrato")) || null,
  pagado: Number(de(o, "valor_pagado")) || null,
  facturado: Number(de(o, "valor_facturado")) || null,
  estado: de(o, "estado_contrato"),
  inicio: (de(o, "fecha_de_inicio_del_contrato") || "").slice(0, 10) || null,
  fin: (de(o, "fecha_de_fin_del_contrato") || "").slice(0, 10) || null,
  firma: (de(o, "fecha_de_firma") || "").slice(0, 10) || null,
  diasAdicionados: Number(de(o, "dias_adicionados")) || 0,
  url: url(o)
});
const proceso = o => ({
  tipo: "proceso",
  id: de(o, "id_del_proceso", "referencia_del_proceso"),
  entidad: de(o, "entidad", "nombre_entidad"),
  objeto: limpiar(de(o, "nombre_del_procedimiento", "descripci_n_del_procedimiento") || ""),
  contratista: de(o, "nombre_del_proveedor"),
  valor: Number(de(o, "valor_total_adjudicacion", "precio_base")) || null,
  estado: de(o, "estado_del_procedimiento", "fase"),
  firma: (de(o, "fecha_de_publicacion_del") || "").slice(0, 10) || null,
  url: url(o)
});

async function secop() {
  const out = { hora: new Date().toISOString(), contratos: [], procesos: [], ok: false };
  const consultas = ["PARQUE CAUCASIA", "PALMAR CAUCASIA", "ESPACIO PUBLICO CAUCASIA", "OBRA CAUCASIA", "ACUEDUCTO CAUCASIA", "EDURHABA PALMAR", "PARQUE EL PALMAR"];
  const vistos = new Set();
  for (const q of consultas) {
    try {
      for (const o of await socrata("jbjy-vk9h", q)) {
        if (!enCaucasia(o) || !OBRA.test(JSON.stringify(o).toUpperCase())) continue;
        const c = contrato(o); const k = "c" + (c.id || c.objeto.slice(0, 60));
        if (vistos.has(k)) continue; vistos.add(k); out.contratos.push(c);
      }
      out.ok = true;
    } catch (e) { console.log("SECOP contratos", q, e.message); }
    try {
      for (const o of await socrata("p6dx-8zbt", q)) {
        if (!enCaucasia(o) || !OBRA.test(JSON.stringify(o).toUpperCase())) continue;
        const p = proceso(o); const k = "p" + (p.id || p.objeto.slice(0, 60));
        if (vistos.has(k)) continue; vistos.add(k); out.procesos.push(p);
      }
      out.ok = true;
    } catch (e) { console.log("SECOP procesos", q, e.message); }
  }
  const porFecha = (a, b) => String(b.firma || b.inicio || "").localeCompare(String(a.firma || a.inicio || ""));
  out.contratos.sort(porFecha); out.procesos.sort(porFecha);
  out.contratos = out.contratos.slice(0, 120); out.procesos = out.procesos.slice(0, 80);
  return out;
}

const lista = await noticias();
await writeFile("data/noticias.json", JSON.stringify({ actualizado: new Date().toISOString(), noticias: lista }, null, 1));
console.log("Noticias guardadas:", lista.length);

const s = await secop();
if (s.ok) await writeFile("data/secop.json", JSON.stringify(s, null, 1));
console.log("SECOP:", s.contratos.length, "contratos /", s.procesos.length, "procesos");

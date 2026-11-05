// La casilla «regulado» (lleva lote) de la ficha de un producto en el sistema.
//
// Traducción de `scripts/erp/regulado-masivo.mjs`, que es el original y donde
// está explicado el porqué de cada campo. Lo esencial:
//
// - El sistema NO tiene un «cambiar sólo regulado»: `senddata()` de
//   `funciones_producto.js` manda la ficha COMPLETA (presentaciones con sus 7
//   precios y costo, descuentos, proveedor, categoría, casillas). Así que se
//   arma el mismo sobre desde la ficha recién leída, con un solo cambio.
// - Después de guardar se RELEE y se compara campo por campo contra la foto de
//   antes. Una diferencia que no sea `regulado` lanza: es la señal de que el
//   sobre no reproduce bien el formulario, y seguir sería pisar precios.
//
// Si se cambia el sobre acá, cambiarlo también en el script (y al revés).

import { BASE, pedir } from "./erp-dte.ts";

const EDITAR = `${BASE}/editar_producto.php`;

const des = (s: string | null | undefined) => String(s ?? "")
  .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
const attr = (tag: string, nombre: string) => {
  const m = new RegExp(`\\b${nombre}=(["'])([\\s\\S]*?)\\1`).exec(tag);
  return m ? des(m[2]) : null;
};
const inputPorId = (html: string, id: string) =>
  new RegExp(`<input\\b[^>]*\\bid=["']${id}["'][^>]*>`).exec(html)?.[0] ?? null;
const valor = (html: string, id: string) => attr(inputPorId(html, id) ?? "", "value") ?? "";
const marcado = (html: string, id: string) => /\bchecked\b/.test(inputPorId(html, id) ?? "");
function seleccion(html: string, id: string) {
  const m = new RegExp(`<select[^>]*\\bid=["']${id}["'][^>]*>([\\s\\S]*?)</select>`).exec(html);
  if (!m) return { value: "", label: "" };
  const o = /<option[^>]*value=["']?([^"'>\s]*)["']?[^>]*\bselected\b[^>]*>([^<]*)/.exec(m[1]);
  // Sin `selected`, jQuery `.val()` devuelve la PRIMERA opción.
  const p = o ?? /<option[^>]*value=["']?([^"'>\s]*)["']?[^>]*>([^<]*)/.exec(m[1]);
  return p ? { value: p[1], label: des(p[2]).trim() } : { value: "", label: "" };
}
const celda = (fila: string, clase: string) => {
  const m = new RegExp(`<td[^>]*class=['"][^'"]*\\b${clase}\\b[^'"]*['"][^>]*>([\\s\\S]*?)</td>`).exec(fila);
  return m ? des(m[1]) : "";
};

export interface Ficha {
  id: number;
  nombre: string; barcode: string; marca: string; composicion: string;
  proveedor: { value: string; label: string };
  categoria: { value: string; label: string };
  laboratorio: { value: string; label: string };
  exento: boolean; perecedero: boolean; activo: boolean; decimal: boolean;
  regulado: boolean; antibiotico: boolean;
  presentaciones: {
    exis: boolean; id_prp: string; id_pp: string; des: string; unidad: string;
    costo: string; bar: string; precios: string[]; oculta: boolean;
  }[];
  descuentos: string[];
  conUbi: boolean;
}

export function leerFicha(id: number, html: string): Ficha {
  if (!inputPorId(html, "descripcion")) throw new Error(`La ficha ${id} no se pudo leer.`);
  const idEnFicha = valor(html, "id_producto").trim();
  if (idEnFicha !== String(id)) throw new Error(`La ficha pedida es ${id} y la página trae ${idEnFicha}.`);

  const tabla = /id=["']presentacion_table["'][^>]*>([\s\S]*?)<\/tbody>/.exec(html)?.[1] ?? "";
  const presentaciones = tabla.split(/<tr\b/i).slice(1).map((tr) => {
    const fila = "<tr" + tr;
    return {
      exis: /^<tr[^>]*class=['"]exis['"]/.test(fila),
      id_prp: attr(/<input[^>]*class=['"]id_pres_prod['"][^>]*>/.exec(fila)?.[0] ?? "", "value") ?? "0",
      id_pp: attr(/<input[^>]*class=['"]presentacion['"][^>]*>/.exec(fila)?.[0] ?? "", "value") ?? "",
      des: celda(fila, "descripcion_p"),
      unidad: celda(fila, "unidad_p"),
      costo: celda(fila, "costo"),
      bar: celda(fila, "bar"),
      precios: [0, 1, 2, 3, 4, 5, 6].map((k) => celda(fila, `precio${k}`)),
      oculta: /fa-eye-slash/.test(fila),
    };
  });
  const descuentos = [0, 1, 2, 3, 4, 5, 6].map((k) =>
    attr(new RegExp(`<input[^>]*class=["'][^"']*\\bdesc${k}\\b[^"']*["'][^>]*>`).exec(html)?.[0] ?? "", "value") ?? "0");
  const comp = /<textarea[^>]*\bid=["']composicion["'][^>]*>([\s\S]*?)<\/textarea>/.exec(html)?.[1] ?? "";
  const conUbi = /\bid=["']ubi["']/.test(html) || /\bid=["']minimo["']/.test(html);

  return {
    id, nombre: valor(html, "descripcion"), barcode: valor(html, "barcode"), marca: valor(html, "marca"),
    composicion: des(comp),
    proveedor: seleccion(html, "proveedor"), categoria: seleccion(html, "id_categoria"),
    laboratorio: seleccion(html, "id_laboratorio"),
    exento: marcado(html, "exento"), perecedero: marcado(html, "perecedero"), activo: marcado(html, "activo"),
    decimal: marcado(html, "decimal"), regulado: marcado(html, "regulado"), antibiotico: marcado(html, "antibiotico"),
    presentaciones, descuentos, conUbi,
  };
}

/** El mismo sobre que arma `senddata()` con process=edited. */
function sobreDeEdicion(f: Ficha, regulado: boolean): URLSearchParams {
  const casilla = (b: boolean) => (b ? "1" : "undefined");
  const num = (t: string) => (Number.isNaN(parseFloat(t)) ? 0 : t);
  const lista = f.presentaciones.map((p) =>
    [p.id_pp, p.des, p.unidad, 0, p.exis ? p.id_prp : 0, p.costo, p.bar,
      p.precios.map((x) => `${num(x)}#`).join("")].join(",") + ";").join("");
  const s = new URLSearchParams({
    process: "edited", id_producto: String(f.id), barcode: f.barcode, descripcion: f.nombre,
    exento: casilla(f.exento), proveedor: f.proveedor.value, id_categoria: f.categoria.value,
    perecedero: casilla(f.perecedero), lista,
    marca: f.marca, minimo: "undefined", cuantos: String(f.presentaciones.length),
    estado: f.activo ? "1" : "0", decimals: casilla(f.decimal), composicion: f.composicion,
    id_laboratorio: f.laboratorio.value, json_arr: "[]",
    regulado: regulado ? "1" : "0", antibiotico: f.antibiotico ? "1" : "0",
  });
  f.descuentos.forEach((d, i) => s.append(`desc${i}`, String(Number.isNaN(parseFloat(d)) ? 0 : parseFloat(d))));
  return s;
}

/** Todo lo que NO debe cambiar al tocar la casilla, en texto comparable. */
const huella = (f: Ficha) => JSON.stringify({ ...f, regulado: undefined });

export async function leerFichaDe(cookie: string, id: number): Promise<Ficha> {
  return leerFicha(id, await pedir(cookie, `${EDITAR}?id_producto=${id}`, undefined,
    { extra: { Referer: `${BASE}/admin_producto.php` } }));
}

/**
 * Pone «regulado» en `valor` y lo VERIFICA releyendo la ficha. Lanza si el
 * sistema no lo aceptó o si la ficha quedó distinta en otra cosa. Devuelve la
 * ficha de antes (para poder restaurarla con la misma huella).
 */
export async function cambiarRegulado(cookie: string, id: number, valor: boolean): Promise<Ficha> {
  const antes = await leerFichaDe(cookie, id);
  if (antes.regulado === valor) return antes;
  if (antes.conUbi) throw new Error(`La ficha ${id} trae campos que el sobre no conoce.`);
  if (!antes.presentaciones.length) throw new Error(`La ficha ${id} no tiene presentaciones.`);

  let resp = "";
  try {
    // Una escritura: un solo intento. Si la conexión se cae, se averigua releyendo.
    resp = await pedir(cookie, EDITAR, sobreDeEdicion(antes, valor),
      { extra: { Referer: `${BASE}/admin_producto.php` }, reintentos: 1 });
  } catch { /* se decide abajo con la relectura */ }
  let j: { typeinfo?: string; msg?: string } | null = null;
  try { j = JSON.parse(resp); } catch { /* idem */ }

  const despues = await leerFichaDe(cookie, id);
  if (despues.regulado !== valor)
    throw new Error(`El sistema no cambió el control de lote de ${antes.nombre}: ${(j?.msg ?? resp.slice(0, 160)) || "sin respuesta"}`);
  if (huella(despues) !== huella(antes))
    throw new Error(`La ficha de ${antes.nombre} quedó distinta al cambiar el control de lote.`);
  return antes;
}

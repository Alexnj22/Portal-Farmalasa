// Cuánto se toma cada vez (2026-11-03, «si me tomo 1/4? si me tomo 3? no tengo
// esas opciones»). Antes la hoja ofrecía sólo ½, 1, 1½ y 2; ahora va de ¼ en ¼
// desde ¼ hasta 10, con atajos para lo más común. Sin React Native adentro:
// sólo números y texto, para poder usarlo en la hoja, en la lista y en el
// texto del aviso.
//
// El valor siempre fue un número (0.5, 1.5) en el archivo del teléfono, así que
// lo guardado antes se lee igual. `normalizarCantidad` además acepta texto
// («1.5», «1,5») y redondea al cuarto más cercano por si algo llega raro.

export const CANTIDAD_MIN = 0.25;
export const CANTIDAD_MAX = 10;
export const CANTIDAD_PASO = 0.25;
export const CANTIDADES_RAPIDAS = [0.25, 0.5, 1, 2, 3];

const FRACCION = { 0.25: '¼', 0.5: '½', 0.75: '¾' };

/** Cualquier cosa guardada → un número de cuartos entre ¼ y 10 (1 si no se entiende). */
export function normalizarCantidad(v, porDefecto = 1) {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return porDefecto;
  const cuartos = Math.round(n / CANTIDAD_PASO) * CANTIDAD_PASO;
  return Math.min(CANTIDAD_MAX, Math.max(CANTIDAD_MIN, cuartos));
}

/** 0.25 → «¼», 1.5 → «1 ½», 3 → «3». Lo que no es un cuarto exacto, con coma. */
export function fraccionTexto(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return '';
  const entero = Math.floor(x + 1e-9);
  const resto = Math.round((x - entero) * 100) / 100;
  if (resto === 0) return String(entero);
  if (FRACCION[resto]) return entero ? `${entero} ${FRACCION[resto]}` : FRACCION[resto];
  return String(Math.round(x * 100) / 100).replace('.', ',');
}

/** «¼ tableta», «1 tableta», «1 ½ tabletas», «3 tabletas». Plural sólo de más de una. */
export function cantidadTexto(n, unidad = 'tableta', plural = `${unidad}s`) {
  const t = fraccionTexto(n);
  if (!t) return '';
  return `${t} ${Number(n) > 1 ? plural : unidad}`;
}

/** Un paso más o menos (±¼), sin salirse del rango. */
export const moverCantidad = (n, d) => normalizarCantidad(normalizarCantidad(n) + d * CANTIDAD_PASO);

// En qué viene (2026-11-04): «½ tableta» de una cápsula o un sobre se leía
// mal. Sale del nombre del producto; lo que no se reconoce queda en tableta,
// que es lo que la lista automática ve casi siempre.
const UNIDADES = [
  [/\bCAP(S|SULA|SULAS)?\b|C[AÁ]PSULA/, 'cápsula', 'cápsulas'],
  [/\bSOBRES?\b/, 'sobre', 'sobres'],
  [/\bGRAGEAS?\b/, 'gragea', 'grageas'],
  [/\bCOMPRIMIDOS?\b/, 'comprimido', 'comprimidos'],
];
export function unidadDe(nombre) {
  const s = String(nombre ?? '').toUpperCase();
  for (const [re, u, p] of UNIDADES) if (re.test(s)) return [u, p];
  return ['tableta', 'tabletas'];
}
/** cantidadTexto con la unidad del producto: «1 cápsula», «2 sobres». */
export const cantidadDe = (n, nombre) => cantidadTexto(n, ...unidadDe(nombre));

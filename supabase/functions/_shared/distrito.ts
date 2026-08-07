// Elegir el distrito de una ficha a partir de su dirección.
//
// ── Esto es una TRADUCCIÓN, no una reescritura ─────────────────────────────
// El original es `elegir_distrito` en `scripts/migracion-clientes/bloque.py`,
// que decidió sobre 25,946 fichas reales. Esa cifra ES su validación: tres de
// las seis reglas no se dedujeron leyendo el problema, se descubrieron
// midiendo corridas y corrigiendo lo que salía mal.
//
// Por eso esta versión no se dio por buena porque "se ve igual": se verificó
// enfrentándola al original sobre esos 25,946 casos, con
// `scripts/migracion-clientes/comparar_matcher.mjs`. Cualquier cambio acá tiene
// que volver a pasar esa comparación — si no, se pierde justo lo que hace
// confiable a esta función.
//
// Un port que omite una guarda no falla ruidosamente: escribe un distrito
// PLAUSIBLE en una ficha fiscal. `descartar_los_que_son_la_ubicacion` existe
// porque sin ella 2 de 2,078 fichas quedaron mal (`CHALATENANGO` en vez de
// `NUEVA TRINIDAD`), o sea ~55 distritos equivocados a escala del catálogo.

export type Opcion = [value: string, etiqueta: string];

/** Tokens que no distinguen ningún distrito: aparecen en media docena. */
const VACIAS = new Set([
  "SAN", "SANTA", "SANTO", "NUEVA", "NUEVO", "NVA", "DE", "DEL", "LA",
  "EL", "LAS", "LOS", "SN", "DULCE", "NOM", "NOMBRE", "JESUS",
]);

/**
 * Igual que `norm()` del original: NFKD, sin diacríticos, solo A-Z0-9 y espacio.
 *
 * OJO CON EL ORDEN, y con lo que NO hace. El original colapsa `\s+` ANTES de
 * convertir la puntuación en espacios, y después ya no vuelve a colapsar. O sea
 * que deja espacios dobles donde había una coma:
 *
 *   "AGUA, CALIENTE, CHALATENANGO"  →  "AGUA  CALIENTE  CHALATENANGO"
 *
 * Y eso cambia decisiones: con dos espacios, `"AGUA CALIENTE"` NO aparece como
 * substring, así que el nombre completo no matchea y la elección cae a la regla
 * de abreviatura. Mismo distrito, distinto motivo.
 *
 * La primera versión de esta traducción agregaba un `\s+ → " "` final y
 * "arreglaba" eso — y fue la ÚNICA diferencia en los 25,946 casos. Se quitó a
 * propósito: la traducción tiene que reproducir el original, defectos incluidos.
 * Mejorarlo es una decisión aparte, y hay que tomarla en `bloque.py` primero.
 */
export function norm(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")          // combining marks — el `unicodedata.combining`
    .toUpperCase()
    .replace(/\s+/g, " ")
    .replace(/[^A-Z0-9 ]/g, " ")
    .trim();
}

function tokensDistintivos(etiqueta: string): Set<string> {
  return new Set(norm(etiqueta).split(" ").filter(t => t.length >= 5 && !VACIAS.has(t)));
}

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * "CHALATENANGO" es departamento, municipio Y distrito. Si es el único hit y la
 * dirección lo usa como los otros dos, no prueba nada.
 */
function guardaChalatenango(hits: Opcion[], direccion: string): Opcion[] {
  if (hits.length === 1 && norm(hits[0][1]) === "CHALATENANGO" &&
      /(MUNICIPIO|DEPARTAMENTO)/.test(norm(direccion))) return [];
  return hits;
}

/** v1: el nombre del distrito aparece entero en la dirección. Evidencia fuerte. */
function porNombreCompleto(direccion: string, ops: Opcion[]): Opcion[] {
  const dirn = norm(direccion);
  return guardaChalatenango(
    ops.filter(([, t]) => norm(t) && dirn.includes(norm(t))), direccion);
}

/**
 * v2: distritos cuyo token distintivo aparece en la dirección. Alcanza lo que
 * el substring no: el ERP abrevia ("NVA CONCEPCIÓN") y la gente escribe
 * completo. Evidencia más débil — va DESPUÉS del v1, no en su lugar.
 */
function candidatosDistrito(direccion: string, ops: Opcion[]): Opcion[] {
  const palabras = new Set(norm(direccion).split(" "));
  return guardaChalatenango(
    ops.filter(([, t]) => [...tokensDistintivos(t)].some(x => palabras.has(x))),
    direccion);
}

/** Entre varios candidatos, los que la dirección nombra COMPLETOS. */
function preferirNombradosEntero(hits: Opcion[], direccion: string): Opcion[] {
  if (hits.length < 2) return hits;
  const palabras = new Set(norm(direccion).split(" "));
  const enteros = hits.filter(([, t]) => {
    const toks = tokensDistintivos(t);
    return toks.size > 0 && [...toks].every(x => palabras.has(x));
  });
  return enteros.length ? enteros : hits;
}

/**
 * Saca de los candidatos a los que se llaman igual que el departamento o el
 * municipio DE ESTA FICHA. La gente escribe "DISTRITO, DEPARTAMENTO" y varios
 * departamentos tienen un distrito homónimo; sin esto el matcher desempataba
 * por sorteo y acertaba la mitad de las veces.
 *
 * Solo con MÁS DE UN candidato: con uno solo puede ser que la persona viva en
 * el distrito que se llama igual que su departamento.
 */
function descartarLosQueSonLaUbicacion(hits: Opcion[], ubicacion: Set<string>): Opcion[] {
  if (hits.length < 2 || !ubicacion?.size) return hits;
  const quedan = hits.filter(([, t]) => !ubicacion.has(norm(t)));
  return quedan.length ? quedan : hits;
}

/**
 * Entre varios candidatos, el que la dirección nombra MÁS TARDE. La dirección
 * salvadoreña va de lo específico a lo general (barrio, cantón, distrito,
 * departamento), así que entre dos topónimos el distrito es el posterior.
 *
 * Va DESPUÉS de descartar la ubicación, nunca antes: en "NUEVA TRINIDAD,
 * CHALATENANGO" el nombrado más tarde es el DEPARTAMENTO.
 */
function preferirElNombradoMasTarde(hits: Opcion[], direccion: string): Opcion[] {
  if (hits.length < 2) return hits;
  const dirn = norm(direccion);
  const donde = (etiqueta: string): number | null => {
    const toks = tokensDistintivos(etiqueta);
    const lista = toks.size ? [...toks] : [norm(etiqueta)];
    const pos: number[] = [];
    for (const tok of lista) {
      if (!tok) continue;
      const m = new RegExp(`\\b${escapar(tok)}\\b`).exec(dirn);
      if (m) pos.push(m.index);
    }
    return pos.length ? Math.min(...pos) : null;
  };
  const ubicados = hits.map(([v, t]) => ({ p: donde(t), v, t }));
  if (ubicados.some(u => u.p === null)) return hits;
  const ultima = Math.max(...ubicados.map(u => u.p as number));
  const ganan = ubicados.filter(u => u.p === ultima);
  return ganan.length === 1 ? ganan.map(u => [u.v, u.t] as Opcion) : hits;
}

/** `int(sha256(portal_id)[:8], 16)` — los primeros 8 HEX, no los 8 bytes. */
export async function semillaDe(portalId: string): Promise<number> {
  const bytes = new TextEncoder().encode(String(portalId));
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let hex = "";
  for (const b of hash.slice(0, 4)) hex += b.toString(16).padStart(2, "0");
  return parseInt(hex, 16);
}

export interface Eleccion {
  value: string | null;
  motivo: string;
  candidatos: Opcion[];
}

/**
 * (value, motivo, candidatos). Siempre devuelve algo reproducible.
 *
 * `ubicacion` son los nombres normalizados del departamento y el municipio de
 * ESTA ficha, más la primera palabra del municipio — los 44 municipios se
 * llaman "<Departamento> <cardinal>", así que esa primera palabra vuelve a
 * nombrar al departamento y no distingue nada.
 */
export async function elegirDistrito(
  portalId: string,
  direccion: string,
  ops: Opcion[],
  ubicacion: Set<string> = new Set(),
): Promise<Eleccion> {
  if (!ops?.length) return { value: null, motivo: "sin opciones", candidatos: [] };
  const semilla = await semillaDe(portalId);

  const fuertes = descartarLosQueSonLaUbicacion(
    porNombreCompleto(direccion, ops), ubicacion);
  if (fuertes.length === 1)
    return { value: fuertes[0][0], motivo: "dirección (nombre completo)", candidatos: fuertes };

  const debiles = preferirNombradosEntero(
    descartarLosQueSonLaUbicacion(candidatosDistrito(direccion, ops), ubicacion),
    direccion);
  if (debiles.length === 1)
    return { value: debiles[0][0], motivo: "dirección (abreviatura)", candidatos: debiles };

  // La dirección nombra varios. Elegir entre ESOS es estrictamente mejor que
  // sortear entre los 20 del municipio.
  const hits = fuertes.length > 1 ? fuertes : debiles;
  if (hits.length > 1) {
    const tarde = preferirElNombradoMasTarde(hits, direccion);
    if (tarde.length === 1)
      return { value: tarde[0][0], motivo: "dirección (el nombrado más tarde)", candidatos: hits };
    return { value: hits[semilla % hits.length][0],
             motivo: `ambiguo (${hits.length} candidatos)`, candidatos: hits };
  }
  return { value: ops[semilla % ops.length][0],
           motivo: "determinista (dirección no dice)", candidatos: [] };
}

/** Los nombres con los que se compara la ubicación propia de la ficha. */
export function ubicacionDe(departamento: string, municipio: string): Set<string> {
  const out = new Set<string>();
  for (const etiqueta of [departamento, municipio]) {
    if (!etiqueta) continue;
    out.add(norm(etiqueta));
    out.add(norm(etiqueta.split(" ")[0]));
  }
  return out;
}

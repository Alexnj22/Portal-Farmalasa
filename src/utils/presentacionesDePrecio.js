import { nivelesVisibles } from './preciosDeProducto';

/* La parte sin pantalla de la consulta de precios (widget del portal y app del
 * personal): qué niveles se muestran y
 * cómo se arman las presentaciones. Archivo aparte para que la pantalla sólo
 * exporte componentes (fast refresh) y la prueba llegue a la lógica. */
export const TOPE_DEL_WIDGET = 'mayoreo'; // «Mayoreo Plus»
export const NIVELES = nivelesVisibles(TOPE_DEL_WIDGET);
export const COLUMNAS = NIVELES.map(n => n.key).join(', ');

/* Los dos que llevan el protagonismo: Regular y Preferente —«el precio normal»,
 * lo pidió el usuario (2026-11-15)—. Los demás van debajo, en lista. */
const CLAVES_DESTACADAS = ['vineta', 'vip'];
export const DESTACADOS = NIVELES.filter(n => CLAVES_DESTACADAS.includes(n.key));
export const RESTO = NIVELES.filter(n => !CLAVES_DESTACADAS.includes(n.key));
export const PRINCIPAL = NIVELES[0]; // Regular: el que ordena las variantes

export const titulo = (s) => { const t = String(s ?? '').trim().toLowerCase(); return t ? t[0].toUpperCase() + t.slice(1) : ''; };
const firmaDePrecios = (p) => NIVELES.map(n => Number(p[n.key] ?? NaN).toFixed(4)).join('|');
const factorDe = (x) => Number(x?.factor) || 1;

/**
 * Las presentaciones activas con sus precios, sin las repetidas idénticas
 * (mismo factor y los mismos cinco precios, aunque el tipo se llame distinto).
 * @returns {{ id, tipo, nombre, unidades, precios }[]}
 */
export function presentacionesParaMostrar(precios) {
  const vistas = new Map();
  for (const p of (precios ?? []).filter(x => x.activo !== false)) {
    const tipo = p.presentaciones?.tipo || p.descripcion || 'Presentación';
    const k = `${factorDe(p)}|${firmaDePrecios(p)}`;
    if (!vistas.has(k)) vistas.set(k, { ...p, tipo });
  }
  return [...vistas.values()].map(p => ({
    id: p.id_presentacion,
    tipo: p.tipo,
    nombre: titulo(p.tipo),
    unidades: factorDe(p),
    precios: Object.fromEntries(NIVELES.map(n => [n.key, p[n.key]])),
  }));
}

/**
 * Agrupadas por FACTOR —lo que el cliente se lleva: 1, 10, 30 unidades—, con
 * los precios distintos como variantes ordenadas por Regular. Si en un factor
 * conviven tipos con nombre distinto («Caja» y «Unidad» de 1), el grupo los
 * nombra a los dos y cada variante dice el suyo. Los lotes son los de la sala
 * con ese factor.
 * @returns {{ clave, nombre, unidades, variantes, conTipos, existencia, lotes }[]}
 */
export function agruparPorPresentacion(lista, lotes = []) {
  const grupos = new Map();
  for (const p of lista ?? []) {
    const clave = String(p.unidades);
    if (!grupos.has(clave)) grupos.set(clave, { clave, unidades: p.unidades, variantes: [] });
    grupos.get(clave).variantes.push(p);
  }
  return [...grupos.values()]
    .map(g => {
      g.variantes.sort((a, b) => (Number(a.precios[PRINCIPAL.key]) || 0) - (Number(b.precios[PRINCIPAL.key]) || 0));
      const nombres = [...new Set(g.variantes.map(v => v.nombre))];
      const suyos = (lotes ?? []).filter(l => factorDe(l) === g.unidades);
      return {
        ...g,
        nombre: nombres.join(' / '),
        conTipos: nombres.length > 1,
        lotes: suyos,
        existencia: suyos.reduce((s, l) => s + (Number(l.cantidad) || 0), 0),
      };
    })
    // De la más chica a la más grande: unidad, blíster, caja.
    .sort((a, b) => a.unidades - b.unidades);
}


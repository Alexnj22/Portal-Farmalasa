import { nivelesVisibles } from '@nucleo/utils/preciosDeProducto';

/* La parte sin pantalla de `PreciosDelProducto.jsx`: qué niveles se muestran y
 * cómo se arman las presentaciones. Archivo aparte para que la pantalla sólo
 * exporte componentes (fast refresh) y la prueba llegue a la lógica. */
export const TOPE_DEL_WIDGET = 'mayoreo'; // «Mayoreo Plus»
export const NIVELES = nivelesVisibles(TOPE_DEL_WIDGET);
export const COLUMNAS = NIVELES.map(n => n.key).join(', ');
export const [PRINCIPAL, ...SECUNDARIOS] = NIVELES;

const normal = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
export const titulo = (s) => { const t = String(s ?? '').trim().toLowerCase(); return t ? t[0].toUpperCase() + t.slice(1) : ''; };
const firmaDePrecios = (p) => NIVELES.map(n => Number(p[n.key] ?? NaN).toFixed(4)).join('|');

/** ¿Este lote es de esta presentación? Mismo factor y el mismo tipo. */
function loteEsDe(lote, pres) {
  const fl = Number(lote.factor) || 1;
  const fp = Number(pres.factor) || 1;
  if (fl !== fp) return false;
  const a = normal(lote.presentacion);
  const b = normal(pres.tipo);
  return !!a && !!b && (a === b || a.startsWith(b) || b.startsWith(a));
}

/**
 * Las presentaciones tal como se muestran: sin las repetidas idénticas, con un
 * nombre que las distingue y la existencia de la sala que les corresponde.
 * @returns {{ id, tipo, nombre, unidades, codigo, precios, existencia, lotes }[]}
 */
export function presentacionesParaMostrar(precios, lotes) {
  const activas = (precios ?? []).filter(p => p.activo !== false);
  const vistas = new Map();
  for (const p of activas) {
    const tipo = p.presentaciones?.tipo || p.descripcion || 'Presentación';
    const k = `${normal(tipo)}|${Number(p.factor) || 1}|${firmaDePrecios(p)}`;
    if (!vistas.has(k)) vistas.set(k, { ...p, tipo });
  }
  const unicas = [...vistas.values()];
  const cuantasConNombre = new Map();
  for (const p of unicas) {
    const k = `${normal(p.tipo)}|${Number(p.factor) || 1}`;
    cuantasConNombre.set(k, (cuantasConNombre.get(k) ?? 0) + 1);
  }
  return unicas
    .map(p => {
      const unidades = Number(p.factor) || 1;
      const repetida = cuantasConNombre.get(`${normal(p.tipo)}|${unidades}`) > 1;
      const suyos = (lotes ?? []).filter(l => loteEsDe(l, p));
      return {
        id: p.id_presentacion,
        tipo: p.tipo,
        nombre: titulo(p.tipo),
        unidades,
        codigo: repetida ? p.id_presentacion : null,
        precios: Object.fromEntries(NIVELES.map(n => [n.key, p[n.key]])),
        existencia: suyos.reduce((s, l) => s + (Number(l.cantidad) || 0), 0),
        lotes: suyos,
      };
    })
    // De la más chica a la más grande: unidad, blíster, caja.
    .sort((a, b) => a.unidades - b.unidades || a.nombre.localeCompare(b.nombre) || a.id - b.id);
}


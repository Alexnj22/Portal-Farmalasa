// El uso de las secciones del Inicio, en ESTE teléfono y por persona
// (`utils/ordenPorUso.js` hace la cuenta). Se guarda en el almacén de la app.
import { leer, guardar } from '@plataforma/almacen';
import { anotarUso, ordenarPorUso } from '@nucleo/utils/ordenPorUso';
import { ordenDeLaPestana } from '@nucleo/constants/dashboardTabs';

const clave = (userId) => `inicio.uso.${userId ?? 'anon'}`;

export function leerUso(userId) {
  try { return JSON.parse(leer(clave(userId)) || '{}'); } catch { return {}; }
}

export function anotar(userId, id) {
  try { guardar(clave(userId), JSON.stringify(anotarUso(leerUso(userId), id))); } catch { /* sin almacén: no aprende */ }
}

export const ordenar = (ids, userId) => ordenarPorUso(ids, leerUso(userId));

// ── El acomodo publicado de las pestañas temáticas ──────────────────────────
//
// Comercial, RRHH y Operación las acomoda el SU en el portal y las ve así todo
// el mundo (`dashboard_canon`, `ordenDeLaPestana`); General es de cada quien.
// En la app, una pestaña temática con acomodo publicado sigue ese orden; sin
// acomodo publicado, el del uso. Si quien mira puede acomodar (SU) y acomodó
// esa pestaña en el portal, manda la suya, como en el portal.
//
// La sección «Pedir un ajuste» junta tres widgets del portal: va donde va el
// primero de ellos. «Pendiente para ti» no tiene widget: va arriba.
const WIDGETS_DE_SECCION = { pedir_ajuste: ['annulment_req', 'inv_movement', 'minmax_req'] };
const ARRIBA = new Set(['pendientes']);

/** El orden de los widgets del portal que ve una pestaña, o null si manda el uso. */
export function ordenWebDeLaPestana(pestana, { canon, propio }) {
  if (pestana === 'general') return null;
  const mio = propio?.[pestana];
  if (mio && typeof mio === 'object' && Object.keys(mio).length) {
    return Object.keys(mio).sort((a, b) => (mio[a]?.row ?? 0) - (mio[b]?.row ?? 0) || (mio[a]?.col ?? 0) - (mio[b]?.col ?? 0));
  }
  const publicado = canon?.[pestana];
  if (!publicado?.length) return null;
  return ordenDeLaPestana(pestana, publicado, () => true);
}

/**
 * Reordena `ids` (ya en el orden del uso) según `ordenWeb`. Lo que el portal no
 * nombra va al final; los empates conservan el orden del uso.
 */
export function ordenarSegunWeb(ids, ordenWeb, widgetWeb) {
  if (!ordenWeb) return ids;
  const pos = new Map(ordenWeb.map((w, i) => [w, i]));
  const lugar = (id) => {
    if (ARRIBA.has(id)) return -1;
    const ws = WIDGETS_DE_SECCION[id] ?? (widgetWeb[id] ? [widgetWeb[id]] : []);
    const ps = ws.map((w) => pos.get(w)).filter((p) => p != null);
    return ps.length ? Math.min(...ps) : Infinity;
  };
  return ids.map((id, i) => ({ id, i, l: lugar(id) }))
    .sort((a, b) => (a.l === b.l ? 0 : a.l - b.l) || a.i - b.i)
    .map((x) => x.id);
}

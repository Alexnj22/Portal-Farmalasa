// El uso de las secciones del Inicio, en ESTE teléfono y por persona
// (`utils/ordenPorUso.js` hace la cuenta). Se guarda en el almacén de la app.
import { leer, guardar } from '@plataforma/almacen';
import { anotarUso, ordenarPorUso } from '@nucleo/utils/ordenPorUso';

const clave = (userId) => `inicio.uso.${userId ?? 'anon'}`;

export function leerUso(userId) {
  try { return JSON.parse(leer(clave(userId)) || '{}'); } catch { return {}; }
}

export function anotar(userId, id) {
  try { guardar(clave(userId), JSON.stringify(anotarUso(leerUso(userId), id))); } catch { /* sin almacén: no aprende */ }
}

export const ordenar = (ids, userId) => ordenarPorUso(ids, leerUso(userId));

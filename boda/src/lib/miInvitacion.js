import { useEffect, useState } from 'react';
import { api } from './api';
import { facilPorInvitacion } from './facil';

/*
 * La invitación de este teléfono, compartida por todas las pestañas de la app.
 * El código llega una vez por el enlace personal (/i/CODIGO) y se recuerda:
 * después «Confirmar», «Hoy» o la mesa ya saben quién es sin volver a pedirlo.
 */
const LS = 'boda-codigo';
const leer = () => { try { return localStorage.getItem(LS) || ''; } catch { return ''; } };
let codigo = leer();
let inv; // undefined = sin cargar, null = no existe
let cargando = null;
const oyentes = new Set();
const avisar = () => oyentes.forEach((f) => f(inv));

function cargar() {
  if (!codigo) { inv = null; avisar(); return Promise.resolve(null); }
  if (cargando) return cargando;
  cargando = api.getInvitacion(codigo)
    .then((r) => { inv = r ?? null; })
    .catch(() => { inv = null; })
    .finally(() => { cargando = null; facilPorInvitacion(inv?.grupo?.letra_grande); avisar(); });
  return cargando;
}

export const miCodigo = () => codigo;
export function usarCodigo(c) {
  const nuevo = (c || '').trim().toUpperCase();
  if (!nuevo || nuevo === codigo) return;
  codigo = nuevo;
  try { localStorage.setItem(LS, nuevo); } catch { /* privado */ }
  inv = undefined; avisar(); cargar();
}
export function olvidarCodigo() {
  codigo = ''; inv = null;
  try { localStorage.removeItem(LS); } catch { /* privado */ }
  facilPorInvitacion(false); avisar();
}
/** Después de responder, la invitación nueva que devolvió la base. */
export function actualizarInvitacion(r) { inv = r; avisar(); }

/** { codigo, inv } — inv: undefined mientras carga, null si no hay. */
export function useInvitacion() {
  const [v, setV] = useState(inv);
  useEffect(() => {
    oyentes.add(setV);
    if (inv === undefined) cargar(); else setV(inv);
    return () => oyentes.delete(setV);
  }, []);
  return { codigo, inv: v };
}

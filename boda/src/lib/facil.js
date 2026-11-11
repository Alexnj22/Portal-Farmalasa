import { useEffect, useState } from 'react';

/*
 * Modo fácil (letra grande): para los abuelos. Letra más grande, contraste
 * alto, sin animaciones y la confirmación de a una pregunta.
 *   · Lo enciende la invitación marcada «letra grande» por los novios.
 *   · Cualquiera lo prende o apaga con el botón «Aa»; esa elección manda.
 */
const LS = 'boda-facil';
const leerLS = () => { try { return localStorage.getItem(LS); } catch { return null; } };
let porInvitacion = false;
const oyentes = new Set();

export const facilActivo = () => {
  const elegido = leerLS();
  return elegido === '1' || (elegido == null && porInvitacion);
};
function aplicar() {
  document.documentElement.classList.toggle('facil', facilActivo());
  oyentes.forEach((f) => f(facilActivo()));
}
export function cambiarFacil(v) {
  try { localStorage.setItem(LS, v ? '1' : '0'); } catch { /* privado */ }
  aplicar();
}
/** La invitación dice si se abre en modo fácil (si la persona no eligió otra cosa). */
export function facilPorInvitacion(v) {
  porInvitacion = !!v;
  aplicar();
}
export function useFacil() {
  const [v, setV] = useState(facilActivo);
  useEffect(() => { oyentes.add(setV); aplicar(); return () => oyentes.delete(setV); }, []);
  return v;
}

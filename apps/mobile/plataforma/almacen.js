// El almacén del dispositivo — la versión del TELÉFONO. Mismo contrato que
// src/plataforma/almacen.js: síncrono y pasamanos (lanza lo que lance).
// `expo-sqlite/localStorage/install` pone un `localStorage` síncrono sobre
// SQLite; en la web de Expo no hace nada y queda el del navegador.
import 'expo-sqlite/localStorage/install';

const clavesDe = (s) => { const out = []; for (let i = 0; i < s.length; i++) out.push(s.key(i)); return out; };

export const leer = (clave) => globalThis.localStorage.getItem(clave);
export const guardar = (clave, valor) => globalThis.localStorage.setItem(clave, valor);
export const borrar = (clave) => globalThis.localStorage.removeItem(clave);
export const claves = () => clavesDe(globalThis.localStorage);

// `sessionStorage`: lo que muere al cerrar. En la app, al cerrar la app.
const memoria = new Map();
export const deLaSesion = {
  leer: (clave) => (memoria.has(clave) ? memoria.get(clave) : null),
  guardar: (clave, valor) => { memoria.set(clave, String(valor)); },
  borrar: (clave) => { memoria.delete(clave); },
  claves: () => [...memoria.keys()],
};

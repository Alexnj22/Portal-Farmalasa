// El ciclo de vida — la versión del TELÉFONO, sobre `AppState`.
//   visibilidad      ↔ activa / en segundo plano
//   actividad        ↔ un toque en la app (lo avisa la raíz con notificarActividad)
//   salida           ↔ la app pasa a segundo plano
import { AppState } from 'react-native';

export const visibilidad = () => (AppState.currentState === 'active' ? 'visible' : 'hidden');

const subsVisibilidad = new Map();
export const escucharVisibilidad = (fn) => {
  subsVisibilidad.set(fn, AppState.addEventListener('change', () => fn()));
};
export const soltarVisibilidad = (fn) => {
  subsVisibilidad.get(fn)?.remove();
  subsVisibilidad.delete(fn);
};

const oyentesActividad = new Set();
/** La llama la vista raíz en cada toque (`onTouchStart`). */
export const notificarActividad = () => { for (const fn of oyentesActividad) fn(); };
export const escucharActividad = (fn) => { oyentesActividad.add(fn); };
export const soltarActividad = (fn) => { oyentesActividad.delete(fn); };

const subsSalida = new Map();
export const escucharSalida = (fn) => {
  subsSalida.set(fn, AppState.addEventListener('change', (e) => { if (e === 'background') fn(); }));
};
export const soltarSalida = (fn) => {
  subsSalida.get(fn)?.remove();
  subsSalida.delete(fn);
};

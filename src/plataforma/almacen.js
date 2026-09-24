// ─────────────────────────────────────────────────────────────────────────────
// El almacén local del dispositivo — la versión del NAVEGADOR.
// ─────────────────────────────────────────────────────────────────────────────
//
// Existe para que la lógica del portal (`data`, `utils`, `store`, `hooks`) no
// nombre `localStorage`: en una app nativa no existe. Ahí este mismo archivo va
// a tener un gemelo `almacen.native.js` (MMKV, que también es SÍNCRONO — por
// eso esta interfaz lo es) y el empaquetador elige solo por la extensión. Plan
// completo en `docs/PLAN-NUCLEO-PORTABLE-2026-09-24.md`, fase F1.
//
// ── Es un pasamanos, a propósito ───────────────────────────────────────────
//
// Cada función hace EXACTAMENTE lo que hacía la llamada a `localStorage` que
// reemplaza, incluido lanzar: `setItem` lanza con la cuota llena, y en modo
// privado de algunos Safari `getItem` también. El código de hoy ya decide caso
// por caso dónde atrapar eso —algunos sitios lo tragan, otros quieren que
// falle—, y un adaptador que atrapara todo cambiaría en silencio cuál es cuál.
// Mudar la llamada no tiene que cambiar ni un comportamiento; si alguna vez se
// quiere tolerancia, se agrega en el LLAMADOR, donde se ve.
//
// Las mismas claves de siempre: nada se renombra, así que lo que un navegador
// ya tiene guardado se sigue leyendo igual después de publicar esto.

/** `localStorage.getItem` — `null` si no existe. */
export const leer = (clave) => localStorage.getItem(clave);

/** `localStorage.setItem` — el valor tiene que venir ya como texto. */
export const guardar = (clave, valor) => localStorage.setItem(clave, valor);

/** `localStorage.removeItem`. */
export const borrar = (clave) => localStorage.removeItem(clave);

/** Las claves guardadas, para quien necesita barrer por prefijo. Con
 *  `length`/`key()` y no con `Object.keys(localStorage)`: es la API del
 *  estándar, y la que sigue funcionando cuando el `localStorage` no es el del
 *  navegador (el de las pruebas es un objeto en memoria, y ahí `Object.keys`
 *  devolvía los nombres de los MÉTODOS). */
const clavesDe = (s) => { const out = []; for (let i = 0; i < s.length; i++) out.push(s.key(i)); return out; };
export const claves = () => clavesDe(localStorage);

/** Lo mismo, pero lo que muere al cerrar la pestaña (`sessionStorage`). */
export const deLaSesion = {
    leer:    (clave) => sessionStorage.getItem(clave),
    guardar: (clave, valor) => sessionStorage.setItem(clave, valor),
    borrar:  (clave) => sessionStorage.removeItem(clave),
    claves:  () => clavesDe(sessionStorage),
};

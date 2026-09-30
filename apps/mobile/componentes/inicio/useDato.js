// Cada widget del Inicio lee SU dato, y sólo cuando se dibuja: con veinte y
// tantos widgets repartidos en cuatro pestañas, leer todo al abrir sería pagar
// por lo que no se mira. Lo leído se guarda mientras dure la sesión de la app,
// así que ir y volver entre pestañas no vuelve a pedir nada.
//
// Deslizar hacia abajo sube la `Recarga` (un número en contexto): cambia la
// clave del guardado y todos los widgets a la vista vuelven a leer.
//
// Una lectura que falla no tumba el Inicio: el widget queda con `error` y
// decide qué decir.
import { createContext, useContext, useEffect, useState } from 'react';

export const Recarga = createContext(0);

const guardado = new Map();   // clave@recarga → dato
const enVuelo = new Map();    // clave@recarga → promesa

export function useDato(clave, leer) {
  const recarga = useContext(Recarga);
  const k = clave ? `${clave}@${recarga}` : null;
  const [estado, setEstado] = useState(() => (k && guardado.has(k) ? { dato: guardado.get(k), cargando: false } : { dato: undefined, cargando: !!k }));

  useEffect(() => {
    if (!k) return undefined;
    if (guardado.has(k)) { setEstado({ dato: guardado.get(k), cargando: false }); return undefined; }
    let vivo = true;
    setEstado((e) => ({ ...e, cargando: true }));
    if (!enVuelo.has(k)) {
      enVuelo.set(k, Promise.resolve().then(leer).then((d) => { guardado.set(k, d); return d; }).finally(() => enVuelo.delete(k)));
    }
    enVuelo.get(k)
      .then((d) => { if (vivo) setEstado({ dato: d, cargando: false }); })
      .catch((e) => { console.warn('inicio', clave, e?.message ?? e); if (vivo) setEstado({ dato: undefined, cargando: false, error: e }); });
    return () => { vivo = false; };
  // `leer` cambia de identidad en cada dibujo; la clave es la que manda.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k]);

  return estado;
}

/** Para que un `{ data, error }` de supabase lance en vez de devolver vacío. */
export const datos = (r) => {
  if (r?.error) throw r.error;
  return r?.data ?? r;
};

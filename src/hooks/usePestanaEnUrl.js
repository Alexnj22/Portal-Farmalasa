import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * La pestaña activa vive en la DIRECCIÓN, no en la memoria del componente.
 *
 * Una pestaña en `useState` se pierde con cualquier recarga: apretar F5 —o
 * volver a abrir la pantalla desde el historial, o compartir el enlace— devuelve
 * a la primera pestaña sin decir nada. Quien estaba mirando «Pendiente MH» en
 * Facturación vuelve a «Anuladas» y tiene que rehacer el camino; y como no falla
 * nada, no hay error que lo delate, sólo la sensación de que la pantalla «se
 * movió sola».
 *
 * Nueve vistas ya resolvían esto a mano con el mismo bloque de cinco líneas
 * (`searchParams.get('tab')` + validación + `setSearchParams`). Este hook es ese
 * bloque, para que las otras veinte no lo copien mal: la validación contra las
 * pestañas REALMENTE visibles es la parte que se olvida, y sin ella un
 * `?tab=loquesea` —o una pestaña que el permiso del usuario no incluye— deja la
 * vista pintando el vacío.
 *
 * Empuja al historial (no reemplaza), igual que las nueve que ya existían: así
 * «atrás» deshace el cambio de pestaña, que es lo que espera quien llegó a la
 * tercera y quiere volver a la segunda.
 *
 * @param {Array<string|{key:string}>} pestanas  las visibles AHORA (ya filtradas por permiso)
 * @param {string} [porDefecto]                  cuál vale si la URL no dice nada; por defecto, la primera
 * @param {string} [param='tab']                 nombre del parámetro en la URL
 * @returns {[string|null, (clave:string)=>void]}
 */
export function usePestanaEnUrl(pestanas, porDefecto, param = 'tab') {
    const [searchParams, setSearchParams] = useSearchParams();

    // `key` o `id`: las dos formas conviven en el repo (`ViewTabBar` pide `key`,
    // las pestañas del tablero se escribieron con `id`), y el hook no es motivo
    // para reescribir ninguna de las dos listas.
    const claves = (pestanas || [])
        .map(p => (typeof p === 'string' ? p : (p?.key ?? p?.id)))
        .filter(Boolean);

    // El default explícito sólo manda si sigue visible: un permiso puede haberle
    // quitado al usuario justo esa pestaña, y entonces la primera que le quedó
    // es la única respuesta honesta.
    const defecto = (porDefecto != null && claves.includes(porDefecto))
        ? porDefecto
        : (claves[0] ?? porDefecto ?? null);

    const cruda  = searchParams.get(param);
    const activa = claves.includes(cruda) ? cruda : defecto;

    // `reemplazar` es para las CORRECCIONES, no para los clics: cuando la vista
    // se cae sola a otra pestaña —porque a la de la dirección le falta permiso—
    // empujar al historial deja a «atrás» rebotando contra la misma corrección,
    // y la pantalla queda sin salida por ese botón.
    const setActiva = useCallback((clave, opciones) => {
        setSearchParams(p => { p.set(param, clave); return p; },
                        opciones?.reemplazar ? { replace: true } : undefined);
    }, [setSearchParams, param]);

    return [activa, setActiva];
}

export default usePestanaEnUrl;

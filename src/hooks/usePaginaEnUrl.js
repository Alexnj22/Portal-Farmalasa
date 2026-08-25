import { useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PAGE_SIZE_OPTIONS } from '../components/common/TablePagination';

/**
 * La página de una tabla vive en la DIRECCIÓN, no en la memoria del componente.
 *
 * Es el mismo argumento que `usePestanaEnUrl` —y el mismo modo de falla: no hay
 * error, sólo la sensación de que «la pantalla se movió sola»— pero el caso que
 * lo pidió es peor, porque el trabajo perdido no es un clic sino un recorrido.
 * Reportado el 2026-08-22 contando inventario:
 *
 *   «imagina que estoy haciendo el conteo y estoy en la página 50, y se me
 *    actualiza, me devuelve a la página 1»
 *
 * Y «se me actualiza» no es hipotético en este portal: la sesión de sala se
 * cierra sola a los 5 minutos, el service worker recarga la aplicación cuando se
 * publica una versión, y F5 existe. Con la página en `useState`, cualquiera de
 * las tres deja al que está frente al estante buscando de nuevo dónde iba, entre
 * 1,400 productos y sin ninguna pista de dónde estaba.
 *
 * **Reemplaza, no empuja.** `usePestanaEnUrl` empuja al historial porque una
 * pestaña se cambia tres veces; una página se cambia cincuenta, y con `push`
 * salir de la vista costaría cincuenta toques de «atrás». La página es una
 * POSICIÓN, no un paso de navegación.
 *
 * **El tamaño de página va junto y validado contra la lista blanca.** Van juntos
 * porque «página 50» sin «de a cuántos» no ubica nada: restaurar la 50 con un
 * tamaño distinto del que se eligió deja a la persona en otro tramo del estante.
 * Y validado porque el tamaño viaja como `p_limit` a una RPC: un `?ver=99999`
 * escrito a mano pediría una página que PostgREST recorta a 1000 filas **sin
 * error ni aviso** (CLAUDE.md, regla del cap de 1000). La lista blanca es lo que
 * impide que la dirección elija un número que el servidor no puede cumplir.
 *
 * Recibe el TOTAL DE FILAS y no el total de páginas, y no es un detalle: el
 * total de páginas se calcula con el tamaño, que es justo lo que este hook
 * decide. Pedirlo ya calculado obligaría a quien lo llama a leer el tamaño de la
 * dirección por su cuenta para poder pasárselo — o sea a duplicar la validación
 * que este hook existe para tener en un solo lugar.
 *
 * @param {object}  [opciones]
 * @param {number}  [opciones.total]  cuántas filas hay AHORA; con eso corrige la dirección cuando se quedó fuera de rango
 * @param {number}  [opciones.tamPorDefecto=25]
 * @param {string}  [opciones.param='pag']
 * @param {string}  [opciones.paramTam='ver']
 * @returns {{page:number, pageSize:number, totalPages:number, setPage:(n:number)=>void, setPageSize:(n:number)=>void, resetPage:()=>void}}
 */
export function usePaginaEnUrl({
    total = null,
    tamPorDefecto = PAGE_SIZE_OPTIONS[0],
    param = 'pag',
    paramTam = 'ver',
} = {}) {
    const [searchParams, setSearchParams] = useSearchParams();

    const crudaPag = parseInt(searchParams.get(param), 10);
    const page = Number.isInteger(crudaPag) && crudaPag >= 1 ? crudaPag : 1;

    const crudoTam = parseInt(searchParams.get(paramTam), 10);
    const pageSize = PAGE_SIZE_OPTIONS.includes(crudoTam) ? crudoTam : tamPorDefecto;

    // Un solo `setSearchParams` para los dos: cambiar el tamaño de página SIEMPRE
    // vuelve a la 1 —con 2,800 productos, pasar de 25 a 100 deja a la página 40
    // fuera de rango y la tabla saldría vacía sin decir por qué— y hacerlo en dos
    // llamadas dispararía dos vueltas de consultas para una sola decisión.
    const escribir = useCallback((cambios) => {
        setSearchParams((p) => {
            for (const [clave, valor] of Object.entries(cambios)) {
                if (valor == null) p.delete(clave);
                else p.set(clave, String(valor));
            }
            return p;
        }, { replace: true });
    }, [setSearchParams]);

    // La página 1 no se escribe: es el default, y dejarla en la dirección
    // ensucia el enlace que se comparte sin decir nada que no se sepa.
    const setPage = useCallback((n) => {
        escribir({ [param]: n > 1 ? n : null });
    }, [escribir, param]);

    const setPageSize = useCallback((n) => {
        escribir({ [paramTam]: n === tamPorDefecto ? null : n, [param]: null });
    }, [escribir, paramTam, param, tamPorDefecto]);

    // Lo que llaman el filtro, la búsqueda y el orden: cambia QUÉ lista es, así
    // que la posición vieja ya no señala nada.
    const resetPage = useCallback(() => { escribir({ [param]: null }); }, [escribir, param]);

    const totalPages = total ? Math.ceil(total / pageSize) : 1;

    // Una dirección puede pedir una página que ya no existe —se pegó un enlace
    // viejo, o el filtro dejó tres páginas donde había sesenta—. El servidor
    // devuelve cero filas y la tabla sale vacía sin explicar por qué, que es el
    // mismo silencio que este hook vino a evitar. Se corrige a la última página
    // real y se hace con `replace`: es una CORRECCIÓN, no un paso.
    //
    // La guarda es `total > 0` y no `total != null`: antes de la primera
    // respuesta el total vale 0, y sin la guarda una dirección con `?pag=50` se
    // corregiría a la 1 ANTES de que llegara la lista — o sea que el hook
    // rompería exactamente lo que vino a arreglar. Cuando el total es 0 de
    // verdad (un filtro sin resultados) la página se deja quieta: la tabla ya
    // dice que no hay nada, y moverla escondería el motivo.
    useEffect(() => {
        if (total > 0 && page > totalPages) {
            escribir({ [param]: totalPages > 1 ? totalPages : null });
        }
    }, [total, totalPages, page, escribir, param]);

    return { page, pageSize, totalPages, setPage, setPageSize, resetPage };
}

export default usePaginaEnUrl;

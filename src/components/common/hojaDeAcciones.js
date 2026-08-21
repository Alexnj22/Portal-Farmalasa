import { createContext, useContext } from 'react';

/**
 * ¿Estamos dentro de la HOJA DE ACCIONES de una ficha?
 *
 * La abre `DataTable` al mantener presionada una tarjeta (§32.9). La celda de
 * acciones que se monta ahí adentro está escrita para una COLUMNA DE TABLA:
 * botones de icono de 13px, sin rótulo, alineados a la derecha en 80px de
 * ancho, y a veces revelados por `hover`. En una hoja de 390px eso no es una
 * lista de opciones — es una hilera de íconos sin nombre.
 *
 * Este contexto es la señal para que quien se dibuja pueda preguntar dónde está
 * y cambiar de forma. Lo consultan hoy `Button` (un `iconOnly` recupera su
 * rótulo) y `RowActions` de Mín·Máx (lista las acciones completas, sin
 * desplegable).
 *
 * ── Por qué un módulo propio y no `DataTable` ─────────────────────────────
 * Porque `DataTable` importa `Button`. Si `Button` importara el contexto desde
 * `DataTable`, el ciclo se cierra — y un ciclo de ESM no falla al compilar: deja
 * un `undefined` en tiempo de ejecución, que es de los errores más caros de
 * diagnosticar porque aparece lejos de su causa.
 */
export const HojaAccionesCtx = createContext(false);

export function useEnHojaDeAcciones() {
    return useContext(HojaAccionesCtx);
}

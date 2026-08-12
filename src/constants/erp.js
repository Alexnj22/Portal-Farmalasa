
export const SUCURSALES = [5, 1, 2, 3, 4, 7];

export const ERP_NAMES = {
    1: 'Salud 1', 2: 'Salud 2', 3: 'Salud 3',
    4: 'Salud 4', 5: 'La Popular', 6: 'Bodega', 7: 'Salud 5',
};

/**
 * El orden en que el negocio nombra las salas — La Popular primero, Bodega al
 * final. No es el del maestro ni el numérico: es el de despacho, y es el que
 * usan todos los selectores de sucursal del portal.
 */
export const ERP_ORDEN = [5, 1, 2, 3, 4, 7, 6];

/** branch_id del portal → sucursal del sistema de origen. */
export const BRANCH_A_ERP = { 2: 5, 4: 1, 25: 2, 27: 3, 28: 4, 29: 7, 30: 6 };

/**
 * La ubicación con la que se mueve el inventario de cada sucursal. Leída del
 * propio sistema el 2026-08-06 y no adivinada: son numeraciones distintas de
 * las de sucursal, y la equivocada apunta a otro almacén sin dar error.
 * Bodega tiene dos (1 BODEGA, 2 BODEGA DE VENCIDOS); acá va la de operación,
 * porque la de vencidos es a donde llega lo descartado, no de donde sale.
 */
export const ERP_UBICACION_POR_SUCURSAL = { 1: 3, 2: 4, 3: 5, 4: 6, 5: 7, 6: 1, 7: 8 };

/**
 * El código corto con que cada sala se nombra donde no cabe el nombre: el
 * código del pedido impreso en la hoja de despacho (`03-120826-2-S5`) y la
 * clave del traslado en el kardex (`P102-S5-H1-I71445`).
 *
 * **La autoridad es `erp_sucursal_map.codigo` en la base** —con CHECK de forma
 * y UNIQUE—, que es de donde lo lee `planificar_traslado_pedido` al armar la
 * clave. Esto es el espejo para el frontend, igual que `ERP_NAMES` y
 * `BRANCH_A_ERP`. Si se agrega una sala hay que tocar los dos.
 *
 * Ojo con lo que NO es: el número de la sala. `erp_sucursal_id` y el nombre se
 * separan justo en las tres últimas, así que armarlo con el id da «S7» para
 * Salud 5 y —peor— «S5» para La Popular, que se lee como otra sala que sí
 * existe. Ver la memoria `la numeración de sala del ERP no es su nombre`.
 */
export const ERP_CODIGOS = { 1: 'S1', 2: 'S2', 3: 'S3', 4: 'S4', 5: 'PO', 6: 'BO', 7: 'S5' };

// Las cuatro constantes de arriba vivían dentro de `DashboardView` —
// `MM_ERP_NAMES`, `MM_ERP_ORDER`, `MM_BRANCH_TO_ERP`,
// `ERP_UBICACION_POR_SUCURSAL`— porque hasta el 2026-08-11 sus únicos
// consumidores eran las baldosas del tablero. Ese día «Solicitudes de
// Sucursal» estrenó el botón «Nueva solicitud», que abre los MISMOS
// formularios y necesita los MISMOS mapas: copiarlos allá habría dejado dos
// listas a mano que se desincronizan a la primera sucursal nueva. Y
// `MM_ERP_NAMES` ya era, carácter por carácter, una segunda copia de
// `ERP_NAMES` — se fue con la mudanza.
//
// Aquella mudanza dejó una copia atrás: `pedidoPrint.js` tenía sus propios
// `ERP_NAMES_DEFAULT`, `SUCURSALES_ORDER` y `SUCURSAL_CODES`. Se descubrió el
// 2026-08-12 justo al definir la clave del traslado — se estaba por inventar un
// cuarto código de sala sin saber que el módulo que imprime la hoja de despacho
// ya tenía el suyo, idéntico. Se mudaron acá el mismo día.

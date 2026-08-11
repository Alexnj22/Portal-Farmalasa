
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

// Las cuatro constantes de arriba vivían dentro de `DashboardView` —
// `MM_ERP_NAMES`, `MM_ERP_ORDER`, `MM_BRANCH_TO_ERP`,
// `ERP_UBICACION_POR_SUCURSAL`— porque hasta el 2026-08-11 sus únicos
// consumidores eran las baldosas del tablero. Ese día «Solicitudes de
// Sucursal» estrenó el botón «Nueva solicitud», que abre los MISMOS
// formularios y necesita los MISMOS mapas: copiarlos allá habría dejado dos
// listas a mano que se desincronizan a la primera sucursal nueva. Y
// `MM_ERP_NAMES` ya era, carácter por carácter, una segunda copia de
// `ERP_NAMES` — se fue con la mudanza.

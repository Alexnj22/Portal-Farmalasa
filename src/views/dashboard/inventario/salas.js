// Las tres tablas de salas que necesitan tanto la baldosa como el panel.
//
// Viven acá desde el 2026-08-23, cuando el cuerpo del buscador se separó del
// azulejo para sacarlo del cierre estático del Inicio. Antes eran constantes de
// módulo dentro de `WidgetInventorySearch.jsx`, así que al partir el archivo
// había que elegir entre duplicarlas —dos verdades sobre el orden de las salas,
// que es exactamente la clase de cosa que se desincroniza sola— o dejarlas de un
// lado y que el otro las importara, cerrando un ciclo entre los dos archivos.
// Un tercer archivo sin dependencias resuelve las dos.


export const ERP_BRANCH_MAP = {
  1: 'Salud 1',
  2: 'Salud 2',
  3: 'Salud 3',
  4: 'Salud 4',
  5: 'La Popular',
  6: 'Bodega',
  7: 'Salud 5',
};
// Bodega SIEMPRE primero (pedido del usuario, 2026-08-07). Venía última, con el
// orden de despacho que usa el resto del tablero — y acá ese orden no aplica:
// esta pantalla no reparte, contesta «dónde hay». Lo primero que se mira antes
// de pedirle a otra sala es si Bodega lo tiene, porque de ahí sale sin dejar a
// ninguna sala corta. Estando al final había que recorrer las seis para llegar.
//
// Es el único orden de salas del widget, así que alcanza con cambiarlo acá: el
// detalle y las alternativas se arman recorriendo lo que devuelve
// `groupInventory`, que sale ordenado por esta lista.
export const BRANCH_ORDER = [6, 5, 1, 2, 3, 4, 7];
// branch del portal → sucursal del sistema de origen. Son numeraciones
// distintas; el mismo mapa que usa el tablero.
export const MI_ERP_POR_BRANCH = { 2: 5, 4: 1, 25: 2, 27: 3, 28: 4, 29: 7, 30: 6 };

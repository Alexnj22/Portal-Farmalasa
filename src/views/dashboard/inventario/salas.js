// Las tres tablas de salas que necesitan tanto la baldosa como el panel.
//
// Viven acá desde el 2026-08-23, cuando el cuerpo del buscador se separó del
// azulejo para sacarlo del cierre estático del Inicio. Antes eran constantes de
// módulo dentro de `WidgetInventorySearch.jsx`, así que al partir el archivo
// había que elegir entre duplicarlas —dos verdades sobre el orden de las salas,
// que es exactamente la clase de cosa que se desincroniza sola— o dejarlas de un
// lado y que el otro las importara, cerrando un ciclo entre los dos archivos.
// Un tercer archivo sin dependencias resuelve las dos.


// Los nombres y el mapa sala↔sucursal son los de `constants/erp.js`: acá
// había una copia idéntica de cada uno.
export { ERP_NAMES as ERP_BRANCH_MAP, BRANCH_A_ERP as MI_ERP_POR_BRANCH } from '../../../constants/erp';

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

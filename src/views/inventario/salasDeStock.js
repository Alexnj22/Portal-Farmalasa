// Las salas como las nombra Gestión de stock. Vivían copiadas en cada pestaña.

// Nombres, orden, Bodega y el mapa sala↔sucursal: los de `constants/erp.js`
// (acá vivía una copia idéntica de cada uno).
export {
    ERP_NAMES, ERP_ORDEN as ERP_ORDER, ERP_BODEGA, BRANCH_A_ERP as MI_ERP_POR_BRANCH,
} from '../../constants/erp';

// El NOMBRE de la variante de `Badge`; el canónico pone el color.
export const SUC_VARIANTE = {
    1: 'chart-1', 2: 'chart-3', 3: 'success',
    4: 'warning', 5: 'danger',  7: 'chart-9', 6: 'neutral',
};

import { ArrowLeftRight, PackageMinus, Receipt, TrendingUp } from 'lucide-react';
import {
    FAMILIAS_OPERATIVAS, familiasDisponibles as disponiblesDe,
} from '../../constants/familiasOperativas';

// El catálogo (claves, textos, permisos) vive en `constants/familiasOperativas`
// —lo usa la lógica—; acá sólo el ícono y el color de cada baldosa.
//
// `chart-3` en «Pedir a otra sala» y no el `warning` de la baldosa del
// tablero: acá conviven las cuatro en una lista y la facturación ya es la
// amarilla. Dos baldosas del mismo color en el mismo menú dejan de distinguirse.
const ICONOS = { ArrowLeftRight, PackageMinus, Receipt, TrendingUp };
const ESTILO = {
    inventario: { color: 'text-danger-text', bg: 'bg-danger/5 border-danger/20 hover:border-danger/40', iconBg: 'bg-danger/10' },
    facturacion: { color: 'text-warning-text', bg: 'bg-warning/5 border-warning/20 hover:border-warning/40', iconBg: 'bg-warning/10' },
    minmax: { color: 'text-brand-text', bg: 'bg-brand/5 border-brand/20 hover:border-brand/40', iconBg: 'bg-brand/10' },
    traslado: { color: 'text-chart-3-text', bg: 'bg-chart-3/5 border-chart-3/20 hover:border-chart-3/40', iconBg: 'bg-chart-3/10' },
};

export const FAMILIAS = FAMILIAS_OPERATIVAS.map((f) => ({ ...f, icon: ICONOS[f.icono], ...ESTILO[f.key] }));

/** Cuáles puede abrir esta persona — la regla vive en el núcleo. */
export const familiasDisponibles = (hasPermission) => disponiblesDe(hasPermission, FAMILIAS);

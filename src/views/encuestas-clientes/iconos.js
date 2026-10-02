import {
    Gauge, Smile, SlidersHorizontal, CircleDot, ListChecks, ToggleRight, ArrowDownUp, Hash, MessageSquareText,
    QrCode, Mic, Tablet,
} from 'lucide-react';

// La lógica nombra el ícono (`@nucleo/utils/encuestasClientes`); la pantalla lo
// resuelve. Así el núcleo no importa íconos (gate:nucleo).
export const ICONOS = {
    Gauge, Smile, SlidersHorizontal, CircleDot, ListChecks, ToggleRight, ArrowDownUp, Hash, MessageSquareText,
    QrCode, Mic, Tablet,
};

// El color de una dimensión se guarda como nombre de token (`chart-3`). Las
// clases van enteras porque Tailwind sólo genera las que lee en el fuente.
const TINTA = {
    'chart-1': 'bg-chart-1/15 text-chart-1-text', 'chart-3': 'bg-chart-3/15 text-chart-3-text',
    'chart-4': 'bg-chart-4/15 text-chart-4-text', 'chart-6': 'bg-chart-6/15 text-chart-6-text',
    'chart-8': 'bg-chart-8/15 text-chart-8-text', 'chart-9': 'bg-chart-9/15 text-chart-9-text',
};
export const COLORES_DIMENSION = Object.keys(TINTA);
export const tintaDeDimension = (color) => TINTA[color] || TINTA['chart-1'];

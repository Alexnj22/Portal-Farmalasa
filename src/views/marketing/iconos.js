import { Image, GalleryHorizontal, Clapperboard, Video, CircleDashed, FileQuestion } from 'lucide-react';

// La lógica nombra el ícono (`@nucleo/utils/marketing`); la pantalla lo
// resuelve. Así el núcleo no importa íconos (gate:nucleo).
const ICONOS = { Image, GalleryHorizontal, Clapperboard, Video, CircleDashed };

export const ICONOS_FORMATO = ICONOS;
export const ICONO_DESCONOCIDO = FileQuestion;

// El color de una marca se guarda como nombre de token (`chart-2`). Las clases
// van escritas enteras porque Tailwind sólo genera las que lee en el fuente.
// Sólo los acentos vigentes: chart-2, 5 y 7 están retirados (DESIGN.md §6).
const PUNTO = {
    'chart-1': 'bg-chart-1', 'chart-3': 'bg-chart-3', 'chart-4': 'bg-chart-4',
    'chart-6': 'bg-chart-6', 'chart-8': 'bg-chart-8', 'chart-9': 'bg-chart-9',
};
export const COLORES_MARCA = Object.keys(PUNTO);
export const puntoDeMarca = (color) => PUNTO[color] || PUNTO['chart-1'];

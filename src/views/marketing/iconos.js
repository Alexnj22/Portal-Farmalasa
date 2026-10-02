import {
    Image, GalleryHorizontal, Clapperboard, Video, CircleDashed, FileQuestion,
    Circle, PencilRuler, Eye, AlertTriangle, CheckCircle2, CalendarClock, Globe,
} from 'lucide-react';

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

// El mismo color como fondo tenue con su texto legible: la inicial de la marca.
const TINTA = {
    'chart-1': 'bg-chart-1/15 text-chart-1-text', 'chart-3': 'bg-chart-3/15 text-chart-3-text',
    'chart-4': 'bg-chart-4/15 text-chart-4-text', 'chart-6': 'bg-chart-6/15 text-chart-6-text',
    'chart-8': 'bg-chart-8/15 text-chart-8-text', 'chart-9': 'bg-chart-9/15 text-chart-9-text',
};
export const tintaDeMarca = (color) => TINTA[color] || TINTA['chart-1'];

// El estado de una pieza, pintado: ícono, la barra de color, el fondo tenue y
// el texto legible. Es el mismo color que su Badge (`ESTADOS_PIEZA.variant`),
// así el calendario, el flujo y el modal hablan el mismo idioma.
const TONO = {
    pendiente:  { icono: Circle,        barra: 'bg-content-3', suave: 'bg-surface-card-hover', texto: 'text-content-2',    borde: 'border-border-card', solido: 'bg-chart-8-solid' },
    en_proceso: { icono: PencilRuler,   barra: 'bg-brand',     suave: 'bg-brand/10',           texto: 'text-brand-text',   borde: 'border-brand/30', solido: 'bg-brand' },
    finalizado: { icono: Eye,           barra: 'bg-chart-3',   suave: 'bg-chart-3/10',         texto: 'text-chart-3-text', borde: 'border-chart-3/30', solido: 'bg-chart-3-solid' },
    cambios:    { icono: AlertTriangle, barra: 'bg-warning',   suave: 'bg-warning/10',         texto: 'text-warning-text', borde: 'border-warning/40', solido: 'bg-warning-solid' },
    aprobado:   { icono: CheckCircle2,  barra: 'bg-success',   suave: 'bg-success/10',         texto: 'text-success-text', borde: 'border-success/30', solido: 'bg-success-solid' },
    programado: { icono: CalendarClock, barra: 'bg-chart-4',   suave: 'bg-chart-4/10',         texto: 'text-chart-4-text', borde: 'border-chart-4/30', solido: 'bg-chart-4-solid' },
    publicado:  { icono: Globe,         barra: 'bg-chart-9',   suave: 'bg-chart-9/10',         texto: 'text-chart-9-text', borde: 'border-chart-9/30', solido: 'bg-chart-9-solid' },
};
export const tonoDeEstado = (estado) => TONO[estado] || TONO.pendiente;

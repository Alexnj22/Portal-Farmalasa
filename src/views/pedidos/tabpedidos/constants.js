// Extracted from TabPedidos.jsx (Bloque 6.C) — shared by StagePill/SucPill/PauseModal.
import { Package, Activity, Pause, CheckCircle2, Truck, PackageCheck, Database, Coffee, Clock, ClipboardList, Bell, MessageSquare } from 'lucide-react';

// Usado por PauseModal (extraído) y por el cuerpo principal de TabPedidos.jsx
// (busca el motivo de pausa para mostrarlo en el timeline) — se queda acá
// para no duplicarlo entre ambos.
export const PAUSE_REASONS = [
    { key: 'almuerzo',     label: 'Almuerzo',             icon: Coffee,        maxUses: 1    },
    { key: 'insumos',      label: 'Espera de insumos',    icon: Clock,         maxUses: null },
    { key: 'reunion',      label: 'Reunión de turno',     icon: ClipboardList, maxUses: null },
    { key: 'interrupcion', label: 'Interrupción externa', icon: Bell,          maxUses: null },
    { key: 'otro',         label: 'Otro…',                icon: MessageSquare, maxUses: null, requiresComment: true },
];

// Tokenizado T7 — mismo criterio de color por etapa que TabEnCurso.jsx
// (STAGE_CONFIG/COLOR_CLASSES ahí), mismo concepto de dispatch-stage.
export const STAGE_CONFIG = {
    sin_iniciar: { label: 'Sin iniciar',     color: 'neutral', icon: Package      },
    preparando:  { label: 'En preparación',  color: 'chart-1', icon: Activity     },
    pausado:     { label: 'Pausado',         color: 'warning', icon: Pause        },
    preparado:   { label: 'Listo p/ envío',  color: 'chart-3', icon: CheckCircle2 },
    transito:    { label: 'En tránsito',     color: 'chart-5', icon: Truck        },
    contando:    { label: 'Cajas recibidas', color: 'chart-7', icon: PackageCheck },
    erp:         { label: 'Sis. Ventas',      color: 'success', icon: Database     },
};

export const COLOR_CLS = {
    neutral:  { bg: 'bg-surface-card-hover', text: 'text-content-3',    border: 'border-border-card'  },
    warning:  { bg: 'bg-warning/10',         text: 'text-warning-text', border: 'border-warning/30'   },
    success:  { bg: 'bg-success/10',         text: 'text-success-text', border: 'border-success/30'   },
    'chart-1': { bg: 'bg-chart-1/10', text: 'text-chart-1-text', border: 'border-chart-1/30' },
    'chart-3': { bg: 'bg-chart-3/10', text: 'text-chart-3-text', border: 'border-chart-3/30' },
    'chart-5': { bg: 'bg-chart-5/10', text: 'text-chart-5-text', border: 'border-chart-5/30' },
    'chart-7': { bg: 'bg-chart-7/10', text: 'text-chart-7-text', border: 'border-chart-7/30' },
};

// Tokenizado T7 — mismo criterio de color por sucursal que TabPedidos.jsx
// (SUC_COLORS local, paleta cat-N por posición; 6=Bodega queda neutro).
export const SUC_COLORS = {
    1: 'bg-chart-1/10 text-chart-1-text border-chart-1/30',
    2: 'bg-chart-3/10 text-chart-3-text border-chart-3/30',
    3: 'bg-success/10 text-success-text border-success/30',
    4: 'bg-warning/10 text-warning-text border-warning/30',
    5: 'bg-chart-6/10 text-chart-6-text border-chart-6/30',
    6: 'bg-surface-card-hover text-content-2 border-border-card',
    7: 'bg-chart-9/10 text-chart-9-text border-chart-9/30',
};

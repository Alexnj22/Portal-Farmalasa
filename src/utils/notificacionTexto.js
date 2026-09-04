import { AlertCircle, AlertTriangle, CheckCircle2 } from 'lucide-react';

/* Cómo se LEE una notificación: severidad, tono, verbo y antigüedad.
 *
 * Vivía entero dentro de `NotificationBell.jsx`, que era su único lector. Desde
 * el 2026-09-04 hay un segundo —la vista `/notificaciones`, con el historial
 * paginado y la papelera— y estas reglas no se copian: la copia es la que se
 * queda vieja, y acá lo que se desincronizaría es qué tan grave se ve un aviso.
 * Es el mismo movimiento que ya se hizo con `movimientoTexto.js` para la tarjeta
 * y el detalle de una solicitud.
 *
 * Sólo funciones y constantes puras, sin un solo componente: un archivo que
 * exporta las dos cosas rompe el fast refresh de Vite.
 */

// ── La severidad la dice el ÍCONO, no un emoji dentro del título ────────────
// Los avisos que escribe la base traen su severidad como emoji al principio
// («⚠️ El barrido de Hacienda terminó con fallas»), y el panel la ignoraba: el
// ícono salía del TIPO, así que una alerta de fallas se dibujaba con la campana
// genérica y el aviso quedaba diciendo dos veces lo mismo — una en emoji y
// otra, mal, en ícono. Reportado como «mejorá cómo se ven».
//
// Se lee el emoji, se usa para elegir ícono y tono, y se quita del texto. El
// título arranca en su primera palabra y la severidad se ve donde se mira
// primero. No hace falta un mapa por tipo: quien escribe el aviso ya la declaró.
export const SEVERIDAD = [
    { re: /^(🚨|❌|⛔)/u,  Icono: AlertCircle,   claro: 'bg-danger/10 text-danger border-danger/30',   oscuro: 'bg-danger/10 text-danger-text border-danger/40' },
    { re: /^(⚠️|⚠)/u,     Icono: AlertTriangle, claro: 'bg-warning/10 text-warning border-warning/30', oscuro: 'bg-warning/10 text-warning-text border-warning/40' },
    { re: /^(✅|✔️)/u,     Icono: CheckCircle2,  claro: 'bg-success/10 text-success border-success/25', oscuro: 'bg-success/10 text-success-text border-success/20' },
];

export const severidadDelTitulo = (titulo = '') =>
    SEVERIDAD.find(s => s.re.test(titulo.trim())) || null;

export const tituloSinEmoji = (titulo = '') =>
    titulo.replace(/^\s*(?:🚨|❌|⛔|⚠️|⚠|✅|✔️)\s*/u, '');

export const tintForType = (type = '', metadata = {}, isDark = false) => {
    if (isDark) {
        if (type === 'REQUEST_PENDING' || type === 'MINMAX_PENDING') return 'bg-warning/10 text-warning-text border-warning/40';
        if (type === 'REQUEST_DECIDED' || type === 'MINMAX_DECIDED') {
            return metadata?.status === 'REJECTED'
                ? 'bg-danger/10 text-danger-text border-danger/40'
                : 'bg-success/10 text-success-text border-success/20';
        }
        if (type.startsWith('PEDIDO')) return 'bg-chart-1/10 text-chart-1-text border-chart-1/40';
        return 'bg-surface-card text-white/60 border-border-card';
    }
    if (type === 'REQUEST_PENDING' || type === 'MINMAX_PENDING') return 'bg-warning/10 text-warning border-warning/30';
    if (type === 'REQUEST_DECIDED' || type === 'MINMAX_DECIDED') {
        return metadata?.status === 'REJECTED'
            ? 'bg-danger/10 text-danger border-danger/30'
            : 'bg-success/10 text-success border-success/30';
    }
    if (type.startsWith('PEDIDO')) return 'bg-chart-1/10 text-brand-text border-chart-1/30';
    return 'bg-surface-card-hover text-content-3 border-border-card/70';
};

// Tipos que esperan una acción del usuario → chip con verbo específico;
// el resto de filas con link muestran "Ver" (indicador de que son clickeables)
export const ACTION_LABEL = {
    REQUEST_PENDING: 'Revisar solicitud',
    MINMAX_PENDING:  'Revisar solicitud',
    PEDIDO_LLEGADA:  'Confirmar recepción',
    PEDIDO_REENVIO:  'Confirmar llegada',
    PEDIDO_PROBLEMA: 'Ver detalle',
    CORTE_NUEVO:     'Revisar el corte',
    DEPOSITO_BANCO:  'Ver el depósito',
};

/* El recordatorio de las 7:30 nombra UNO o VARIOS cortes según lo que haya
 * quedado colgado, así que su etiqueta no puede ser fija: es el verbo que
 * promete lo que pasa al tocar la fila, y prometer «los cortes» sobre uno solo
 * es la misma clase de mentira chica que un botón que no hace lo que dice. */
export const etiquetaDeAccion = (n) =>
    n.type === 'CORTE_PENDIENTE'
        ? (n.metadata?.cuantas === 1 ? 'Resolver el corte' : 'Resolver los cortes')
        : ACTION_LABEL[n.type];

/* En qué terminó una solicitud que ya se decidió: una decidida no se «revisa»,
   y el verbo tiene que decir cómo quedó en vez de invitar a algo que ya pasó. */
export const RESUELTA_LABEL = {
    APPROVED: 'Aprobada', REJECTED: 'Rechazada', CANCELLED: 'Cancelada',
    ADVANCED: 'Aprobada',
};

export const PIDE_DECISION = new Set(['REQUEST_PENDING', 'MINMAX_PENDING']);

/* CUÁNDO llegó — la hora si es de hoy, la fecha y la hora si es de antes.
 *
 * Antes decía la antigüedad en palabras («Hace 2 h», «Hace 19 h», «Hace 3
 * días»). Pedido del usuario el 2026-09-04: «que ponga la fecha de la
 * notificación y hora. si es de ayer para atrás. si no solo la hora».
 *
 * Y la razón se ve sola en un historial: «Hace 19 h» no dice CUÁNDO pasó. Hay
 * que restar mentalmente, y la resta cambia según la hora a la que uno mire —
 * el mismo aviso dice «Hace 19 h» a la mañana y «Hace 1 día» a la tarde, sin
 * que haya pasado nada. Una hora concreta no se mueve.
 *
 * «Hoy» es el mismo DÍA DEL CALENDARIO, no «hace menos de 24 horas»: un aviso
 * de las 23:50 de anoche tiene 8 horas y es de ayer, y decir sólo «7:50» lo
 * pondría en el día que no es. Se comparan las fechas locales, que es como las
 * lee quien mira la pantalla.
 */
const MISMO_DIA = (a, b) =>
    a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();

export const cuandoLlego = (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const hora = d.toLocaleTimeString('es-SV', { hour: 'numeric', minute: '2-digit' });
    if (MISMO_DIA(d, new Date())) return hora;
    return `${d.toLocaleDateString('es-SV', { day: 'numeric', month: 'short' })}, ${hora}`;
};

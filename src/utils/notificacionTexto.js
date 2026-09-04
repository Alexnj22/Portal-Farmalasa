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

/* Antigüedad en palabras. Pasada una semana cambia a la fecha: «hace 34 días»
   no ubica a nadie, y en un historial que llega a 90 días eso es la mayoría. */
export const timeAgo = (iso) => {
    const diff = Date.now() - new Date(iso).getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1)  return 'Ahora';
    if (min < 60) return `Hace ${min} min`;
    const hrs = Math.floor(min / 60);
    if (hrs < 24) return `Hace ${hrs} h`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `Hace ${days} día${days > 1 ? 's' : ''}`;
    return new Date(iso).toLocaleDateString('es-SV', { day: '2-digit', month: 'short' });
};

/* ── Cómo se NOMBRA un tipo de aviso en pantalla ─────────────────────────────
 *
 * Para el filtro de `/notificaciones`. Los tipos son cadenas que escriben los
 * disparadores y las edge functions — no son una tabla, así que acá no aplica
 * «una lista que existe como tabla no se escribe a mano»: no hay tabla de la
 * cual sacarla. Lo que sí aplica es la otra mitad de esa regla: **la lista de
 * opciones sale de lo que la persona TIENE** (`mis_tipos_de_notificacion`), y
 * esto sólo traduce. Si aparece un tipo sin rótulo, `nombreDeTipo` lo muestra
 * prolijo en vez de dejarlo afuera — un tipo que desaparece del filtro esconde
 * avisos sin decirlo, y ése es el error caro.
 *
 * Y se habla del PORTAL, no de la tubería: nada de «sync», «ERP» ni el nombre
 * de la tabla de origen.
 */
export const NOMBRE_DE_TIPO = {
    REQUEST_PENDING:   'Solicitud por revisar',
    REQUEST_RESOLVED:  'Solicitud resuelta',
    REQUEST_DECIDED:   'Solicitud decidida',
    MINMAX_PENDING:    'Mín·Máx por revisar',
    MINMAX_DECIDED:    'Mín·Máx decidido',
    PEDIDO_TRACKING:   'Pedido en camino',
    PEDIDO_LLEGADA:    'Pedido que llegó',
    PEDIDO_REENVIO:    'Pedido reenviado',
    PEDIDO_DIFERENCIA: 'Pedido con diferencia',
    PEDIDO_PROBLEMA:   'Pedido con problema',
    TRASLADO_RESPALDO: 'Traslado de respaldo',
    CORTE_NUEVO:       'Corte de caja',
    CORTE_PENDIENTE:   'Corte sin resolver',
    CIERRE_DEL_DIA:    'Cierre del día',
    DEPOSITO_BANCO:    'Depósito al banco',
    FACTURA_SALA:      'Factura de la sala',
    CREDITO_VENCIDO:   'Crédito pasado del plazo',
    bolsa_no_cuadra:   'Bolsa que no cuadra',
    BITACORA_POR_VENCER:   'Bitácora por vencer',
    METAS_CIERRE_SALA:     'Cierre de metas · sala',
    METAS_CIERRE_EMPRESA:  'Cierre de metas · empresa',
    METAS_POR_APROBAR:     'Metas por aprobar',
    SYSTEM:            'Aviso del sistema',
};

/* Un tipo sin rótulo NO se descarta: se muestra prolijo. Que una categoría
   desaparezca del filtro escondería sus avisos sin ningún error visible, y el
   día que alguien agregue un tipo nuevo nadie va a acordarse de este mapa. */
export const nombreDeTipo = (tipo = '') =>
    NOMBRE_DE_TIPO[tipo]
    || String(tipo).replace(/_/g, ' ').toLowerCase().replace(/^./, c => c.toUpperCase());

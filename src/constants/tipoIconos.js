import {
    Palmtree, FileText, RefreshCw, Coffee, DollarSign, FileCheck, Stethoscope,
    Ban, CreditCard, UserCog, Contact,
    Package, BarChart2, ClipboardList, Info, Bell,
    PackagePlus, Trash2, ArrowLeftRight,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Un tipo = un ícono, en toda la app.
//
// Vivía solo dentro de `RequestsView` (const TYPE_ICONS) y la campana no lo
// conocía: `NotificationBell` resolvía por prefijo —`PEDIDO*`, `MINMAX*`,
// `REQUEST*`— y todo lo demás caía al ícono genérico de campana. Resultado: seis
// tipos que SÍ se envían (`ANNULMENT_REQUEST`, `CLIENT_CHANGE_REQUEST`,
// `PAYMENT_CHANGE_REQUEST`, `VENDOR_CHANGE_REQUEST`, `SHIFT_CHANGE`, `SYSTEM`)
// se veían todos iguales en la campana, mientras que cinco de ellos ya tenían
// ícono propio a dos vistas de distancia.
//
// Se extrae acá para que sea UN catálogo con dos consumidores, en vez de dos
// listas que se desincronizan. Es el mismo error que ya mordió dos veces el
// 2026-08-01 (el traductor de errores por diccionario y el gate `error-crudo`
// con su lista de setters a mano): una lista escrita a mano se desactualiza el
// día que alguien agrega una clave y no sabe que hay otra copia.
// ─────────────────────────────────────────────────────────────────────────────

export const ICONO_POR_TIPO = {
    // ── Tipos de solicitud (los muestra RequestsView, y el canal los usa
    //    tal cual como `type` de notificación) ──
    VACATION:               Palmtree,
    PERMIT:                 FileText,
    SHIFT_CHANGE:           RefreshCw,
    OVERTIME:               Coffee,
    ADVANCE:                DollarSign,
    CERTIFICATE:            FileCheck,
    DISABILITY:             Stethoscope,
    ANNULMENT_REQUEST:      Ban,        // pide deshacer algo ya enviado
    PAYMENT_CHANGE_REQUEST: CreditCard,
    VENDOR_CHANGE_REQUEST:  UserCog,
    CLIENT_CHANGE_REQUEST:  Contact,

    // Los tres que mueven producto. Faltaban los tres, así que en la Bandeja y
    // en la campana caían al ícono genérico — justo los tipos donde el ícono
    // más ayuda, porque un descarte y una carga se leen distinto de un golpe.
    INVENTORY_LOAD_REQUEST:     PackagePlus,
    INVENTORY_DISCARD_REQUEST:  Trash2,
    INVENTORY_TRANSFER_REQUEST: ArrowLeftRight,

    // ── Tipos propios del canal de notificaciones ──
    PEDIDO_TRACKING:  Package,
    PEDIDO_LLEGADA:   Package,
    PEDIDO_REENVIO:   Package,
    PEDIDO_PROBLEMA:  Package,
    MINMAX_PENDING:   BarChart2,
    MINMAX_DECIDED:   BarChart2,
    REQUEST_PENDING:  ClipboardList,
    REQUEST_DECIDED:  ClipboardList,
    SYSTEM:           Info,       // mensaje del portal, no de una persona
};

// Fallback por familia: cubre un `PEDIDO_*` nuevo que nadie agregó al mapa.
// El orden importa solo para prefijos que no se solapan (no hay ninguno hoy).
const POR_PREFIJO = [
    ['PEDIDO',  Package],
    ['MINMAX',  BarChart2],
    ['REQUEST', ClipboardList],
];

/** Ícono de un tipo. Nunca devuelve undefined. */
export function iconoDeTipo(type = '') {
    const exacto = ICONO_POR_TIPO[type];
    if (exacto) return exacto;
    for (const [prefijo, icono] of POR_PREFIJO) {
        if (type.startsWith(prefijo)) return icono;
    }
    return Bell;
}

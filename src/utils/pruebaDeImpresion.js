// La prueba de impresión y las cajas de las salas, escritas UNA vez para el
// portal (`ImpresionView`, `CajasDeImpresion`) y para la app: el ticket de
// prueba, cómo se lee el latido de una caja, qué se dice de su agente y los
// estados de la cola. Vivían dentro de los dos componentes del portal.
import { EMPRESA } from '../constants/empresa';
import { codigosDePrueba, fechaHora, reglaDeColumnas } from './ticketPrint';

/**
 * El ticket de prueba. Cada bloque responde UNA pregunta que no se contesta
 * desde la pantalla: la regla (cuántas letras entran), el nombre largo (si se
 * parte bien), los totales (si la columna derecha queda alineada) y la barra
 * (si el cabezal imprime parejo). No nombra ningún otro sistema.
 */
export function ticketDePruebaDeImpresion({ ancho, sucursal, quien, desde, version, ahora = new Date() }) {
    return {
        ancho,
        encabezado: {
            titulo: EMPRESA.razonSocial.toUpperCase(),
            lineas: [
                sucursal?.name ?? 'Sucursal sin definir',
                sucursal?.address ?? '',
                sucursal?.phone ? `Tel. ${sucursal.phone}` : '',
                `NIT ${EMPRESA.nit}  ·  NRC ${EMPRESA.nrc}`,
            ].filter(Boolean),
        },
        titulo: 'Prueba de impresión',
        datos: [
            ['Fecha', fechaHora(ahora)],
            ['Hecha por', quien ?? '—'],
            ['Rollo elegido', `${ancho} mm`],
            ['Desde', desde],
            ['Portal', `v${version}`],
        ],
        bloques: [
            {
                titulo: 'Cuántas letras entran',
                texto: 'El renglón más largo que NO se parta en dos es el ancho de esta impresora.',
                monoespaciado: `32:\n${reglaDeColumnas(32)}\n40:\n${reglaDeColumnas(40)}`
                    + `\n48:\n${reglaDeColumnas(48)}`,
            },
        ],
        items: {
            columnas: [
                { label: 'Producto', ancho: '46%', alinear: 'izq' },
                { label: 'Cant', ancho: '12%', alinear: 'cen' },
                { label: 'P. Unit', ancho: '20%', alinear: 'der' },
                { label: 'Total', ancho: '22%', alinear: 'der' },
            ],
            filas: [
                ['ACETAMINOFEN 500MG TABLETAS CAJA CON 100 UNIDADES', '2', '$0.35', '$0.70'],
                ['IBUPROFENO 400MG', '1', '$1.25', '$1.25'],
                ['ALCOHOL GEL 250ML', '10', '$2.50', '$25.00'],
            ],
        },
        totales: [
            ['Gravado', '$23.85'],
            ['IVA 13%', '$3.10'],
            ['TOTAL', '$26.95', true],
        ],
        // Las dos simbologías juntas: la pregunta es cuál de las dos lee el
        // lector de la sala, y se contesta pasando el lector por las dos.
        codigos: codigosDePrueba(),
        barraPrueba: true,
        pie: [
            'Esta hoja es una prueba: no es un comprobante',
            'y no corresponde a ninguna venta.',
            `Portal Farmalasa · v${version}`,
        ],
    };
}

const MINUTO = 60_000;

/** Cuándo preguntó la caja por última vez; `vivo` = en los últimos 2 minutos. */
export function latidoDeCaja(iso, ahora = Date.now()) {
    if (!iso) return { txt: 'nunca preguntó', vivo: false };
    const ms = ahora - Date.parse(iso);
    if (ms < 2 * MINUTO) return { txt: 'ahora mismo', vivo: true };
    if (ms < 60 * MINUTO) return { txt: `hace ${Math.round(ms / MINUTO)} min`, vivo: false };
    if (ms < 48 * 60 * MINUTO) return { txt: `hace ${Math.round(ms / (60 * MINUTO))} h`, vivo: false };
    return { txt: `hace ${Math.round(ms / (24 * 60 * MINUTO))} días`, vivo: false };
}

/** El latido que se muestra: «sin instalar» (código sin canjear) no es «no contesta». */
export const latidoMostrado = (caja, ahora = Date.now()) => (caja.vinculada_at
    ? latidoDeCaja(caja.ultimo_latido, ahora)
    : { txt: 'sin instalar', vivo: false });

/**
 * Qué decir del agente de una caja: si está al día y por dónde escribe. Los
 * dos problemas (atrasada y CUPS) se dicen JUNTOS: son dos acciones distintas.
 * Sin versión publicada no opina — no poder leerla no es estar atrasada.
 */
export function estadoDelAgente(caja, publicada) {
    if (!caja.vinculada_at) return null;
    const version = caja.agente_version || null;
    const canal = caja.agente_canal || null;
    if (!version) return { txt: 'versión vieja — hay que actualizarla', mal: true };
    const problemas = [];
    if (publicada && version !== publicada) problemas.push('atrasada — la corrección aún no le llega');
    if (canal === 'CUPS') problemas.push('imprime por CUPS, le quita la ticketera al otro sistema');
    if (problemas.length) return { txt: problemas.join(' · '), mal: true };
    return { txt: `al día · escribe en ${canal || 'la ticketera'}`, mal: false };
}

/** La línea que pone al día una caja: el agente no se actualiza a distancia. */
export const LINEA_DE_ACTUALIZAR =
    'curl -fsSL https://portal.farmasalud.lat/agente-impresion/actualizar.sh | sudo bash';

/** Los estados de un papel en la cola, en palabras, con su tono. */
export const ESTADOS_DE_LA_COLA = {
    PENDIENTE: { txt: 'Esperando', tono: 'neutro' },
    IMPRIMIENDO: { txt: 'Saliendo', tono: 'neutro' },
    IMPRESO: { txt: 'Impreso', tono: 'bien' },
    ERROR: { txt: 'No salió', tono: 'mal' },
};

/** El aviso al quitar una caja: no es lo mismo una que contesta que una que nunca dio señales. */
export const avisoAlQuitarCaja = (caja, sala) => (caja?.ultimo_latido
    ? `Esta caja está contestando: ${sala || 'esa sala'} deja de recibir papel hasta que la vuelvas a instalar. Lo que ya se imprimió por ella se conserva.`
    : 'Nunca dio señales de vida, así que no está imprimiendo nada. Desaparece de la lista y no se puede deshacer.');

/** El código de vinculación partido en dos mitades, para leerlo desde el mostrador. */
export const codigoPartido = (codigo) => `${String(codigo).slice(0, 4)}-${String(codigo).slice(4)}`;

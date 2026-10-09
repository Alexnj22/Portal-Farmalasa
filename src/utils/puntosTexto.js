/**
 * Cómo se dicen los puntos: en dólares, el rótulo de cada movimiento y el de
 * cada aviso. Vivían en `PuntosView` y en `ClientePuntosModal`; se mudaron el
 * 2026-10-05 para que la app del teléfono diga exactamente lo mismo.
 *
 * Los avisos llevan una SEVERIDAD (`danger`/`warning`/`info`), no un color: el
 * portal la vuelve variante de `Badge` y la app, el color de su píldora.
 */
import { formatMoney, formatQty } from './formatNumber';

/** 100 puntos = US$1.00 (cláusula 4 del reglamento). */
export const dolaresDePuntos = (puntos) => formatMoney((Number(puntos) || 0) / 100);
export const puntosTexto = (n) => formatQty(Number(n) || 0);

/** El rótulo de cada tipo de movimiento de la cuenta. */
export const ROTULO_MOVIMIENTO = {
    compra: 'Compra',
    cumpleanos: 'Cumpleaños',
    ajuste: 'Ajuste',
    canje: 'Canje',
    // La factura del canje se anuló y los puntos volvieron (2026-09-28).
    canje_devuelto: 'Canje devuelto',
    anulacion: 'Compra anulada',
    vencimiento: 'Vencimiento',
    // La compra se pasó a otro cliente con una solicitud aprobada (2026-10-01).
    cambio_cliente: 'Compra pasada a otro cliente',
};

/**
 * La clave con la que `puntos_panel_cliente` publica el detalle de un
 * movimiento (documento, quién): `<tipo>-<id>`, y un canje devuelto usa la de
 * su canje. Con el id a secas no encuentra nada — y no da error: el movimiento
 * sale sin documento ni persona.
 */
export const claveDeMovimiento = (m) => `${m?.tipo === 'canje_devuelto' ? 'canje' : m?.tipo}-${m?.id}`;

/** El título de un movimiento: un ajuste dice si dio o quitó. */
export function rotuloDeMovimiento(m) {
    const p = Number(m?.puntos) || 0;
    if (m?.tipo === 'ajuste') return p > 0 ? 'Puntos dados' : 'Puntos quitados';
    return ROTULO_MOVIMIENTO[m?.tipo] ?? ROTULO_MOVIMIENTO.ajuste;
}

/**
 * El detalle que acompaña al rótulo. El rótulo ya dice «Compra» o «Canje»: del
 * motivo se quita esa palabra para no leer «Compra · compra». Y si ya se sabe
 * el documento (`info.documento`), se muestra ése en vez del «ticket …» del
 * sistema anterior.
 */
export function detalleDeMovimiento(m, info = {}) {
    let detalle = String(m?.motivo ?? '')
        .replace(/^(compra anulada|canje aplicado en el sistema de ventas|la factura del canje se anuló|compra|canje|cortesía cumpleaños)(\s·\s)?/i, '')
        .trim();
    if (info.documento) {
        detalle = detalle.replace(/^(ticket\s+)?[0-9A-Za-z_-]+(\s·\s)?/, (x) => (x.includes(info.documento) || /ticket|DTE-|^\d/.test(x) ? '' : x)).trim();
        detalle = [info.documento, detalle].filter(Boolean).join(' · ');
    }
    return detalle;
}

const ptsDe = (a) => puntosTexto(a.puntos);

/** Qué dice cada aviso del programa. Los de movimientos fuera de lo normal traen su `nota` escrita en la base. */
export const AVISOS_DE_PUNTOS = {
    canje_sin_saldo:             { rotulo: 'Canje sin saldo suficiente', severidad: 'danger', puntos: (a) => `Faltaron ${puntosTexto(a.faltaron)}` },
    canje_devuelto:              { rotulo: 'Canje devuelto: la factura se anuló', severidad: 'info', puntos: (a) => `${ptsDe(a)} devueltos` },
    canje_venta_en_cero:         { rotulo: 'Canje dejó la venta en $0.00', severidad: 'danger', puntos: (a) => `${ptsDe(a)} canjeados` },
    anulada_con_puntos_gastados: { rotulo: 'Anulada con puntos ya canjeados', severidad: 'warning', puntos: (a) => `${ptsDe(a)} no recuperados` },
    muchas_ventas:               { rotulo: 'Muchas ventas a una ficha', severidad: 'danger', puntos: (a) => `${ptsDe(a)} acumulados` },
    acumulacion_alta:            { rotulo: 'Acumulación alta en un día', severidad: 'warning', puntos: (a) => `${ptsDe(a)} acumulados` },
    varias_salas:                { rotulo: 'Compras en 3 salas o más', severidad: 'warning', puntos: (a) => `${ptsDe(a)} acumulados` },
    mismo_vendedor:              { rotulo: 'Mismo vendedor, varias veces', severidad: 'warning', puntos: (a) => `${ptsDe(a)} acumulados` },
    venta_a_si_mismo:            { rotulo: 'Venta a su propia ficha', severidad: 'danger', puntos: (a) => `${ptsDe(a)} acumulados` },
    ajuste_suma:                 { rotulo: 'Puntos dados a mano', severidad: 'warning', puntos: (a) => `+${ptsDe(a)}` },
    ajuste_resta:                { rotulo: 'Puntos quitados a mano', severidad: 'warning', puntos: (a) => `−${puntosTexto(Math.abs(a.puntos))}` },
    canje_grande:                { rotulo: 'Canje grande', severidad: 'warning', puntos: (a) => `${ptsDe(a)} canjeados` },
    canje_recien_ganado:         { rotulo: 'Canje con puntos recién ganados', severidad: 'warning', puntos: (a) => `${ptsDe(a)} canjeados` },
    cambio_cliente:              { rotulo: 'Compra pasada de otro cliente', severidad: 'danger', puntos: (a) => `${ptsDe(a)} recibidos` },
    cambio_cliente_fallido:      { rotulo: 'Puntos de un cambio de cliente sin mover', severidad: 'danger', puntos: (a) => `${ptsDe(a)} sin mover` },
};

/** Un tipo que la pantalla todavía no conoce se muestra igual, no desaparece. */
export const avisoDePuntos = (a) => AVISOS_DE_PUNTOS[a?.tipo] ?? { rotulo: 'Movimiento para revisar', severidad: 'warning', puntos: ptsDe };

/**
 * ¿La acumulación está parada? Devuelve los minutos sin acumular, o `null`.
 * Sólo se pregunta de 8:00 a 22:00 SV: las salas abren a las 7 y la primera
 * hora puede no traer ninguna venta con puntos; de noche el silencio es lo normal.
 */
export function motorQuieto(ultima, encendido, ahora = Date.now()) {
    if (!encendido || !ultima) return null;
    // El Salvador es UTC−6 todo el año (sin horario de verano).
    const horaSV = (new Date(ahora).getUTCHours() + 18) % 24;
    if (horaSV < 8 || horaSV >= 22) return null;
    const minutos = Math.round((ahora - new Date(ultima).getTime()) / 60_000);
    return minutos > 60 ? minutos : null;
}

/* Qué pasa con los puntos de una venta cuando cambia de cliente — el TEXTO del
 * recuadro de la solicitud, para el portal (`PuntosDelCambio`) y la app. Antes
 * de aprobar describe la `vista` que devuelve `puntos_cambio_de_cliente` en
 * modo consulta; después, lo que la aprobación dejó en `erp_aplicado.puntos`.
 * `null` cuando no hay nada que decir (venta sin puntos, o ya eran suyos antes
 * de aprobar). `tono` es la variante del aviso: 'info' | 'warning' | 'success'. */
export function avisoDeCambioDeCliente({ vista = null, aplicado = null } = {}) {
    const pts = puntosTexto;
    if (aplicado) {
        const a = aplicado;
        if (!a.hay_puntos) return null;
        if (a.ya_es_suyo) return { tono: 'info', texto: `Los ${pts(a.puntos)} puntos de esta venta ya eran de ${a.a_nombre}.` };
        return {
            tono: a.no_recuperados > 0 ? 'warning' : 'success',
            texto: `Puntos: se le quitaron ${pts(a.se_quitaron)} a ${a.de_nombre}`
                + (a.recibio > 0 ? ` y ${a.a_nombre} recibió ${pts(a.recibio)}.` : `. ${a.a_nombre} no acumula puntos, así que no recibió nada.`)
                + (a.de_otras_compras > 0 ? ` ${pts(a.de_otras_compras)} salieron de sus otros puntos porque ya había usado los de esta compra.` : '')
                + (a.no_recuperados > 0 ? ` ${pts(a.no_recuperados)} ya los había gastado y no se pudieron recuperar.` : ''),
        };
    }
    if (!vista || !vista.hay_puntos || vista.ya_es_suyo) return null;
    return {
        tono: vista.ya_gastados > 0 ? 'warning' : 'info',
        texto: `Esta venta le dio ${pts(vista.puntos)} puntos a ${vista.de_nombre}. Al aprobar`
            + (vista.se_quitan > 0 ? `, se le quitan ${pts(vista.se_quitan)}` : ', no se le puede quitar ninguno')
            + (vista.recibe > 0 ? ` y ${vista.a_nombre} recibe ${pts(vista.recibe)}.` : `. ${vista.a_nombre} no acumula puntos, así que no recibe nada.`)
            + (vista.de_otras_compras > 0 ? ` ${pts(vista.de_otras_compras)} saldrían de sus otros puntos porque ya usó los de esta compra.` : '')
            + (vista.ya_gastados > 0 ? ` ${pts(vista.ya_gastados)} ya los gastó: no se le pueden quitar.` : ''),
    };
}

/** Los motivos de un ajuste a mano (dar o quitar puntos): portal y app. «Otro» exige detalle. */
export const MOTIVOS_DE_AJUSTE_PUNTOS = ['Cumpleaños', 'Promoción', 'Reclamo del cliente', 'Corrección', 'Otro'];

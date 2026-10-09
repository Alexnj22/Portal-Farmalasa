import { formatMoney } from './formatNumber';

/**
 * «−15%» o «$2.00 menos c/u»: lo que el cliente entiende de un descuento de la
 * caja. El monto es por CADA unidad (ver `data/descuentos.js`), y se dice.
 */
export const etiquetaDeDescuento = (tipo, monto) => (tipo === '%'
    ? `−${Number(monto).toLocaleString('es-SV', { maximumFractionDigits: 2 })}%`
    : `${formatMoney(monto)} menos c/u`);

/**
 * Los acentos que puede llevar una oferta en la app: el mismo CHECK de
 * `ofertas_clientes.acento`. `clase` es el color de la muestra en el portal,
 * siempre de un token (nunca un color escrito a mano).
 */
export const ACENTOS_DE_OFERTA = [
    { valor: 'magenta', rotulo: 'Magenta', clase: 'bg-logo-magenta' },
    { valor: 'verde', rotulo: 'Verde', clase: 'bg-logo-green' },
    { valor: 'azul', rotulo: 'Azul', clase: 'bg-brand' },
    { valor: 'naranja', rotulo: 'Naranja', clase: 'bg-warning' },
    { valor: 'rojo', rotulo: 'Rojo', clase: 'bg-danger' },
    { valor: 'violeta', rotulo: 'Violeta', clase: 'bg-brand-purple' },
];

/**
 * En qué estado está una oferta HOY — el mismo rótulo en el portal y en la app.
 * Una oferta se ve en la app si está publicada y hoy cae entre su inicio y su
 * fin; una de un descuento borrado en la caja ya no se ve aunque siga publicada.
 * `tono` es neutro a propósito: cada pantalla lo traduce a su color.
 */
export const estadoDeOferta = (o, hoy) => {
    if (o.descuento_borrado_at) return { key: 'terminada', label: 'Descuento borrado', variant: 'warning' };
    if (!o.publicada) return { key: 'borrador', label: 'Sin publicar', variant: 'neutral' };
    if (o.fin < hoy) return { key: 'terminada', label: 'Terminada', variant: 'neutral' };
    if (o.inicio > hoy) return { key: 'programada', label: 'Programada', variant: 'info' };
    return { key: 'vigente', label: 'En la app', variant: 'success' };
};

/** Las historias duran 24 horas desde `publicada_at` (lo sella la base al publicar). */
export const HORAS_DE_HISTORIA = 24;
export const venceHistoria = (h) => (h.publicada_at ? new Date(new Date(h.publicada_at).getTime() + HORAS_DE_HISTORIA * 3600_000) : null);
export const estadoDeHistoria = (h, ahora = Date.now()) => {
    if (!h.publicada) return { key: 'borrador', label: 'Sin publicar', variant: 'neutral' };
    const vence = venceHistoria(h);
    if (!vence || vence.getTime() <= ahora) return { key: 'terminada', label: 'Terminó', variant: 'neutral' };
    return { key: 'vigente', label: 'En la app', variant: 'success' };
};

export const ESTADOS_DE_OFERTA = [
    { value: 'vigente', label: 'En la app' }, { value: 'programada', label: 'Programada' },
    { value: 'borrador', label: 'Sin publicar' }, { value: 'terminada', label: 'Terminada' },
];

/**
 * A dónde lleva el botón de una historia o un banner en la app de clientes. Se
 * elige de una lista cerrada y no se escribe, para que un enlace mal tecleado
 * no deje un botón que no hace nada. `boton` es el texto que la historia pinta.
 * La lista es UNA para el portal y para la app del personal.
 */
export const DESTINOS_DE_LA_APP = [
    { valor: '', rotulo: 'Sin botón', boton: null },
    { valor: '/ofertas', rotulo: 'Ofertas', boton: 'Ver ofertas' },
    { valor: '/sucursales', rotulo: 'Sucursales', boton: 'Ver sucursales' },
    { valor: '/puntos', rotulo: 'Mis puntos', boton: 'Ver mis puntos' },
    { valor: '/invitar', rotulo: 'Invitar amigos', boton: 'Invitar' },
];

/** Una historia se puede guardar con título de 3 letras y una imagen (nueva o la que ya tenía). */
export const historiaValida = (f, tieneImagen) => String(f.titulo ?? '').trim().length >= 3 && !!tieneImagen;

/** La fila de `app_historias` que se guarda. Duran 24 h desde que se publican; `inicio`/`fin` sólo cumplen con la tabla. */
export function filaDeHistoria(f, imagen_path, hoy, manana) {
    const destino = DESTINOS_DE_LA_APP.find((d) => d.valor === (f.enlace ?? '')) ?? DESTINOS_DE_LA_APP[0];
    return {
        titulo: f.titulo.trim(), rotulo: f.rotulo?.trim() || null, texto: f.texto?.trim() || null, imagen_path,
        inicio: hoy, fin: manana, enlace: destino.valor || null, boton: destino.boton, publicada: !!f.publicada,
        oferta_id: f.oferta_id || null,
    };
}

/** Un banner: título, fechas en orden y una imagen. */
export const bannerValido = (f, tieneImagen) => String(f.titulo ?? '').trim().length >= 3
    && !!f.inicio && !!f.fin && f.fin >= f.inicio && !!tieneImagen;

/** La fila de `app_banners`: con oferta, abre la oferta; si no, la pantalla elegida. */
export function filaDeBanner(f, imagen_path) {
    return {
        titulo: f.titulo.trim(), titulo_visible: !!f.titulo_visible, imagen_path,
        oferta_id: f.oferta_id || null, enlace: f.oferta_id ? null : (f.enlace || null),
        inicio: f.inicio, fin: f.fin, publicada: !!f.publicada,
    };
}

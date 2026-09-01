/* Lo que la campana necesita saber de un aviso de cierre de meta.
 *
 * Vive fuera del componente porque no es un componente: leerlo desde
 * `CierreDeMeta.jsx` rompía el refresco en caliente (un archivo que exporta
 * componentes no puede exportar además funciones sueltas).
 */

/**
 * Lee la metadata del aviso y devuelve lo que hace falta para dibujar, o `null`
 * si no alcanza — un aviso viejo (de antes de la migración del 2026-09-01), o
 * un mes que cerró SIN meta, que no tiene porcentaje que dibujar.
 *
 * Los montos llegan sólo a quien tiene `dash_meta_sala_vista_completa`: la
 * función que escribe el aviso parte la metadata igual que parte el cuerpo,
 * porque el destinatario puede leer su propia fila. Así que `venta` ausente no
 * es un error, es el caso de 28 de las 33 personas de sala.
 */
export function datosDeCierreDeMeta(n) {
    if (n?.type !== 'METAS_CIERRE_SALA') return null;
    const m = n.metadata || {};
    const pct = Number(m.pct);
    if (!Number.isFinite(pct)) return null;

    const venta     = m.venta      == null ? null : Number(m.venta);
    const meta      = m.meta       == null ? null : Number(m.meta);
    const metaNueva = m.meta_nueva == null ? null : Number(m.meta_nueva);

    const puesto   = Number(m.puesto);
    const cuantas  = Number(m.de);
    const promedio = Number(m.promedio);

    return {
        pct,
        cumplida: pct >= 100,
        // El puesto es contexto, no adorno: un 95.0% que suena a
        // casi-lo-logré es el cuarto lugar de seis, y un 94.3% que suena
        // parecido es el quinto.
        puesto:   Number.isFinite(puesto)   ? puesto   : null,
        de:       Number.isFinite(cuantas)  ? cuantas  : null,
        promedio: Number.isFinite(promedio) ? promedio : null,
        // El listado llega sólo al jefe de sala, y sin un solo dólar: se
        // comparan cumplimientos, que es lo único comparable entre una sala
        // que vende $50,354.03 y otra que vende $14,345.77.
        tabla: Array.isArray(m.tabla)
            ? m.tabla.filter(f => f && Number.isFinite(Number(f.pct)))
                     .map(f => ({ sala: String(f.sala || ''), pct: Number(f.pct) }))
            : [],
        venta:     Number.isFinite(venta)     ? venta     : null,
        meta:      Number.isFinite(meta)      ? meta      : null,
        metaNueva: Number.isFinite(metaNueva) ? metaNueva : null,
        mesCerrado: m.mes_cerrado || '',
        mesNuevo:   m.mes_nuevo   || '',
    };
}

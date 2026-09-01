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
        // El puesto es de LA PERSONA entre los vendedores de su sala, no de
        // la sala entre las salas: un jefe no maneja las otras salas, maneja a
        // su gente. Nulo para quien no vendió ese mes.
        puesto:   Number.isFinite(puesto)   ? puesto   : null,
        de:       Number.isFinite(cuantas)  ? cuantas  : null,
        promedio: Number.isFinite(promedio) ? promedio : null,
        // Cuánto de la venta de la sala hizo esta persona.
        miParte: m.mi_parte == null ? null : Number(m.mi_parte),
        // El listado llega sólo al jefe de sala, y sin un solo dólar: es la
        // participación de cada quien en la venta de la sala, que es lo que se
        // puede comparar sin publicar cuánto vendió nadie. `yo` lo marca el
        // servidor por destinatario — el código de empleado no puede viajar en
        // la metadata de un aviso ajeno, es la semilla del PIN del kiosco.
        tabla: Array.isArray(m.tabla)
            ? m.tabla.filter(f => f && Number.isFinite(Number(f.parte)))
                     .map(f => ({ nombre: String(f.nombre || ''), parte: Number(f.parte), yo: !!f.yo }))
            : [],
        venta:     Number.isFinite(venta)     ? venta     : null,
        meta:      Number.isFinite(meta)      ? meta      : null,
        metaNueva: Number.isFinite(metaNueva) ? metaNueva : null,
        mesCerrado: m.mes_cerrado || '',
        mesNuevo:   m.mes_nuevo   || '',
    };
}

/**
 * El cierre visto desde administración: el cumplimiento de la EMPRESA, cada
 * sucursal y los tres que más vendieron.
 *
 * Es otro tipo de aviso (`METAS_CIERRE_EMPRESA`) y no una variante del de sala,
 * porque no es la misma noticia dicha para otro público: la sala se entera de
 * lo suyo, administración se entera de las seis a la vez.
 */
export function datosDeCierreDeEmpresa(n) {
    if (n?.type !== 'METAS_CIERRE_EMPRESA') return null;
    const m = n.metadata || {};
    const pct = Number(m.pct);
    if (!Number.isFinite(pct)) return null;

    const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

    return {
        pct,
        cumplida: pct >= 100,
        venta: num(m.venta),
        meta:  num(m.meta),
        mesCerrado: m.mes_cerrado || '',
        mesNuevo:   m.mes_nuevo   || '',
        sucursales: Array.isArray(m.sucursales)
            ? m.sucursales.filter(s => s && Number.isFinite(Number(s.pct)))
                          .map(s => ({ sala: String(s.sala || ''), pct: Number(s.pct) }))
            : [],
        // `employee_id` es la ficha, no la cuenta: con ella la campana busca a
        // la persona en el mismo store del que salen las caras del resto del
        // portal, y la foto se firma donde ya se firma. Una URL guardada en la
        // metadata expiraría — ver `storageFiles.js`.
        top3: Array.isArray(m.top3)
            ? m.top3.filter(t => t && t.employee_id)
                    .map(t => ({
                        employeeId: String(t.employee_id),
                        nombre: String(t.nombre || ''),
                        sala:   String(t.sala || ''),
                        venta:  num(t.venta),
                    }))
            : [],
    };
}

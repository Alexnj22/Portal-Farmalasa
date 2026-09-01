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
                     .map(f => ({
                         // La ficha, para pintar la foto: la campana busca a la
                         // persona en el store, donde la foto ya viene firmada.
                         employeeId: f.employee_id ? String(f.employee_id) : null,
                         // Partido en dos porque `employees.name` es una columna
                         // generada y con tres palabras la frontera es ambigua
                         // — ver `shortEmployeeName`.
                         nombre: String(f.nombre || ''),
                         nombres: f.nombres || '',
                         apellidos: f.apellidos || '',
                         parte: Number(f.parte),
                         yo: !!f.yo,
                         // El monto de cada vendedor viaja SÓLO en el aviso del
                         // jefe; en el del dependiente la clave no existe.
                         venta: f.venta == null || !Number.isFinite(Number(f.venta)) ? null : Number(f.venta),
                     }))
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

/* ── La escala del cumplimiento, decidida por el usuario ───────────────────
 * Verde a partir de 100, naranja a partir de 95, rojo debajo. Tres tramos y no
 * dos: entre «cumplió» y «no cumplió» hay una franja que en la práctica se
 * trata distinto —95.0% se conversa, 89.2% se corrige—, y con dos colores esas
 * dos salas salían pintadas igual.
 *
 * El color nunca va solo: el porcentaje está escrito al lado en todos los
 * sitios donde se usa. Verde y naranja son un par que mucha gente no
 * distingue. */
export function tonoDeCumplimiento(pct, isDark) {
    if (pct >= 100) return { texto: isDark ? 'text-success-text' : 'text-success',
                             fondo: isDark ? 'bg-success-text'   : 'bg-success' };
    if (pct >= 95)  return { texto: isDark ? 'text-warning-text' : 'text-warning',
                             fondo: isDark ? 'bg-warning-text'   : 'bg-warning' };
    return { texto: isDark ? 'text-danger-text' : 'text-danger',
             fondo: isDark ? 'bg-danger-text'   : 'bg-danger' };
}

/* ── El vendedor contra el promedio de su sala ─────────────────────────────
 * Verde arriba, rojo abajo, amarillo EN el promedio — y el «en» necesita un
 * ancho, porque nadie cae exactamente en la media: sin banda, una décima de
 * diferencia pintaría verde o rojo y el color diría más de lo que el dato
 * sostiene.
 *
 * La banda es ±5% RELATIVO al promedio, no ±1 punto fijo: la participación
 * media depende de cuánta gente hay en la sala —16.6% con seis, 20.0% con
 * cinco, 10% con diez— así que un ancho fijo sería enorme en una sala grande y
 * mínimo en una chica. Medido en agosto: en Salud 5 (promedio 20.0%) la banda
 * va de 19.0 a 21.0, y en La Popular (16.6%) de 15.8 a 17.4.
 *
 * `realce` es el fondo de la fila propia. Va en el color del tramo para que
 * resaltar a la persona no pelee con el rojo de estar bajo el promedio.
 */
export function tonoContraPromedio(parte, promedio, isDark) {
    if (promedio == null || !Number.isFinite(promedio) || promedio <= 0) {
        return { texto: '', fondo: isDark ? 'bg-chart-1' : 'bg-chart-1-solid',
                 realce: 'bg-surface-card-hover ring-border-card' };
    }
    if (parte >= promedio * 1.05) {
        return { texto: isDark ? 'text-success-text' : 'text-success',
                 fondo:  isDark ? 'bg-success-text'   : 'bg-success',
                 realce: 'bg-success/10 ring-success/30' };
    }
    if (parte <= promedio * 0.95) {
        return { texto: isDark ? 'text-danger-text' : 'text-danger',
                 fondo:  isDark ? 'bg-danger-text'   : 'bg-danger',
                 realce: 'bg-danger/10 ring-danger/30' };
    }
    return { texto: isDark ? 'text-warning-text' : 'text-warning',
             fondo:  isDark ? 'bg-warning-text'   : 'bg-warning',
             realce: 'bg-warning/10 ring-warning/30' };
}

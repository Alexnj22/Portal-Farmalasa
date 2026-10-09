import { formatMoney, formatQty } from './formatNumber';
import { correrMes, hoySV, mesSV } from './fecha';
import { mensajeAmigable } from './errorMessages';

/**
 * Promociones — lo que comparten las pestañas.
 *
 * Vive acá y no repartido en cada archivo porque la misma pregunta contestada
 * en dos sitios termina dando dos respuestas: es la lección de `turnoDelDia`.
 */


// El formateador del portal, no `toLocaleString` a mano: un locale escrito en
// cada archivo es cómo dos pantallas terminan mostrando el mismo número con
// separadores distintos.
export const fmtMoneda   = (n) => formatMoney(Number(n) || 0);
export const fmtUnidades = (n) => formatQty(Number(n) || 0);

/** El lote de una promoción: sin lote es un guion, no un «0 u.» que se lee como dato. */
export const fmtLote = (n) => (n == null ? '—' : fmtUnidades(n));

/**
 * El error de una carga del módulo, en palabras de la pantalla.
 *
 * El 42501 es «tu cargo no tiene el módulo», que tiene arreglo y se dice con
 * su camino; lo demás pasa por `mensajeAmigable`. Estaba escrito CUATRO veces
 * —una por pestaña—, tres con `error.message` crudo y una sin el camino.
 */
export function mensajeDeCarga(error, porDefecto) {
    if (error?.code === '42501') {
        return 'Tu cargo todavía no tiene el módulo de Promociones. Hay que otorgarlo en Ajustes → Permisos.';
    }
    return mensajeAmigable(error, porDefecto);
}

/** «1 sep – 30 sep 2026». Sin hora: son fechas, no instantes. */
export function fmtVigencia(inicio, fin) {
    if (!inicio || !fin) return '—';
    const d = (s) => {
        const [y, m, dd] = String(s).split('-').map(Number);
        // Se construye con componentes y no con `new Date(s)`: una fecha sin
        // hora leída como UTC retrocede un día en El Salvador.
        return new Date(y, m - 1, dd);
    };
    const f = (dt, conAnio) => new Intl.DateTimeFormat('es-SV', {
        day: 'numeric', month: 'short', ...(conAnio ? { year: 'numeric' } : {}),
    }).format(dt);
    const a = d(inicio), b = d(fin);
    return `${f(a, a.getFullYear() !== b.getFullYear())} – ${f(b, true)}`;
}

/** Cuántos días le quedan a una vigencia. Negativo si ya venció. */
export function diasRestantes(fin) {
    if (!fin) return null;
    const [y, m, d] = String(fin).split('-').map(Number);
    const [hy, hm, hd] = hoySV().split('-').map(Number);
    return Math.round((new Date(y, m - 1, d) - new Date(hy, hm - 1, hd)) / 86400000);
}

/**
 * El estado que se PINTA, que no es siempre el que guarda la base: «por vencer»
 * no es un estado almacenado, es una lectura de la fecha. Guardarlo obligaría a
 * un proceso que lo mantenga al día y a que alguien lo mire cuando se atrase.
 */
export function estadoVisible(promo) {
    if (promo?.estado === 'finalizada') return { clave: 'finalizada', rotulo: 'Terminada', variant: 'neutral' };
    if (promo?.estado === 'borrador')   return { clave: 'borrador',   rotulo: 'Borrador',  variant: 'neutral' };
    const dias = diasRestantes(promo?.fin);
    if (dias !== null && dias < 0)  return { clave: 'vencida',    rotulo: 'Vencida',    variant: 'warning' };
    if (dias !== null && dias <= 7) return { clave: 'por_vencer', rotulo: 'Por vencer', variant: 'warning' };
    return { clave: 'activa', rotulo: 'Activa', variant: 'success' };
}

/** El rótulo de la presentación de un renglón. NULL = cualquiera. */
export const rotuloPresentacion = (factor, etiqueta) =>
    factor == null
        ? 'Cualquier presentación'
        : (etiqueta || `×${factor}`);

/**
 * El motivo del cierre, en palabras del negocio. La base guarda la clave; la
 * pantalla nunca la muestra cruda.
 */
export const MOTIVO_CIERRE = {
    lote_agotado:     'Se vendió el lote',
    fin_de_vigencia:  'Se cumplió la fecha',
};

/** Agrupa los renglones por laboratorio, que es como se leen. */
export function porLaboratorio(renglones = []) {
    const mapa = new Map();
    for (const r of renglones) {
        const k = r.laboratorio || 'Sin laboratorio';
        if (!mapa.has(k)) mapa.set(k, []);
        mapa.get(k).push(r);
    }
    return [...mapa.entries()]
        .map(([laboratorio, items]) => ({ laboratorio, items }))
        .sort((a, b) => a.laboratorio.localeCompare(b.laboratorio, 'es'));
}

/** El texto que busca la barra: nombre, nota y laboratorios (la lista no trae productos). */
export const textoBuscable = (p) => [
    p.nombre, p.nota,
    ...(Array.isArray(p.laboratorios) ? p.laboratorios : []),
].filter(Boolean).join(' ');

// ─────────────────────────────────────────────────────────────────────────────
// El tipo LABORATORIO — el mes es su unidad
// ─────────────────────────────────────────────────────────────────────────────

/**
 * «agosto de 2026» a partir de «2026-08». Sin día: el programa es del mes entero.
 *
 * El patrón es el MISMO que el CHECK de la base (`(0[1-9]|1[0-2])`) y no un
 * `\d{2}` suelto: con el suelto, «2026-13» pasaba y `new Date(2026, 12, 1)`
 * rueda a enero de 2027. O sea que la pantalla nombraba con toda confianza un
 * mes que nadie había pedido, y del año siguiente.
 */
export function rotuloMes(ym) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(ym || ''))) return '—';
    const [y, m] = String(ym).split('-').map(Number);
    // Con componentes y no con `new Date('2026-08')`, que se lee como UTC y en
    // El Salvador retrocede al mes anterior.
    return new Intl.DateTimeFormat('es-SV', { month: 'long', year: 'numeric' })
        .format(new Date(y, m - 1, 1));
}

/**
 * Los meses que se pueden elegir: el siguiente, el actual y los anteriores.
 *
 * El siguiente entra porque un programa se negocia ANTES de que empiece el mes;
 * los anteriores, porque esto es retroactivo — cargar agosto en septiembre
 * calcula agosto completo con las ventas que ya están.
 *
 * ⚠️ El signo del paso importa y ya se equivocó una vez: con `i--` la lista
 * arrancaba en el mes anterior y seguía hacia ADELANTE, ofreciendo doce meses
 * que todavía no existen. No falla nada —son cadenas AAAA-MM válidas— y el
 * único síntoma fue que la liquidación se armó del mes que no era. Por eso lo
 * fija `tests/unit/promocionesUtils.test.js` con una fecha congelada.
 */
export function mesesRecientes(cuantos = 13) {
    const [y, m] = hoySV().split('-').map(Number);
    const out = [];
    for (let i = -1; i < cuantos - 1; i++) {
        const d = new Date(y, m - 1 - i, 1);
        const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        out.push({ value, label: rotuloMes(value) });
    }
    return out;
}

/**
 * El mes anterior al de hoy, en AAAA-MM.
 *
 * Existe para que nadie lo saque de una POSICIÓN de `mesesRecientes`: un
 * `meses[1]` se lee como «el anterior» y deja de serlo el día que la lista
 * cambia de orden, que es exactamente lo que pasó.
 */
export function mesAnterior() {
    return correrMes(mesSV(), -1);
}

/** El resumen de una promoción de laboratorio para la tarjeta. */
export const esLaboratorio = (p) => p?.tipo === 'laboratorio';

/**
 * En cuánto queda UNA unidad con un descuento aplicado.
 *
 * ⚠️ Esta fórmula está dicha DOS veces —acá y en la edge function
 * `descuentos-erp`, que la vuelve a aplicar al guardar— y se mueven juntas. La
 * de acá es para VER mientras se arma el descuento; la del servidor es la que
 * decide, porque un formulario se saltea cambiando el cuerpo de la petición.
 *
 * Y es la del sistema de la caja, medida, no una interpretación: el porcentaje
 * se aplica al renglón y el monto se descuenta **por cada unidad**
 * (`subtotal -= monto × cantidad`). Por eso acá se razona sobre UNA unidad —
 * multiplicar por la cantidad es exactamente lo que hace la venta.
 */
export function precioConDescuento(precio, tipo, monto) {
    const p = Number(precio) || 0;
    const m = Number(monto) || 0;
    return tipo === '%' ? p * (1 - m / 100) : p - m;
}

/**
 * Cuánto se pierde POR UNIDAD con este descuento, o 0 si no se pierde nada.
 *
 * El costo llega ya CON IVA (`costo_con_iva`): `vineta` es el precio al público
 * y la columna `costo` es el precio neto de la factura de compra, así que
 * crudos no se pueden comparar.
 */
export function perdidaPorUnidad(datos, tipo, monto) {
    const precio = Number(datos?.precio) || 0;
    const costo = Number(datos?.costo_con_iva) || 0;
    if (!precio || !costo) return 0;
    const queda = precioConDescuento(precio, tipo, monto);
    return queda < costo ? costo - queda : 0;
}

/**
 * Los productos ordenados por lo que se PIERDE en cada uno, de mayor a menor.
 *
 * Pedido por el usuario el 2026-09-05. El orden por nombre obliga a recorrer la
 * lista entera para encontrar el que duele: con 36 productos, el que pierde
 * $6.11 puede estar en el renglón doce. Ordenado por pérdida, lo primero que se
 * ve es lo que hay que decidir.
 *
 * Los que no pierden nada conservan su orden original detrás — reordenarlos
 * también haría que la lista se sacudiera entera con cada tecla del monto.
 *
 * @param productos    `[{ id, nombre }]`
 * @param porProducto  Map de id → `{ precio, costo_con_iva }`
 */
export function ordenarPorPerdida(productos, porProducto, tipo, monto) {
    return [...productos]
        .map((p, i) => ({ p, i, pierde: perdidaPorUnidad(porProducto.get(p.id), tipo, monto) }))
        .sort((a, b) => (b.pierde - a.pierde) || (a.i - b.i))
        .map((x) => x.p);
}

/**
 * Lo que hay que mandarle a `guardarDescuento`, derivado de la promoción.
 *
 * Vive acá y no en el modal para que el cálculo de la ventana —el `min` de los
 * inicios y el `max` de los fines— esté escrito UNA vez: dicho dos veces, el
 * día que se cambie una de las dos el descuento cubriría un tramo distinto que
 * la promoción y nadie lo vería, porque ninguna de las dos pantallas muestra la
 * otra.
 */
export function descuentoDesdeLaPromocion(renglones, valor) {
    const productos = [...new Set(renglones.map((r) => r.erp_product_id))];
    const inicios = renglones.map((r) => r.inicio).filter(Boolean).sort();
    const fines = renglones.map((r) => r.fin).filter(Boolean).sort();
    return {
        id: 0,
        tipo: valor.tipo || '%',
        monto: Number(valor.monto),
        inicio: inicios[0] || '',
        fin: fines[fines.length - 1] || valor.finPropio || '',
        /* La SALA la decide quien llama, no esto: una promoción marcada en tres
           salas manda tres veces con distinta sala. Ver `mandarDescuento`. */
        productos,
    };
}

/** Lo que impide guardar el descuento, dicho antes de intentarlo. */
export function problemasDelDescuento(renglones, valor, alcanceTodo) {
    if (!valor.activo) return [];
    const l = [];
    const monto = Number(valor.monto);
    const hayFin = renglones.some((r) => r.fin);
    if (!renglones.length) l.push('Agrega los productos antes de ponerle descuento.');
    if (!Number.isFinite(monto) || monto <= 0) l.push('El descuento tiene que ser mayor que cero.');
    if (valor.tipo === '%' && monto > 100) l.push('Un porcentaje no puede pasar de 100.');
    if (!hayFin && !valor.finPropio) l.push('Dile hasta cuándo descuenta.');
    if (alcanceTodo && !valor.todas && !valor.branchId) l.push('Elige la sala del descuento.');
    return l;
}

/**
 * Un número escrito por una persona. Devuelve `null` si el texto no es un
 * número — nunca un 0 inventado: con `Number(x) || 0`, «1,5» se guardaba como
 * bono de $0 sin que nadie se enterara.
 *
 * La coma, como se escribe en El Salvador: separador de MILES cuando agrupa de
 * a tres («4,250», «1,250.50») y decimal sólo cuando no puede ser otra cosa
 * («1,5»). Leerla siempre como decimal convertía un umbral de $4,250 en $4.25.
 */
export function numeroEscrito(texto) {
    if (texto == null) return null;
    let limpio = String(texto).trim().replace(/\s+/g, '').replace(/^\$/, '');
    if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(limpio)) limpio = limpio.replace(/,/g, '');
    else if (/^-?\d+,\d+$/.test(limpio)) limpio = limpio.replace(',', '.');
    if (limpio === '') return null;
    if (!/^-?\d+(\.\d+)?$/.test(limpio)) return null;
    return Number(limpio);
}

/**
 * Lo que la base rechazaría al crear la promoción, dicho ANTES de mandarla.
 *
 * Cada regla es un CHECK o una validación de `crear_promocion` que hoy llegaba
 * como «Uno de los valores está fuera del rango permitido» —un mensaje que no
 * dice qué producto ni qué campo—. Medido el 2026-10-01 contra el esquema vivo:
 * `fin` es NOT NULL (el formulario lo daba por opcional), `fin >= inicio`,
 * `lote_total > 0`, proveedor obligatorio si paga un proveedor, y el reparto
 * tiene que sumar el lote.
 *
 * Devuelve frases cortas; agrupa por regla para no listar 40 veces lo mismo.
 */
export function problemasDeLaPromocion(renglones) {
    const fallas = new Map();   // frase → productos
    const anotar = (frase, r) => {
        if (!fallas.has(frase)) fallas.set(frase, []);
        fallas.get(frase).push(r.producto);
    };
    for (const r of renglones) {
        if (!r.inicio) anotar('falta la fecha de inicio', r);
        if (!r.fin) anotar('falta la fecha de fin', r);
        if (r.inicio && r.fin && r.fin < r.inicio) anotar('termina antes de empezar', r);
        const lote = r.lote_total === '' || r.lote_total == null ? null : numeroEscrito(r.lote_total);
        const loteMal = r.lote_total !== '' && r.lote_total != null
            && (lote == null || lote <= 0 || !Number.isInteger(lote));
        if (loteMal) anotar('el lote tiene que ser un número entero mayor que cero (o vacío)', r);
        if (r.tiene_bono) {
            if (r.paga === 'proveedor' && !r.supplier_id) anotar('falta el proveedor que paga', r);
            for (const [campo, rot] of [['bono_vendedor', 'vendedor'], ['bono_adm', 'admón.'], ['bono_bodega', 'bodega']]) {
                const n = numeroEscrito(r[campo]);
                if (r[campo] !== '' && r[campo] != null && (n == null || n < 0)) {
                    anotar(`el bono de ${rot} no es un monto válido`, r);
                }
            }
            const upb = numeroEscrito(r.unidades_por_bono);
            if (upb == null || upb < 1 || !Number.isInteger(upb)) anotar('«cada cuántas unidades» tiene que ser un entero', r);
        }
        const marcadas = Object.entries(r.salas || {}).filter(([, m]) => m).map(([id]) => id);
        const suma = marcadas.reduce((a, id) => a + (numeroEscrito(r.reparto?.[id]) || 0), 0);
        if (suma > 0 && lote == null) anotar('reparte unidades sin un lote', r);
        if (suma > 0 && lote != null && suma !== lote) anotar('el reparto no suma el lote', r);
    }
    return [...fallas.entries()].map(([frase, prods]) => (prods.length === 1
        ? `${prods[0]}: ${frase}.`
        : `${prods.length} productos: ${frase}.`));
}

/**
 * Vigente, programado o terminado — sale de las fechas, que es lo único que
 * tiene un descuento. Vive acá porque lo usan la pestaña (secciones) y la vista
 * (el filtro de estado): escrito dos veces, el filtro y la sección podrían
 * dejar de coincidir.
 */
export function estadoDescuento(d, hoy = hoySV()) {
    if (d.fin < hoy) return { clave: 'terminados', rotulo: 'Terminado', variant: 'neutral' };
    if (d.inicio > hoy) return { clave: 'programados', rotulo: 'Programado', variant: 'info' };
    return { clave: 'activos', rotulo: 'Descontando', variant: 'success' };
}


/* ── Lo que la app y el portal cuentan igual (2026-10-06) ────────────────────
   Vivían dentro de los componentes del portal (`PromocionesView`,
   `TabSeguimiento`); la app los necesita idénticos — una copia se separa en
   silencio y las dos pantallas terminan diciendo números distintos. */

/** Las tarjetas de Activas sobre las promociones vivas que se están mirando. */
export function conteoDePromociones(vivas = []) {
    const porEstado = (clave) => vivas.filter((p) => estadoVisible(p).clave === clave).length;
    return {
        activas: porEstado('activa'),
        porVencer: porEstado('por_vencer'),
        borrador: porEstado('borrador'),
        abiertos: vivas.reduce((a, p) => a + (Number(p.abiertos) || 0), 0),
        bajanPrecio: vivas.filter((p) => Number(p.descuentos) > 0).length,
    };
}

/** El resumen de Seguimiento de una promoción por producto (`get_promocion`). */
export function resumenDeSeguimiento(detalle) {
    const renglones = Array.isArray(detalle?.renglones) ? detalle.renglones : [];
    const vendedores = Array.isArray(detalle?.vendedores) ? detalle.vendedores : [];
    return {
        unidades: renglones.reduce((a, r) => a + (Number(r.vendido_base) || 0), 0),
        documentos: renglones.reduce((a, r) => a + (Number(r.documentos) || 0), 0),
        vendedores: vendedores.length,
        bono: vendedores.reduce((a, v) => a + (Number(v.bono) || 0), 0),
        conBono: renglones.some((r) => r.tiene_bono),
    };
}

/**
 * «Quién vendió», agrupado por sala y ordenado por unidades. El bono de quien
 * vendió con un código que no da con nadie (`sin_dueno`) NO suma a la sala:
 * no se paga ni se reparte entre los demás.
 */
export function vendedoresPorSala(vendedores = []) {
    const mapa = new Map();
    for (const v of vendedores) {
        const sala = v.sala || 'Sin sala';
        if (!mapa.has(sala)) mapa.set(sala, { sala, gente: [], unidades: 0, bono: 0 });
        const g = mapa.get(sala);
        g.gente.push(v);
        g.unidades += Number(v.unidades) || 0;
        g.bono += v.sin_dueno ? 0 : Number(v.bono) || 0;
    }
    return [...mapa.values()]
        .map((g) => ({ ...g, gente: g.gente.sort((a, b) => (b.unidades || 0) - (a.unidades || 0)) }))
        .sort((a, b) => a.sala.localeCompare(b.sala, 'es', { numeric: true }));
}

/** El tono del avance contra el lote: completo, cerca (≥80%) o en curso. */
export const tonoDeAvance = (pct) => (pct >= 100 ? 'success' : pct >= 80 ? 'warning' : 'info');

// ── Promoción por LABORATORIO: el formulario ──────────────────────────────
// Vivía dentro de `PromocionLaboratorioModal`; la app crea y edita con lo
// mismo. `umbrales` es `{ '<branchId>:<nivel>': '4250' }` tal como se escribe.

/** Los cuatro niveles con que nace una promoción nueva. */
export const nivelesIniciales = () => [1, 2, 3, 4].map((nivel) => ({ nivel, monto: '' }));

/**
 * Lo que hay que avisar ANTES de mandar. Los umbrales de cada sala tienen que
 * SUBIR con el nivel: el cálculo paga «el más alto cuyo umbral se cumplió», así
 * que un nivel 3 más barato que el 2 pagaría uno que no se alcanzó.
 */
export function problemasDePromocionLaboratorio({ nombre, mes, labs, niveles, umbrales, salas, paga, supplierId }) {
    const out = [];
    if (!String(nombre ?? '').trim()) out.push('Falta el nombre.');
    if (!mes) out.push('Falta el mes.');
    if (!labs?.length) out.push('Elige al menos un laboratorio.');
    if (!niveles?.length) out.push('Tiene que haber al menos un nivel.');
    if ((niveles || []).some((n) => !(numeroEscrito(n.monto) > 0))) {
        out.push('Cada nivel necesita un monto mayor que cero.');
    }
    const u = umbrales || {};
    const conUmbral = (salas || []).filter((s) =>
        (niveles || []).some((n) => numeroEscrito(u[`${s.id}:${n.nivel}`]) > 0));
    if (!conUmbral.length) out.push('Ninguna sala tiene umbral: nadie podría alcanzar un nivel.');
    for (const s of conUmbral) {
        let previo = null;
        for (const n of niveles) {
            const v = numeroEscrito(u[`${s.id}:${n.nivel}`]);
            if (!(v > 0)) continue;
            if (previo !== null && v <= previo) {
                out.push(`En ${s.name} el nivel ${n.nivel} no pide más venta que el anterior.`);
                break;
            }
            previo = v;
        }
    }
    /* Un umbral escrito que no es número se descartaba en silencio y la sala
       quedaba sin ese nivel. */
    const ilegibles = Object.entries(u).filter(([, v]) => String(v ?? '').trim() !== '' && numeroEscrito(v) == null);
    if (ilegibles.length) out.push(`Hay ${ilegibles.length === 1 ? 'un umbral escrito' : `${ilegibles.length} umbrales escritos`} que no se entienden como monto.`);
    if (paga === 'proveedor' && !supplierId) out.push('Elige el proveedor que paga.');
    return out;
}

/** Lo que reciben `crearPromocionLaboratorio` / `editarPromocionLaboratorio` (sin `mes` ni `id`). */
export function payloadDePromocionLaboratorio({ nombre, labs, niveles, umbrales, paga, supplierId, nota }) {
    return {
        nombre: String(nombre ?? '').trim(),
        laboratorios: (labs || []).map((l) => Number(l.id)),
        niveles: (niveles || []).map((n) => ({ nivel: n.nivel, monto: numeroEscrito(n.monto) })),
        umbrales: Object.entries(umbrales || {})
            .filter(([, v]) => numeroEscrito(v) > 0)
            .map(([k, v]) => {
                const [branch_id, nivel] = k.split(':').map(Number);
                return { branch_id, nivel, umbral: numeroEscrito(v) };
            }),
        paga: paga || null,
        supplierId: paga === 'proveedor' && supplierId ? Number(supplierId) : null,
        nota: String(nota ?? '').trim() || null,
    };
}

/** Quitar un nivel renumera los niveles Y sus umbrales: sin hueco (1, 3, 4) ni umbrales huérfanos. */
export function quitarNivelDePromocion(niveles, umbrales, nivel) {
    const quedan = niveles.filter((n) => n.nivel !== nivel);
    const orden = quedan.map((n) => n.nivel);
    const salida = {};
    for (const [k, v] of Object.entries(umbrales || {})) {
        const [b, nv] = k.split(':').map(Number);
        const i = orden.indexOf(nv);
        if (i >= 0) salida[`${b}:${i + 1}`] = v;
    }
    return { niveles: quedan.map((n, i) => ({ ...n, nivel: i + 1 })), umbrales: salida };
}

/** Copia los umbrales de una sala a las que no tienen ninguno; las que ya tienen algo NO se pisan. */
export function copiarUmbralesDeSala(umbrales, salas, niveles, desde) {
    const salida = { ...(umbrales || {}) };
    for (const s of salas || []) {
        if (String(s.id) === String(desde)) continue;
        if (niveles.some((n) => numeroEscrito(salida[`${s.id}:${n.nivel}`]) > 0)) continue;
        for (const n of niveles) {
            const v = salida[`${desde}:${n.nivel}`];
            if (v) salida[`${s.id}:${n.nivel}`] = v;
        }
    }
    return salida;
}

// ─── Promoción POR PRODUCTO: el formulario de alta ───────────────────────────
// Vivía dentro de `PromocionModal`; la app la necesita igual — lo que se
// pregunta una vez, cómo nace cada producto, qué viaja a `crear_promocion` y a
// qué sala va el descuento—, así que vive acá, una vez.

/**
 * Lo que se pregunta UNA vez y vale para todos los productos. `fin` nace vacío
 * para que se ELIJA (es NOT NULL en la base: `problemasDeLaPromocion` lo dice).
 * Ninguna sala marcada = todas.
 */
export const generalDePromocionNuevo = (salas = []) => ({
    inicio: hoySV(),
    fin: '',
    lote_total: '',
    tiene_bono: true,
    paga: 'proveedor',
    supplier_id: '',
    bono_vendedor: '1.00',
    bono_adm: '0.25',
    bono_bodega: '0.25',
    unidades_por_bono: '1',
    salas: Object.fromEntries(salas.map((s) => [s.id, false])),
    reparto: Object.fromEntries(salas.map((s) => [s.id, ''])),
});

/**
 * Un producto nace con los valores generales ya puestos y confirmado. `ajustado`
 * marca si alguien lo tocó a mano: cambiar el general después no lo pisa.
 */
export const renglonDePromocionNuevo = (prod, general) => ({
    erp_product_id: prod.id,
    producto: prod.nombre,
    laboratorio: prod.laboratorio_nombre || 'Sin laboratorio',
    factor_unidades: null,
    inicio: general.inicio,
    fin: general.fin,
    lote_total: general.lote_total,
    tiene_bono: general.tiene_bono,
    paga: general.paga,
    supplier_id: general.supplier_id,
    bono_vendedor: general.bono_vendedor,
    bono_adm: general.bono_adm,
    bono_bodega: general.bono_bodega,
    unidades_por_bono: general.unidades_por_bono,
    salas: { ...(general.salas || {}) },
    reparto: { ...(general.reparto || {}) },
    confirmado: true,
    ajustado: false,
});

/**
 * Los renglones con la forma que espera `crear_promocion`. Vacío viaja como
 * vacío y no como cero (la base distingue «no se sabe» de «cero»); una fila de
 * reparto POR SALA MARCADA, con sus unidades o 0 («aplica acá, sin lote»).
 */
export const renglonesParaCrear = (renglones) => (renglones || []).map((r) => ({
    erp_product_id: r.erp_product_id,
    factor_unidades: r.factor_unidades,
    inicio: r.inicio,
    fin: r.fin,
    lote_total: r.lote_total === '' ? null : numeroEscrito(r.lote_total),
    tiene_bono: !!r.tiene_bono,
    paga: r.tiene_bono ? r.paga : null,
    supplier_id: r.tiene_bono && r.paga === 'proveedor'
        ? (r.supplier_id === '' ? null : Number(r.supplier_id))
        : null,
    bono_vendedor: r.tiene_bono ? numeroEscrito(r.bono_vendedor) ?? 0 : 0,
    bono_adm: r.tiene_bono ? numeroEscrito(r.bono_adm) ?? 0 : 0,
    bono_bodega: r.tiene_bono ? numeroEscrito(r.bono_bodega) ?? 0 : 0,
    unidades_por_bono: numeroEscrito(r.unidades_por_bono) || 1,
    reparto: Object.entries(r.salas || {})
        .filter(([, marcada]) => marcada)
        .map(([branch_id]) => ({
            branch_id: Number(branch_id),
            unidades: numeroEscrito(r.reparto?.[branch_id]) || 0,
        })),
}));

/**
 * A qué sala va el descuento de la promoción. El sistema de ventas admite UN
 * descuento por producto y ventana en toda la cadena: con una sala marcada va
 * ahí; con ninguna, a todas; con varias, lo que se eligió en el bloque.
 * `marcadas` es `{ [branchId]: true }`.
 */
export function destinoDelDescuento(salas, marcadas, desc) {
    const elegidas = (salas || []).filter((x) => marcadas?.[x.id]);
    const unaSola = elegidas.length === 1 ? elegidas[0] : null;
    const todas = unaSola ? false : (elegidas.length === 0 ? true : !!desc?.todas);
    const branchId = unaSola
        ? unaSola.id
        : (todas ? (salas?.[0]?.id ?? null) : Number(desc?.branchId) || null);
    return { todas_las_salas: todas, branch_id: branchId };
}

/**
 * Los productos que se AGREGAN a una promoción que ya existe, con la forma de
 * `agregar_renglones_a_promocion`. Heredan la vigencia de la promoción (el
 * primer inicio y el último fin de sus renglones), sus salas en 0 («aplica
 * acá, sin lote») y el bono del primer renglón: es la misma campaña, y nacer en
 * $0 con «tiene bono» diría que paga algo cuando no paga nada.
 *
 * La ficha trae el NOMBRE del proveedor, no su id, así que se resuelve contra
 * la lista; si no da con uno, devuelve `{ error }` y no se escribe (la base lo
 * rechazaría con un mensaje que no dice nada).
 */
export function renglonesParaAgregar(promo, prods, proveedores = []) {
    const renglones = promo?.renglones ?? [];
    const inicio = renglones.map((x) => x.inicio).filter(Boolean).sort()[0] || promo?.inicio;
    const fines = renglones.map((x) => x.fin).filter(Boolean).sort();
    const fin = fines[fines.length - 1] || promo?.fin || null;
    const reparto = (promo?.salas ?? []).map((b) => ({ branch_id: Number(b), unidades: 0 }));
    const modelo = renglones[0] ?? {};
    const pagaProveedor = modelo.tiene_bono && (modelo.paga || 'proveedor') === 'proveedor';
    const proveedorId = pagaProveedor ? (proveedores.find((x) => x.label === modelo.proveedor)?.value ?? null) : null;
    if (pagaProveedor && proveedorId == null) {
        return { error: `No se pudo identificar al proveedor «${modelo.proveedor || 'sin nombre'}» del primer producto. Revisa ese producto y vuelve a agregar.` };
    }
    return {
        renglones: (prods || []).map((p) => ({
            erp_product_id: p.id,
            inicio,
            fin,
            lote_total: '',
            tiene_bono: modelo.tiene_bono ?? false,
            paga: modelo.tiene_bono ? (modelo.paga || 'proveedor') : null,
            supplier_id: proveedorId,
            bono_vendedor: modelo.tiene_bono ? (Number(modelo.bono_vendedor) || 0) : 0,
            bono_adm: modelo.tiene_bono ? (Number(modelo.bono_adm) || 0) : 0,
            bono_bodega: modelo.tiene_bono ? (Number(modelo.bono_bodega) || 0) : 0,
            unidades_por_bono: Number(modelo.unidades_por_bono) || 1,
            reparto,
        })),
    };
}

// ── Corregir un descuento (2026-10-09) ──────────────────────────────────────
// Lo que decide el formulario «Corregir descuento», escrito UNA vez para el
// portal (`DescuentoModal`) y la app (`descuento/[id]`): cómo se lee el que
// viene de la base, qué impide guardar y qué se manda.

/** Los dos tipos, dichos como los aplica la venta: el monto es POR UNIDAD. */
export const TIPOS_DE_DESCUENTO = [
    { value: '%', label: 'Porcentaje del renglón' },
    { value: '$', label: 'Monto por cada unidad' },
];

/** El formulario a partir del descuento leído de la base (o vacío). */
export function formaDeDescuento(d, hoy) {
    if (!d) return { descripcion: '', tipo: '%', monto: '', inicio: hoy, fin: '', todas: true, branchId: '', productos: [] };
    return {
        descripcion: d.descripcion || '',
        tipo: d.tipo === '$' ? '$' : '%',
        monto: d.monto ? String(d.monto) : '',
        inicio: d.inicio || hoy,
        fin: d.fin || '',
        todas: d.todas_las_salas === true,
        branchId: d.branch_id ? String(d.branch_id) : '',
        productos: d.productos || [],
    };
}

/** Lo que impide guardar, dicho antes de intentarlo (en orden: el primero es el que se muestra). */
export function problemasAlCorregirDescuento(f, alcanceTodo) {
    const monto = Number(f.monto);
    const l = [];
    if (!String(f.descripcion ?? '').trim()) l.push('Ponle un nombre al descuento.');
    if (!Number.isFinite(monto) || monto <= 0) l.push('El descuento tiene que ser mayor que cero.');
    if (f.tipo === '%' && monto > 100) l.push('Un porcentaje no puede pasar de 100.');
    if (!f.fin) l.push('Falta la fecha de fin.');
    if (f.inicio && f.fin && f.fin < f.inicio) l.push('La fecha de fin es anterior a la de inicio.');
    if (!(f.productos || []).length) l.push('Agrega al menos un producto.');
    if (alcanceTodo && !f.todas && !f.branchId) l.push('Elige la sala.');
    return l;
}

/** Lo que se le manda a `guardarDescuento`. `salaPorDefecto`: la primera sala de venta (para «todas»). */
export function payloadDeDescuento(f, { id = 0, salaPorDefecto = null, forzar = false } = {}) {
    return {
        id: Number(id) > 0 ? Number(id) : 0,
        descripcion: String(f.descripcion).trim(),
        tipo: f.tipo,
        monto: Number(f.monto),
        inicio: f.inicio,
        fin: f.fin,
        todas_las_salas: !!f.todas,
        branch_id: f.todas ? salaPorDefecto : Number(f.branchId),
        productos: (f.productos || []).map((p) => p.id),
        forzar: forzar === true,
    };
}

/** En cuánto queda un producto: precio → queda, costo con IVA, si cae bajo el costo y cuánto pierde por unidad. */
export function cuentaDelProducto(datos, tipo, monto) {
    const precio = Number(datos?.precio) || 0;
    const costo = Number(datos?.costo_con_iva) || 0;
    const queda = precio ? precioConDescuento(precio, tipo, monto) : null;
    const bajoCosto = queda !== null && costo > 0 && queda < costo;
    return { precio, costo, queda, bajoCosto, pierde: bajoCosto ? costo - queda : 0 };
}

/* Los descuentos en sus tres secciones, en la dirección que sirve: los que
   descuentan hoy y los terminados, por el que ACABA antes —lo que vence es lo
   urgente—; los programados, por el que EMPIEZA antes. El orden de las
   secciones es el de la atención (`SECCIONES_DE_DESCUENTOS`). */
export const SECCIONES_DE_DESCUENTOS = [
    { clave: 'activos', titulo: 'Descontando ahora', sub: 'bajan el precio hoy' },
    { clave: 'programados', titulo: 'Programados', sub: 'todavía no empiezan' },
    { clave: 'terminados', titulo: 'Terminados', sub: 'ya no tocan ningún precio' },
];
export function descuentosPorEstado(descuentos, hoy = hoySV()) {
    const g = { activos: [], programados: [], terminados: [] };
    for (const d of descuentos || []) g[estadoDescuento(d, hoy).clave].push(d);
    g.activos.sort((a, b) => String(a.fin).localeCompare(String(b.fin)));
    g.programados.sort((a, b) => String(a.inicio).localeCompare(String(b.inicio)));
    g.terminados.sort((a, b) => String(b.fin).localeCompare(String(a.fin)));
    return g;
}

/** La oferta de la app que nace de un descuento: la que ya tenía (con la foto nueva encima) o una nueva. */
export const ofertaDesdeDescuento = (d, foto, previa) => (previa
    ? { ...previa, ...foto, sin_receta: foto.sin_receta }
    : { ...foto, titulo: d.promocion || d.descripcion, promocion_id: null });

/** A quién le llega el resumen diario de una promoción (7:30 a. m.). Los íconos los pone cada pantalla. */
export const OPCIONES_RESUMEN_DIARIO = [
    { key: 'no', rotulo: 'Sin avisar', detalle: 'No manda resumen.' },
    { key: 'supervision', rotulo: 'Supervisión', detalle: 'Todas las salas.' },
    { key: 'salas', rotulo: 'Salas', detalle: 'Cada una, lo suyo.' },
];
export const resumenElegido = (valor, key) => (key === 'no' ? !valor?.supervision && !valor?.salas : !!valor?.[key]);
/** «Sin avisar» apaga los dos; los otros dos se prenden y apagan cada uno. */
export const alternarResumen = (valor, key) => (key === 'no'
    ? { supervision: false, salas: false }
    : { ...valor, [key]: !valor?.[key] });

/** El CSV de «quién vendió» una promoción (Seguimiento). */
export function csvVendedoresDePromocion(vendedores, nombre) {
    return {
        headers: ['VENDEDOR', 'SALA', 'UNIDADES', 'DOCUMENTOS', 'BONO'],
        rows: (vendedores || []).map((v) => [v.nombre, v.sala || '', v.unidades, v.documentos, v.bono]),
        nombre: `promocion_${String(nombre || '').replace(/\W+/g, '_')}`,
    };
}

/** El CSV de la matriz de una promoción de laboratorio, sala por sala. */
export function csvMatrizDeLaboratorio(datos, promocionId) {
    const salas = Array.isArray(datos?.salas) ? datos.salas : [];
    return {
        headers: ['SALA', 'VENTA', 'NIVEL', 'PERSONAS', 'CADA PERSONA', 'COSTO', 'FALTA PARA EL SIGUIENTE'],
        rows: salas.map((x) => [x.sala, x.venta, x.nivel ?? '', x.personas, x.monto_por_persona, x.costo,
            x.siguiente_nivel != null ? x.falta : '']),
        nombre: `promocion_laboratorio_${String(datos?.nombre || promocionId).replace(/\W+/g, '_')}_${datos?.mes_medido || datos?.year_month || ''}`,
    };
}

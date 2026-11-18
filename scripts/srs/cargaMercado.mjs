// Carga de Datos de Mercado de la SRS (2026-11-18) — la conversión, sin red.
//
// La SRS cuenta por SU presentación (la caja, el dispensador, el frasco) y
// acepta decimales en la existencia: 40 tabletas de un dispensador de 100 son
// 0.4. El precio es el de esa presentación completa, con IVA: viñeta = precio a
// consumidor, descuento 1 = con descuento (lo confirmó el usuario el
// 2026-11-16).
//
// El portal guarda la existencia por presentación propia (inventory: «1x1»,
// «1x10», «1x100», cada una con su cantidad) y los precios por presentación
// (product_precios con su factor). El factor NO siempre está en tabletas: en
// LOSARTAN 50MG X 100 ECOMED el «1x1» es un blíster de 10 y el «1x10» la caja.
// Por eso el contenido de la unidad más chica sale de dos datos que se tienen
// que confirmar entre sí:
//
//   piezas del nombre (X 100) ÷ factor más grande (10) = 10 piezas por unidad.
//
// Si no dividen exacto, o el nombre no dice cuántas piezas trae y el factor más
// grande no coincide con la SRS, el producto NO se carga a ciegas: va a
// «revisar» con el motivo. Lo mismo si el volumen del portal y el de la SRS no
// coinciden.
import { analizarPortal } from './emparejarMercado.mjs';

const r2 = (n) => Math.round(n * 100) / 100;
const PRECIO_ALTO = 400;   // más que esto por presentación: casi siempre es una conversión mal leída

/** «1x10» → 10. */
export function factorDeDetalle(detalle) {
    const m = String(detalle ?? '').match(/^\s*\d+\s*[xX]\s*(\d+)\s*$/);
    return m ? Number(m[1]) : null;
}

// Lo que viene después de «X n» y NO es contar piezas: medidas, dosis de un
// aerosol, días de un tratamiento, unidades internacionales.
const MEDIDA = /^(ML|L|LT|LTS|CC|G|GR|GRS|GRAMOS|MG|MCG|UG|KG|OZ|ONZ|UI|U\.I|DOSIS|DIAS|DIA|CM|MM|M|MTS|YDS|YDAS|PIES|%|PUFF|PUFFS|DISPAROS|APLICACIONES|ATOMIZACIONES)$/;
const UNA_PIEZA = /^(1 |SOBRE|FRASCO|TUBO|AMPOLLA|VIAL|BOLSA|POTE|LATA|ENVASE|BOTELLA|TARRO|JERINGA|PARCHE|INHALADOR|CAJA X FRASCO|CAJA X 1 |CAJA PLEGADIZA X FRASCO|CAJA X TUBO|CAJA CON FRASCO|CAJA CON TUBO)/;
const limpio = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    .replace(/(\d),(?=\d{3}\b)/g, '$1');
const esMedida = (u) => !!u && MEDIDA.test(u.replace(/\.+$/, ''));

/** «X 120 ML», «X 35 G» de la presentación de la SRS (no la concentración «100mg/5mL»). */
export function volumenSrs(presentacion) {
    const m = limpio(presentacion).match(/\bX\s*(\d+(?:\.\d+)?)\s*(ML|L|LT|CC|G|GR|GRS)\b/);
    if (!m) return null;
    const n = Number(m[1]);
    return /^(ML|L|LT|CC)$/.test(m[2]) ? { n: /^(L|LT)$/.test(m[2]) ? n * 1000 : n, u: 'ML' } : { n, u: 'G' };
}

// Un envase que lleva adentro otras piezas: «X 24 SOBRES» cuenta sobres, no tabletas.
const CONTENEDOR = /^(SOB|SOBRE|SOBRES|SACHET|SACHETS|BLISTER|BLISTERES|BLISTERS|CARTERITA|CARTERITAS|TIRA|TIRAS|ESTUCHE|ESTUCHES|STICK|STICKS|STICKPACK|STICKPACKS)\.?$/;

/** Los niveles de la presentación de la SRS: «CAJA X 24 SOBRES X 2 TABLETAS» → [{24, SOBRES}, {2, TABLETAS}]. */
export function nivelesSrs(presentacion) {
    const pres = limpio(presentacion).replace(/\([^)]*\)/g, ' ').trim();
    const niveles = [];
    for (const m of pres.matchAll(/\bX\s*(\d+(?:\.\d+)?)\s*([A-Z%][A-Z.%]*)?/g)) {
        if (esMedida(m[2])) continue;
        const v = Number(m[1]);
        if (v > 0 && Number.isInteger(v)) niveles.push({ n: v, palabra: m[2] ?? '' });
    }
    return { niveles, unaPieza: UNA_PIEZA.test(pres) };
}

/** Piezas de la presentación de la SRS: «CAJA X 10 BLISTER X 10» → 100; «FRASCO X 200 DOSIS» → 1. */
export function piezasSrs(presentacion) {
    const { niveles, unaPieza } = nivelesSrs(presentacion);
    if (niveles.length) return niveles.reduce((p, x) => p * x.n, 1);
    return unaPieza ? 1 : null;
}

/** Hasta el primer envase: «CAJA X 24 SOBRES X 2» → 24. Sin envase, null. */
export function envasesSrs(presentacion) {
    const { niveles } = nivelesSrs(presentacion);
    let p = 1;
    for (const x of niveles) { p *= x.n; if (CONTENEDOR.test(x.palabra)) return p; }
    return null;
}

/** Lo que dice el nombre del portal: «X 30 TAB» → { n: 30 }; «X 24 SOBRES» → { n: 24, envase: true }; «X 200 DOSIS», «X 2.5 ML», «C/12» → null. */
export function cuentaPortal(nombre) {
    const t = limpio(nombre);
    for (const m of t.matchAll(/(?:^|[\s.])C?X\s*(\d+(?:\.\d+)?)\s*([A-Z%][A-Z.%]*)?/g)) {
        if (esMedida(m[2])) continue;
        const n = Number(m[1]);
        if (!Number.isInteger(n)) continue;
        return { n, envase: CONTENEDOR.test(m[2] ?? ''), palabra: m[2] ?? '' };
    }
    return null;
}
export const piezasPortal = (nombre) => cuentaPortal(nombre)?.n ?? null;

/**
 * Cuántas piezas trae la unidad más chica del portal y cuántas trae la
 * presentación de la SRS. Devuelve { porUnidad, srs, maxF } o { motivo }.
 */
export function contenidos(producto, pareja, precios) {
    const portal = analizarPortal(producto);
    const factores = precios.map(p => Number(p.factor)).filter(f => f > 0);
    if (!factores.length) return { motivo: 'sin_presentaciones' };
    const maxF = Math.max(...factores);

    // Volumen: el frasco o el tubo tienen que ser el mismo (cuando los dos lo
    // dicen en la misma medida; polvo en g contra suspensión en ml no se compara).
    const vs = volumenSrs(pareja.presentacion_srs);
    if (portal.volumen && vs && portal.volumen.u === vs.u && Math.abs(portal.volumen.n - vs.n) > 0.001) {
        return { motivo: 'volumen_distinto', detalle: `${portal.volumen.n} ${portal.volumen.u} contra ${vs.n} ${vs.u}` };
    }
    const total = piezasSrs(pareja.presentacion_srs);
    if (total == null) return { motivo: 'empaque_srs_desconocido' };
    const cuenta = cuentaPortal(producto?.nombre);
    // «ZUDENINA GEL X 30» (número suelto) es el tubo de 30 g, no 30 piezas.
    // «FOSKROL X 15 AMP» sí son 15, aunque cada vial sea de 15 ml.
    const nombre = cuenta && !(vs && !cuenta.palabra && cuenta.n === vs.n) ? cuenta.n : null;
    let srs = total;

    // 1) El nombre y el factor más grande se confirman entre sí.
    if (nombre != null && nombre % maxF === 0) {
        // El portal cuenta envases («X 24 SOBRES»): se compara contra los envases de la SRS.
        if (cuenta.envase) {
            srs = envasesSrs(pareja.presentacion_srs);
            if (srs == null) return { motivo: 'empaque_no_cuadra', detalle: `el portal cuenta ${nombre} envases y la SRS no dice cuántos trae` };
        }
        // Se vende sólo entero: el empaque del portal tiene que ser el de la SRS.
        if (maxF === 1 && nombre !== srs) return { motivo: 'empaque_no_cuadra', detalle: `el portal trae ${nombre} y la SRS ${srs}` };
        return { porUnidad: nombre / maxF, srs, maxF };
    }
    // 2) El dispensador: la presentación más grande del portal trae justo lo de
    // la SRS. Si el nombre cuenta sobres («X 25 SOBRES» de 4), tiene que caber
    // exacto en la SRS (25 × 4 = 100).
    if (maxF > 1 && total === maxF && (nombre == null || total % nombre === 0)) return { porUnidad: 1, srs: total, maxF };
    // 3) Se vende entero y ni el nombre ni la SRS dicen que traiga varias piezas.
    if (maxF === 1 && nombre == null && total === 1) return { porUnidad: 1, srs: total, maxF };
    return {
        motivo: 'empaque_no_cuadra',
        detalle: nombre != null ? `el nombre dice ${nombre}, la presentación más grande es 1x${maxF} y la SRS trae ${srs}`
            : `el nombre no dice cuántas trae, la presentación más grande es 1x${maxF} y la SRS trae ${srs}`,
    };
}

/**
 * Convierte un producto: existencia en la presentación de la SRS y precio de
 * esa presentación completa.
 *   inventario: filas de `inventory` de la sucursal ({ detalle, cantidad }).
 *   precios: filas activas de `product_precios` ({ factor, vineta, descuento_1, descripcion }).
 */
export function convertir({ producto, pareja, precios, inventario }) {
    const c = contenidos(producto, pareja, precios);
    if (c.motivo) return { ok: false, motivo: c.motivo, detalle: c.detalle };
    const avisos = [];

    // Existencia en unidades chicas del portal.
    let base = 0;
    for (const fila of inventario) {
        const f = factorDeDetalle(fila.detalle)
            ?? Number(precios.find(p => p.descripcion === fila.detalle)?.factor ?? NaN);
        if (!(f > 0)) return { ok: false, motivo: 'presentacion_desconocida', detalle: String(fila.detalle) };
        base += Number(fila.cantidad || 0) * f;
    }
    if (base < 0) { avisos.push('existencia_negativa'); base = 0; }

    const exacta = base * c.porUnidad / c.srs;
    let existencia = r2(exacta);
    if (exacta > 0 && existencia === 0) { existencia = 0.01; avisos.push('existencia_minima'); }

    // Precio: la presentación del portal que trae lo mismo que la de la SRS; si
    // no hay, la más grande en proporción.
    let fuente = precios.find(p => Number(p.factor) * c.porUnidad === c.srs && Number(p.vineta) > 0);
    let escala = 1;
    if (!fuente) {
        fuente = [...precios].filter(p => Number(p.vineta) > 0).sort((a, b) => Number(b.factor) - Number(a.factor))[0];
        if (!fuente) return { ok: false, motivo: 'sin_precio' };
        escala = c.srs / (Number(fuente.factor) * c.porUnidad);
        avisos.push('precio_proporcional');
    }
    const precio = r2(Number(fuente.vineta) * escala);
    let conDescuento = r2(Number(fuente.descuento_1 || 0) * escala);
    if (!(conDescuento > 0)) conDescuento = precio;
    if (conDescuento > precio) { conDescuento = precio; avisos.push('descuento_mayor'); }
    if (!(precio > 0)) return { ok: false, motivo: 'sin_precio' };
    if (precio > PRECIO_ALTO) return { ok: false, motivo: 'precio_alto', detalle: `$${precio} por ${c.srs} piezas` };

    return {
        ok: true, existencia, precio, conDescuento, avisos,
        conversion: { porUnidad: c.porUnidad, srs: c.srs, maxF: c.maxF, base, escala: r2(escala * 10000) / 10000, precioDe: fuente.descripcion },
    };
}

/**
 * El plan de una farmacia.
 *   pares: confirmadas ({ product_id, crp, nombre_srs, presentacion_srs, laboratorio_srs, producto: { nombre, principio_activo, laboratorio } })
 *   precios: Map product_id → filas activas
 *   inventario: Map product_id → filas de la sucursal
 *   precargados: [{ crp, nombre, presentacion, existencias, precio, conDescuento }] lo que la SRS ya tiene
 *
 * Reglas (2026-11-16, usuario): se declara lo que se vende; lo precargado que
 * ya no vendemos se borra; lo nuestro que falta se agrega. «Lo que vendemos»
 * = pareja confirmada con existencia hoy. Una pareja confirmada que ya estaba
 * precargada se deja (se guarda con existencia 0): la vendemos aunque hoy no
 * haya.
 */
export function armarPlan({ pares, precios, inventario, precargados, pendientes = [] }) {
    const precargado = new Map(precargados.map(p => [p.crp, p]));
    const porCrp = new Map();
    const revisar = [];

    for (const par of pares) {
        const inv = inventario.get(par.product_id) ?? [];
        const r = convertir({ producto: par.producto, pareja: par, precios: precios.get(par.product_id) ?? [], inventario: inv });
        const tieneExistencia = inv.some(f => Number(f.cantidad) > 0);
        if (!r.ok) {
            // Sin existencia y sin precargar no se iba a declarar: no estorba.
            if (tieneExistencia || precargado.has(par.crp)) revisar.push({ product_id: par.product_id, nombre: par.producto.nombre, crp: par.crp, srs: `${par.nombre_srs} · ${par.presentacion_srs}`, motivo: r.motivo, detalle: r.detalle ?? null });
            continue;
        }
        if (!porCrp.has(par.crp)) porCrp.set(par.crp, []);
        porCrp.get(par.crp).push({ par, r });
    }

    const guardar = []; const agregar = [];
    for (const [crp, lista] of porCrp) {
        // Dos productos del portal con la misma pareja (el blíster y la caja):
        // se suman las existencias y manda el precio del que más hay.
        const existencia = r2(lista.reduce((s, x) => s + x.r.existencia, 0));
        const guia = [...lista].sort((a, b) => b.r.existencia - a.r.existencia)[0];
        const avisos = new Set(lista.flatMap(x => x.r.avisos));
        if (lista.length > 1) {
            avisos.add('varios_productos');
            const ps = lista.map(x => x.r.precio);
            if (Math.max(...ps) > Math.min(...ps) * 1.02) avisos.add('precios_distintos');
        }
        const fila = {
            crp, existencia, precio: guia.r.precio, conDescuento: guia.r.conDescuento,
            srs: `${guia.par.nombre_srs} · ${guia.par.presentacion_srs}`,
            productos: lista.map(x => ({ product_id: x.par.product_id, nombre: x.par.producto.nombre, existencia: x.r.existencia, precio: x.r.precio, conversion: x.r.conversion })),
            avisos: [...avisos],
        };
        if (precargado.has(crp)) {
            const antes = precargado.get(crp);
            fila.antes = { existencias: antes.existencias, precio: antes.precio, conDescuento: antes.conDescuento };
            guardar.push(fila);
        } else if (existencia > 0) {
            agregar.push(fila);
        }
    }

    const nuestros = new Set(pares.map(p => p.crp));
    const enRevision = new Set([...revisar.map(r => r.crp), ...pendientes]);
    // Se borra lo precargado que no es nuestro. Lo nuestro en revisión, y la
    // pareja propuesta de lo que falta confirmar, NO se borra: se deja como
    // está hasta resolverlo.
    const eliminar = precargados.filter(p => !nuestros.has(p.crp) && !enRevision.has(p.crp))
        .map(p => ({ crp: p.crp, srs: `${p.nombre} · ${p.presentacion}` }));

    return { guardar, agregar, eliminar, revisar };
}

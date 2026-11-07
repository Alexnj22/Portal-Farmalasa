/**
 * ¿Cambió la presentación del producto, o la factura sólo cuenta en otra unidad?
 * (2026-11-07)
 *
 * La factura dice «caja de 40» contando TABLETAS, y Bodega cuenta en su propia
 * unidad: VALPAKINE en blísteres (CAJA = 4), COMBINATER en cajas (CAJA = 1).
 * Comparar el 40 contra las presentaciones daba una alarma falsa en 75 de 77
 * productos de las compras de octubre. Hay dos pruebas que sí miran lo mismo:
 *
 *  1. EL NOMBRE. «VALPAKINE 500MG X 40 TABLETAS» ya dice que su caja trae 40.
 *  2. EL COSTO. Si se carga como Bodega lo cuenta y la unidad cuesta lo mismo
 *     que antes, la caja es la misma. Si la caja de 20 ahora trae 30 y se carga
 *     como la de 20, la unidad sube justo 30 ÷ 20 = +50 %: eso es un cambio.
 *
 * El costo manda sobre el nombre cuando hay con qué comparar; sin costo
 * anterior, decide el nombre. Pura: la usan la pantalla y las pruebas
 * (`tests/unit/presentacionDeCompra.test.js`).
 */

const MEDIDA = String.raw`(?!\s*(?:\.\d|ML|CC|L|LT|LTS|G|GR|GRS|MG|MCG|KG|OZ|%|UI)\b)`;

/** Los «X <n>» del nombre que no son una medida: «X 30 TABLETAS» → [30]. */
export const tamanosDelNombre = (nombre) =>
    [...String(nombre ?? '').matchAll(new RegExp(String.raw`\bX\s*(\d{1,3})\b` + MEDIDA, 'gi'))]
        .map(m => Number(m[1]));

/** Igual que antes: ±10 % (descuentos, bonificaciones, redondeo). */
export const TOLERANCIA_IGUAL = 0.10;
/** El salto «cuadra» con el tamaño si queda a ±8 % de la proporción. */
export const TOLERANCIA_PROPORCION = 0.08;

/**
 * El costo de UNA unidad de inventario antes de esta compra: el de la
 * presentación de 1 si lo tiene; si no, el de la más chica con costo ÷ su tamaño.
 */
export function costoUnidadAntes(presentaciones) {
    const con = (presentaciones ?? [])
        .filter(x => Number(x.factor) > 0 && Number(x.costo) > 0)
        .sort((a, b) => a.factor - b.factor);
    if (!con.length) return null;
    return Number(con[0].costo) / Number(con[0].factor);
}

/**
 * @param {object} p
 * @param {number|null} p.tam           caja de la factura (`tamano_factura`)
 * @param {{factor:number, nombre?:string|null, costo?:number|null}[]} p.presentaciones  las de Bodega
 * @param {string} p.nombre             nombre del producto
 * @param {number} p.factor             unidades de inventario por cada una de la factura, como se carga
 * @param {number|null} p.costoNuevoUnidad  costo de una unidad de inventario con esta carga
 * @param {number|null} p.costoAntesUnidad  el de antes (`costoUnidadAntes`)
 * @returns {{ aviso: null | 'cambio' | 'confirmado', motivo: string, tamanoBodega?: number, sube?: number }}
 *   `cambio`: la regla del nombre lo marca y el costo no lo desmiente.
 *   `confirmado`: el costo saltó justo en la proporción del tamaño.
 */
export function juzgarPresentacion({ tam, presentaciones, nombre, factor, costoNuevoUnidad, costoAntesUnidad }) {
    const pres = (presentaciones ?? []).filter(x => Number(x.factor) > 0);
    const f = Number(factor) || 1;
    if (!(tam > 1) || !pres.length) return { aviso: null, motivo: 'sin-tamano' };
    if (pres.some(x => Number(x.factor) === tam)) return { aviso: null, motivo: 'bodega-la-tiene' };

    const delNombre = tamanosDelNombre(nombre);
    // El tamaño de la caja de Bodega, en la misma unidad que la factura: el que
    // dice el nombre; si no lo dice y la unidad de Bodega es la suelta, el de la
    // presentación más grande.
    const unidadSuelta = pres.some(x => Number(x.factor) === 1 && /^UNIDAD\b/i.test(String(x.nombre ?? '').trim()));
    const mayor = Math.max(...pres.map(x => Number(x.factor)));
    const tamanoBodega = delNombre.length === 1 ? delNombre[0]
        : unidadSuelta && mayor > 1 ? mayor : null;

    // 1. El costo, si hay con qué comparar y la carga NO sigue ya el tamaño de
    //    la factura (cargar 30 sueltas de una caja de 30 cuesta igual que antes,
    //    y aun así falta crear la presentación).
    const n = Number(costoNuevoUnidad), a = Number(costoAntesUnidad);
    if (n > 0 && a > 0 && f !== tam) {
        const razon = n / a;
        if (Math.abs(razon - 1) <= TOLERANCIA_IGUAL) return { aviso: null, motivo: 'costo-igual' };
        if (tamanoBodega && tamanoBodega !== tam) {
            const esperada = tam / tamanoBodega;
            if (Math.abs(razon - esperada) / esperada <= TOLERANCIA_PROPORCION) {
                return { aviso: 'confirmado', motivo: 'costo-proporcional', tamanoBodega, sube: (razon - 1) * 100 };
            }
        }
        // El costo se movió pero no en la proporción del tamaño: subió el
        // precio. Eso lo avisa la revisión de costos; acá decide el nombre.
    }

    // 2. El nombre.
    if (delNombre.includes(tam)) return { aviso: null, motivo: 'nombre-lo-dice' };
    // «CAJA (1)»: la caja ES la unidad (COMBINATER). Salvo que el nombre diga
    // otro tamaño: «X 30» con factura de 60 sí cambió.
    const cajaEsLaUnidad = pres.some(x => Number(x.factor) === 1 && /^CAJA\b/i.test(String(x.nombre ?? '').trim()));
    if (cajaEsLaUnidad && delNombre.length === 0) return { aviso: null, motivo: 'caja-es-la-unidad' };
    return { aviso: 'cambio', motivo: 'nombre', tamanoBodega: tamanoBodega ?? undefined };
}

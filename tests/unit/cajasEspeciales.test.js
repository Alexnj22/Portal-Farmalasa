import { describe, it, expect } from 'vitest';
import { alcanceDeRecepcion, cajasDeRenglon, construirCajasEspeciales, renglonesDeCajasFaltantes, renglonesQueSalen } from '../../src/utils/cajasEspeciales';

// El ancla es el pedido #114 REAL —La Popular, finalizado el 2026-08-14 a las
// 12:24— que salió con 60 etiquetas E1…E60 para 5 cajas de Electrolit. Sus cuatro
// renglones con existencia, tal como quedaron en `pedido_items`:
//
//   ELECTROLIT COCO 625ML       24 unid.  factor 12  → 2 cajas
//   ELECTROLIT FRESA 625ML      12 unid.  factor 12  → 1
//   ELECTROLIT MARACUYA 625 ML  12 unid.  factor 12  → 1
//   ELECTROLIT UVA 625ML        12 unid.  factor 12  → 1
//   ELECTROLIT FRESA KIWI       0 unid.   factor 12  → 0  (no viaja)
//
// El contador de Electrolit del mismo pedido ya decía 5. O sea que los dos
// números salen del mismo hecho físico y tienen que coincidir siempre: es lo que
// estos tests sostienen.
const P114 = [
    { id: 75626, erp_product_id: 2805, caja_especial: true, cantidad_asignada: 24, dispatch_factor: 12, products: { nombre: 'ELECTROLIT COCO 625ML' } },
    { id: 75657, erp_product_id: 2806, caja_especial: true, cantidad_asignada: 12, dispatch_factor: 12, products: { nombre: 'ELECTROLIT FRESA 625ML' } },
    { id: 75640, erp_product_id: 2811, caja_especial: true, cantidad_asignada: 12, dispatch_factor: 12, products: { nombre: 'ELECTROLIT MARACUYA 625 ML' } },
    { id: 75670, erp_product_id: 2818, caja_especial: true, cantidad_asignada: 12, dispatch_factor: 12, products: { nombre: 'ELECTROLIT UVA 625ML' } },
    { id: 75699, erp_product_id: 2807, caja_especial: true, cantidad_asignada: 0,  dispatch_factor: 12, products: { nombre: 'ELECTROLIT FRESA KIWI 625ML' } },
];

describe('cajasDeRenglon', () => {
    it('una caja de 12 es UNA caja, no doce', () => {
        expect(cajasDeRenglon({ cantidad_asignada: 12, dispatch_factor: 12 })).toBe(1);
        expect(cajasDeRenglon({ cantidad_asignada: 24, dispatch_factor: 12 })).toBe(2);
    });

    it('lo que se despacha por unidad no cambia — andaderas, bastones, sillas', () => {
        expect(cajasDeRenglon({ cantidad_asignada: 1, dispatch_factor: 1 })).toBe(1);
        expect(cajasDeRenglon({ cantidad_asignada: 3, dispatch_factor: 1 })).toBe(3);
    });

    it('sin unidades asignadas no hay caja', () => {
        expect(cajasDeRenglon({ cantidad_asignada: 0, dispatch_factor: 12 })).toBe(0);
        expect(cajasDeRenglon({})).toBe(0);
    });

    it('una caja a medio llenar sigue siendo una caja', () => {
        expect(cajasDeRenglon({ cantidad_asignada: 6, dispatch_factor: 12 })).toBe(1);
        expect(cajasDeRenglon({ cantidad_asignada: 13, dispatch_factor: 12 })).toBe(2);
    });

    it('sin factor cae a 1 en vez de dividir por cero', () => {
        expect(cajasDeRenglon({ cantidad_asignada: 5, dispatch_factor: 0 })).toBe(5);
        expect(cajasDeRenglon({ cantidad_asignada: 5 })).toBe(5);
    });
});

describe('construirCajasEspeciales', () => {
    it('el pedido #114 son 5 cajas, no 60', () => {
        expect(construirCajasEspeciales(P114)).toHaveLength(5);
    });

    it('numera E1…En en orden de producto, y las dos cajas del mismo renglón van juntas', () => {
        expect(construirCajasEspeciales(P114).map(c => `${c.label} ${c.product_name}`)).toEqual([
            'E1 ELECTROLIT COCO 625ML',
            'E2 ELECTROLIT COCO 625ML',
            'E3 ELECTROLIT FRESA 625ML',
            'E4 ELECTROLIT MARACUYA 625 ML',
            'E5 ELECTROLIT UVA 625ML',
        ]);
    });

    it('cada caja sabe de qué renglón salió — es lo que liga la etiqueta con la recepción', () => {
        const cajas = construirCajasEspeciales(P114);
        expect(cajas[0].pedido_item_id).toBe(75626);
        expect(cajas[1].pedido_item_id).toBe(75626);
        expect(cajas[2].pedido_item_id).toBe(75657);
    });

    it('deja fuera lo que no viaja: sin marca de especial, o sin unidades', () => {
        expect(construirCajasEspeciales([
            { id: 1, caja_especial: false, cantidad_asignada: 24, dispatch_factor: 12, products: { nombre: 'ALGO' } },
            { id: 2, caja_especial: true,  cantidad_asignada: 0,  dispatch_factor: 12, products: { nombre: 'OTRO' } },
        ])).toEqual([]);
    });

    it('sin renglones no explota', () => {
        expect(construirCajasEspeciales([])).toEqual([]);
        expect(construirCajasEspeciales(null)).toEqual([]);
    });

    it('el total de cajas especiales coincide con el contador de Electrolit del mismo pedido', () => {
        const porContador = P114.reduce((s, r) => s + cajasDeRenglon(r), 0);
        expect(construirCajasEspeciales(P114)).toHaveLength(porContador);
        expect(porContador).toBe(5);
    });
});

// ── Qué hay abierto en la pantalla de recepción ────────────────────────────
// El ancla es lo que se vio en La Popular el 2026-08-14: adentro de «E3 — Caja
// especial» (ELECTROLIT FRESA 625ML) la pantalla listaba LECHE NAN 2 OPTIPRO,
// LECHE NAN AR y LECHE NIDO 1 —los productos de las otras unidades— y ofrecía
// «Confirmar Caja null». La causa es esta pregunta contestada mirando sólo el
// número de la unidad abierta, que dentro de una especial vale null.
describe('alcanceDeRecepcion', () => {
    it('una caja especial abierta es "especial", aunque no haya número de hoja', () => {
        expect(alcanceDeRecepcion({ especial: { label: 'E3' }, hoja: null, hayHojas: true })).toBe('especial');
    });

    it('la especial gana aunque quede un número de hoja de la pantalla anterior', () => {
        expect(alcanceDeRecepcion({ especial: { label: 'E1' }, hoja: 2, hayHojas: true })).toBe('especial');
    });

    it('una hoja abierta es "hoja" — incluida la hoja 0, que es un número', () => {
        expect(alcanceDeRecepcion({ especial: null, hoja: 3, hayHojas: true })).toBe('hoja');
        expect(alcanceDeRecepcion({ especial: null, hoja: 0, hayHojas: true })).toBe('hoja');
    });

    it('sin nada abierto, o en un despacho sin hojas, es el pedido entero', () => {
        expect(alcanceDeRecepcion({ especial: null, hoja: null, hayHojas: true })).toBe('pedido');
        expect(alcanceDeRecepcion({ especial: null, hoja: 4, hayHojas: false })).toBe('pedido');
        expect(alcanceDeRecepcion()).toBe('pedido');
    });
});

// ── De la etiqueta reportada al renglón que se bloquea ─────────────────────
// El ancla es el pedido #178 REAL —Salud 4, código 07-160926-3-S4, llegada
// confirmada el 17-sep-2026 a las 09:07— tal como quedó `cajas_especiales` en la
// base. La sala reportó «E2 faltante» y el portal marcó ELECTROLIT COCO, que sí
// había llegado, porque la pantalla reconstruía el mapa contando una etiqueta
// por UNIDAD (12 por caja) sobre los renglones vivos: E1…E12 caían todas en el
// primer producto y E2 aterrizaba en COCO. El que de verdad faltaba —MANZANA,
// que bodega despachó en 0 de 12— quedó sin marcar y sin que nadie lo persiguiera.
const P178_S4 = [
    { label: 'E1', pedido_item_id: 105088, erp_product_id: 2805, product_name: 'ELECTROLIT COCO 625ML' },
    { label: 'E2', pedido_item_id: 104956, erp_product_id: 2810, product_name: 'ELECTROLIT MANZANA 625ML' },
    { label: 'E3', pedido_item_id: 105104, erp_product_id: 2818, product_name: 'ELECTROLIT UVA 625ML' },
];

describe('renglonesDeCajasFaltantes', () => {
    it('el pedido #178: «E2 faltante» es MANZANA, no COCO', () => {
        const { ids, huerfanas } = renglonesDeCajasFaltantes(P178_S4, { E1: 'ok', E2: 'faltante', E3: 'ok' });
        expect(ids).toEqual([104956]);
        expect(ids).not.toContain(105088);
        expect(huerfanas).toEqual([]);
    });

    it('la etiqueta manda aunque el renglón ya no esté entre los vivos', () => {
        // COCO quedó `pendiente` y UVA `recibido`: la lista guardada no cambia,
        // y es la única que sabe qué caja se imprimió con qué letra.
        const { ids } = renglonesDeCajasFaltantes(P178_S4, { E1: 'ok', E2: 'ok', E3: 'faltante' });
        expect(ids).toEqual([105104]);
    });

    it('sin faltantes no bloquea ningún renglón', () => {
        expect(renglonesDeCajasFaltantes(P178_S4, { E1: 'ok', E2: 'ok', E3: 'ok' })).toEqual({ ids: [], huerfanas: [] });
        expect(renglonesDeCajasFaltantes(P178_S4, {})).toEqual({ ids: [], huerfanas: [] });
        expect(renglonesDeCajasFaltantes(P178_S4, null)).toEqual({ ids: [], huerfanas: [] });
    });

    it('varias faltantes bloquean varios renglones', () => {
        const { ids } = renglonesDeCajasFaltantes(P178_S4, { E1: 'faltante', E2: 'faltante', E3: 'ok' });
        expect(ids.sort()).toEqual([104956, 105088]);
    });

    it('dos cajas del MISMO renglón bloquean ese renglón una sola vez', () => {
        // El #114: COCO viaja en E1 y E2, las dos del renglón 75626.
        const cajas = construirCajasEspeciales(P114);
        const { ids } = renglonesDeCajasFaltantes(cajas, { E1: 'faltante', E2: 'faltante' });
        expect(ids).toEqual([75626]);
    });

    it('la etiqueta sin dueño se DENUNCIA, no se saltea en silencio', () => {
        const { ids, huerfanas } = renglonesDeCajasFaltantes(P178_S4, { E7: 'faltante' });
        expect(ids).toEqual([]);
        expect(huerfanas).toEqual(['E7']);
    });

    it('es la inversa exacta de construirCajasEspeciales, caja por caja', () => {
        const cajas = construirCajasEspeciales(P114);
        for (const caja of cajas) {
            const { ids, huerfanas } = renglonesDeCajasFaltantes(cajas, { [caja.label]: 'faltante' });
            expect(huerfanas).toEqual([]);
            expect(ids).toEqual([caja.pedido_item_id]);
        }
    });

    it('sin lista guardada, toda etiqueta reportada queda huérfana — nunca marca de más', () => {
        expect(renglonesDeCajasFaltantes([], { E1: 'faltante' })).toEqual({ ids: [], huerfanas: ['E1'] });
        expect(renglonesDeCajasFaltantes(null, { E1: 'faltante' })).toEqual({ ids: [], huerfanas: ['E1'] });
    });
});

// ── Lo que de verdad sale ──────────────────────────────────────────────────
// El otro extremo del pedido #178 de Salud 4: ELECTROLIT MANZANA 625ML tenía 12
// unidades asignadas y quien despachó anotó 0 enviadas. La lista de cajas
// especiales se armó igual sobre lo ASIGNADO, así que la sala recibió una
// pantalla que le preguntaba por «E2» —una caja que nunca viajó— y la reportó
// faltante. Tenía razón; la caja no debió existir.
describe('renglonesQueSalen', () => {
    it('el pedido #178: el renglón despachado en 0 deja de contar como caja', () => {
        const rows = [
            { id: 105088, caja_especial: true, cantidad_asignada: 12, dispatch_factor: 12, products: { nombre: 'ELECTROLIT COCO 625ML' } },
            { id: 104956, caja_especial: true, cantidad_asignada: 12, dispatch_factor: 12, products: { nombre: 'ELECTROLIT MANZANA 625ML' } },
            { id: 105104, caja_especial: true, cantidad_asignada: 12, dispatch_factor: 12, products: { nombre: 'ELECTROLIT UVA 625ML' } },
        ];
        const cajas = construirCajasEspeciales(renglonesQueSalen(rows, [
            { pedido_item_id: 104956, cantidad_enviada: 0, motivo: null },
        ]));
        expect(cajas.map(c => `${c.label} ${c.product_name}`)).toEqual([
            'E1 ELECTROLIT COCO 625ML',
            'E2 ELECTROLIT UVA 625ML',
        ]);
        expect(cajas.some(c => c.product_name.includes('MANZANA'))).toBe(false);
    });

    it('sin ajustes devuelve los renglones tal cual — lo normal es que salga lo asignado', () => {
        expect(renglonesQueSalen(P114, [])).toEqual(P114);
        expect(renglonesQueSalen(P114)).toEqual(P114);
        expect(construirCajasEspeciales(renglonesQueSalen(P114, []))).toHaveLength(5);
    });

    it('un envío corto baja las cajas, no las borra', () => {
        // COCO iba en 2 cajas (24 unid.) y salió 1 (12 unid.).
        const salen = renglonesQueSalen(P114, [{ pedido_item_id: 75626, cantidad_enviada: 12 }]);
        expect(construirCajasEspeciales(salen).map(c => `${c.label} ${c.product_name}`)).toEqual([
            'E1 ELECTROLIT COCO 625ML',
            'E2 ELECTROLIT FRESA 625ML',
            'E3 ELECTROLIT MARACUYA 625 ML',
            'E4 ELECTROLIT UVA 625ML',
        ]);
    });

    it('no toca el renglón original — el ajuste no se escribe encima de lo asignado', () => {
        const rows = [{ id: 1, caja_especial: true, cantidad_asignada: 24, dispatch_factor: 12, products: { nombre: 'X' } }];
        renglonesQueSalen(rows, [{ pedido_item_id: 1, cantidad_enviada: 0 }]);
        expect(rows[0].cantidad_asignada).toBe(24);
    });

    it('un ajuste de un renglón que no está no inventa filas', () => {
        expect(renglonesQueSalen(P114, [{ pedido_item_id: 999999, cantidad_enviada: 0 }])).toHaveLength(P114.length);
    });

    it('un ajuste sin cantidad usable se ignora en vez de poner NaN cajas', () => {
        const salen = renglonesQueSalen(P114, [{ pedido_item_id: 75626, cantidad_enviada: null }]);
        expect(construirCajasEspeciales(salen)).toHaveLength(5);
    });

    it('sin renglones no explota', () => {
        expect(renglonesQueSalen([], [{ pedido_item_id: 1, cantidad_enviada: 0 }])).toEqual([]);
        expect(renglonesQueSalen(null, [])).toEqual([]);
    });
});

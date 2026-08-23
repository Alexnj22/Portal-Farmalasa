import { describe, it, expect } from 'vitest';
import {
    existenciasDelReporte,
    lecturaDelReporte,
    apartadoQueEstorba,
    disponibleEnBodega,
} from '../../supabase/functions/_shared/erp-traslado.ts';
import real from './fixtures/inventario-bodega-2026-08-19.json';

// Cuánto hay DE VERDAD en el área de trabajo antes de despachar.
//
// **Estas pruebas existen porque el freno del despacho estaba leyendo el número
// equivocado.** La casilla de la pantalla de traslado está rotulada por el
// propio sistema «TOTAL STOCK» y es el total de la SUCURSAL —el área de trabajo
// más la de vencidos—, ignorando la ubicación que se le pide. Con eso, el freno
// aprobaba despachar mercadería apartada en vencidos, el sistema lo rechazaba
// con «No hay suficiente stock en las ubicaciones» y el renglón quedaba en
// error para que alguien lo resolviera a mano.
//
// El fixture NO está inventado: es el `reporte_inventario_json.php` real de
// Bodega del 2026-08-19 (áreas de trabajo y de vencidos) más, para los
// productos con lote controlado, **la suma de sus lotes tal como la lee el
// despacho** — que es la única cifra independiente del reporte y por eso sirve
// para comprobarlo.

const base = (payload) => existenciasDelReporte(payload);
const enTrabajo  = base(real.trabajo);
const enVencidos = base(real.vencidos);

describe('existenciasDelReporte — la cuenta contra el sistema', () => {
    // Es la trampa del reporte: da una fila por lote y por presentación, y su
    // `cantidad` va en PAQUETES. El factor lo trae `detalle` («1x5»). Sumar las
    // cantidades a secas mezcla escalas y da un número que no es nada.
    for (const [id, esperado] of Object.entries(real.suma_de_lotes_ubicacion_1)) {
        it(`producto ${id}: ${esperado} unidades, igual que la suma de sus lotes`, () => {
            expect(enTrabajo.get(Number(id))).toBe(esperado);
        });
    }

    // Y la razón de todo el cambio: la casilla es trabajo + vencidos.
    for (const [id, casilla] of Object.entries(real.casilla_total_stock)) {
        if (real.suma_de_lotes_ubicacion_1[id] != null) continue;   // con lotes la casilla es la del primero
        it(`producto ${id}: la casilla (${casilla}) es trabajo + vencidos`, () => {
            const t = enTrabajo.get(Number(id)) ?? 0;
            const v = enVencidos.get(Number(id)) ?? 0;
            expect(t + v).toBe(casilla);
        });
    }

    // BRONCOLEXIL es el caso que estaba esperando para romper: 3 en el estante
    // y 6 apartados en vencidos. El freno viejo habría aprobado despachar 9.
    it('BRONCOLEXIL: el estante tiene 3 aunque la casilla diga 9', () => {
        expect(enTrabajo.get(4839)).toBe(3);
        expect(enVencidos.get(4839)).toBe(6);
        expect(real.casilla_total_stock['4839']).toBe(9);
    });
});

describe('existenciasDelReporte — lo que no sabe, no lo inventa', () => {
    it('sin reporte devuelve null, no un mapa vacío', () => {
        expect(existenciasDelReporte(null)).toBeNull();
        expect(existenciasDelReporte({})).toBeNull();
        expect(existenciasDelReporte({ inventario: [] })).toBeNull();
        expect(existenciasDelReporte('no es json')).toBeNull();
    });

    it('un producto que no está en el reporte no está en el mapa', () => {
        expect(enTrabajo.get(999999)).toBeUndefined();
    });

    // 4,838 de 4,848 filas traen «1xN». Las 10 raras («1», «BOTE», «2X1») se
    // leen como factor 1: quedarse corto frena de más, y de más no despacha
    // producto que no está.
    it('un `detalle` que no es 1xN se cuenta como factor 1', () => {
        const m = existenciasDelReporte({ inventario: [
            { id_producto: '7', detalles: [
                { detalle: '1x5',  cantidad: 2 },
                { detalle: 'BOTE', cantidad: 3 },
                { detalle: '1',    cantidad: 4 },
            ] },
        ] });
        expect(m.get(7)).toBe(2 * 5 + 3 + 4);
    });

    it('una fila sin id o sin detalles no rompe la cuenta', () => {
        const m = existenciasDelReporte({ inventario: [
            { id_producto: '0',  detalles: [{ detalle: '1x1', cantidad: 9 }] },
            { id_producto: 'no', detalles: [{ detalle: '1x1', cantidad: 9 }] },
            { id_producto: '5' },
            { id_producto: '5',  detalles: [{ detalle: '1x2', cantidad: 3 }] },
        ] });
        expect(m.get(0)).toBeUndefined();
        expect(m.get(5)).toBe(6);
    });
});

describe('disponibleEnBodega — qué número usa', () => {
    const sinLote  = { regulado: false, lotes: [], existencia: 27, presentaciones: [], encontrado: true, vence: '' };
    const conLotes = { regulado: true, existencia: 10, presentaciones: [], encontrado: true, vence: '',
                       lotes: [{ id: '1', numero: 'A', vence: '', stock: 50 },
                               { id: '2', numero: 'B', vence: '', stock: 40 }] };

    it('sin control de lote manda el número de la ubicación, no la casilla', () => {
        expect(disponibleEnBodega(sinLote, 1, 26).paquetes).toBe(26);
        expect(disponibleEnBodega(sinLote, 1, 3).paquetes).toBe(3);
        expect(disponibleEnBodega(sinLote, 1, 0).paquetes).toBe(0);   // 0 es un dato, no «no sé»
    });

    it('si no se pudo leer la ubicación cae a la casilla, no se cierra', () => {
        expect(disponibleEnBodega(sinLote, 1, null).paquetes).toBe(27);
        expect(disponibleEnBodega(sinLote, 1).paquetes).toBe(27);
    });

    it('el factor sigue mandando: 26 unidades en cajas de 5 son 5 cajas', () => {
        expect(disponibleEnBodega(sinLote, 5, 26).paquetes).toBe(5);
        expect(disponibleEnBodega(sinLote, 5, 26).unidades).toBe(26);
    });

    // Con lotes la cuenta ya distinguía la ubicación (medido: el mismo producto
    // ofrece lotes distintos en cada área), así que ese camino no se toca.
    it('con lotes controlados el número de la ubicación no se usa', () => {
        expect(disponibleEnBodega(conLotes, 10, 3).paquetes).toBe(9);   // floor(50/10)+floor(40/10)
        expect(disponibleEnBodega(conLotes, 10, null).paquetes).toBe(9);
        expect(disponibleEnBodega(conLotes, 10, 3).lotes).toBe(2);
    });
});

// ── El área de vencidos manda sobre el estante ───────────────────────────────
//
// Medido contra el sistema el 2026-08-23 con el TERMOMETRO DIGITAL WELLPRO
// (1545), 26 en el estante y 1 apartado en el área de vencidos:
//
//   pedir 8 → «No hay suficiente stock en las ubicaciones» (nada escrito)
//   pedir 1 → entra, y la unidad sale del ÁREA DE VENCIDOS (queda en cero)
//   pedir 7, ya con vencidos vacío → entra, y sale del estante
//
// O sea: el sistema descarga primero de vencidos y NO pasa al estante en el
// mismo envío, e ignora el `origen` que se le manda —que es el del ESTANTE, y
// va explícito en el payload—. Antes de este freno el renglón se aprobaba,
// Bodega armaba la caja y el sistema la rechazaba: 8 termómetros llegaron a
// Salud 3 sin un movimiento en el sistema.
//
// El tope es CERO y no «lo apartado»: un pedido se calcula sin mirar esa área,
// así que llevarse de ahí —aunque el sistema lo acepte— es despachar como
// normal lo que Bodega separó por vencer.
describe('disponibleEnBodega — con algo apartado en vencidos no sale nada', () => {
    const sinLote = { regulado: false, lotes: [], existencia: 27, presentaciones: [], encontrado: true, vence: '' };
    const conLotes = { regulado: true, existencia: 10, presentaciones: [], encontrado: true, vence: '',
                       lotes: [{ id: '1', numero: 'A', vence: '', stock: 50 }] };

    // El tope es lo apartado: 1 pasa —y después se comprueba que el área de
    // vencidos no haya bajado—, 2 no, porque el sistema rechaza el envío entero
    // DESPUÉS de que Bodega armó la caja, y ahí la mercadería viaja sin
    // registrarse.
    it('el caso real: con 26 en el estante y 1 apartado, pasa 1 y no 2', () => {
        const hay = disponibleEnBodega(sinLote, 1, 26, 1);
        expect(hay.paquetes).toBe(1);
        expect(hay.desdeVencidos).toBe(1);   // cuántas hay apartadas, para poder decirlo
    });

    it('con el área de vencidos vacía el techo vuelve a ser el estante', () => {
        expect(disponibleEnBodega(sinLote, 1, 26, 0).paquetes).toBe(26);
        expect(disponibleEnBodega(sinLote, 1, 26, 0).desdeVencidos).toBe(0);
        expect(disponibleEnBodega(sinLote, 1, 26, null).paquetes).toBe(26);
    });

    // Nunca más de lo apartado (el sistema rechazaría) ni más de lo que hay en
    // el estante (no habría qué levantar).
    it('se toma el MENOR de los dos', () => {
        expect(disponibleEnBodega(sinLote, 1, 300, 1).paquetes).toBe(1);
        expect(disponibleEnBodega(sinLote, 1, 2, 300).paquetes).toBe(2);
    });

    // El factor se aplica DESPUÉS del tope: 3 apartadas en cajas de 5 no
    // completan ni una caja, así que no sale ninguna.
    it('el factor se aplica sobre el tope, no sobre el estante', () => {
        expect(disponibleEnBodega(sinLote, 5, 26, 3).paquetes).toBe(0);
        expect(disponibleEnBodega(sinLote, 5, 26, 3).unidades).toBe(3);
        expect(disponibleEnBodega(sinLote, 5, 26, 3).desdeVencidos).toBe(3);
    });

    // Con lote el portal NOMBRA de cuál descargar, así que el sistema no elige.
    // Medido el mismo día: el producto 2621, con 2 apartadas en vencidos,
    // despachó 3 en la misma corrida en que el termómetro fue rechazado.
    it('con control de lote el área de vencidos no achica nada', () => {
        expect(disponibleEnBodega(conLotes, 10, 3, 1).paquetes).toBe(5);
        expect(disponibleEnBodega(conLotes, 10, 3, 1).desdeVencidos).toBe(0);
    });
});

// ── Cuál de lo apartado puede salir por error ────────────────────────────────
//
// Auditado el 2026-08-23 sobre el mes entero: la ubicación SE RESPETA. Cuatro
// productos con mercadería apartada despacharon del estante sin tocarla —
// ALCOHOL 70 (1 apartada desde el 14-jul), ALCOHOL 90 (5 desde el 5-ago),
// BRONCOLEXIL (6, y comparte lote Y fecha con una fila del estante) y NEUROBION
// (28). El único que salió del área de vencidos fue el TERMOMETRO, cuyas dos
// filas son idénticas y SIN FECHA.
//
// Por eso el freno mira eso y no «hay algo apartado»: con lo segundo quedaban
// sin despachar 32 productos que llevaban meses saliendo bien.
describe('apartadoQueEstorba — sólo lo que no se puede distinguir', () => {
    const lectura = (filas) => lecturaDelReporte({ inventario: filas });
    const prod = (id, cantidad, fecha) => ({
        id_producto: String(id),
        detalles: [{ detalle: '1x1', cantidad, fecha_vencimiento: fecha }],
    });

    it('el caso real: las dos filas sin fecha, no se puede distinguir', () => {
        const estante  = lectura([prod(1545, 18, '0000-00-00')]);
        const vencidos = lectura([prod(1545, 1, '0000-00-00')]);
        expect(apartadoQueEstorba(estante, vencidos, 1545)).toBe(1);
    });

    it('con fecha en las dos, aunque sea la MISMA, no estorba (BRONCOLEXIL)', () => {
        const estante  = lectura([prod(4839, 1, '2028-03-01')]);
        const vencidos = lectura([prod(4839, 6, '2028-03-01')]);
        expect(apartadoQueEstorba(estante, vencidos, 4839)).toBe(0);
    });

    it('basta que UNA de las dos tenga fecha para distinguirlas', () => {
        expect(apartadoQueEstorba(lectura([prod(9, 5, '2027-04-30')]), lectura([prod(9, 1, null)]), 9)).toBe(0);
        expect(apartadoQueEstorba(lectura([prod(9, 5, null)]), lectura([prod(9, 1, '2028-04-01')]), 9)).toBe(0);
    });

    it('sin nada apartado no hay nada que frenar', () => {
        expect(apartadoQueEstorba(lectura([prod(9, 5, null)]), lectura([prod(8, 1, null)]), 9)).toBe(0);
    });

    // Una fila en cero no se confunde con nada: no hay de dónde descargar.
    it('una fila apartada en cero no estorba', () => {
        expect(apartadoQueEstorba(lectura([prod(9, 5, null)]), lectura([prod(9, 0, null)]), 9)).toBe(0);
    });

    // Sin lectura no se inventa un freno: el sistema sigue siendo la puerta, y
    // cerrar por una consulta secundaria dejaría de despachar por otra cosa.
    it('si no se pudo leer alguna ubicación, no frena', () => {
        expect(apartadoQueEstorba(null, lectura([prod(9, 1, null)]), 9)).toBe(0);
        expect(apartadoQueEstorba(lectura([prod(9, 5, null)]), null, 9)).toBe(0);
    });

    // Contra el reporte REAL de Bodega del 19-ago, que es de donde salió el caso.
    it('sobre el reporte real: el termómetro estorba y BRONCOLEXIL no', () => {
        const est = lecturaDelReporte(real.trabajo);
        const ven = lecturaDelReporte(real.vencidos);
        expect(apartadoQueEstorba(est, ven, 1545)).toBe(1);   // sin fecha las dos
        expect(apartadoQueEstorba(est, ven, 4839)).toBe(0);   // con fecha: se distinguen
    });

    it('«0000-00-00», vacío y nulo son la misma cosa: sin fecha', () => {
        for (const f of ['0000-00-00', '', null, undefined]) {
            expect(apartadoQueEstorba(lectura([prod(9, 5, f)]), lectura([prod(9, 2, f)]), 9)).toBe(2);
        }
    });
});

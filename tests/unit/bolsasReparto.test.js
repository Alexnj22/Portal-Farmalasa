import { describe, it, expect } from 'vitest';
import { disponibles, elegirBolsas, elegirOrigen, totalDisponible } from '../../src/utils/bolsasReparto';

// De qué bolsa sale el dinero. La regla del usuario es «la más vieja que
// alcance SOLA» — no vaciar la vieja primero, que es la respuesta intuitiva y
// no es la que él pidió: partir una remesa en dos bolsas deja dos papeles en dos
// bolsas y eso es lo que después hay que controlar con las manos.

const B = (id, folio, fecha, hora, saldo) => ({
    id, folio, fecha, hora, saldo, estado: 'ABIERTA', monto_inicial: saldo,
});

// Tres bolsas de una sala, de la más vieja a la más nueva.
const lista = [
    B(1, 'S3-1001', '2026-08-13', '19:01', 300),
    B(2, 'S3-1002', '2026-08-14', '12:49', 700),
    B(3, 'S3-1003', '2026-08-15', '19:01', 500),
];

describe('elegir de qué bolsa sale el dinero', () => {
    it('toma la más vieja que alcance sola, no la más vieja a secas', () => {
        // $500 no entran en la de $300 aunque sea la más vieja: la que alcanza
        // sola es la de $700.
        const r = elegirBolsas(lista, 500);
        expect(r.repartos).toEqual([{ bolsa_id: 2, folio: 'S3-1002', monto: 500 }]);
        expect(r.combinada).toBe(false);
    });

    it('cuando la más vieja alcanza, es esa', () => {
        expect(elegirBolsas(lista, 250).repartos).toEqual([
            { bolsa_id: 1, folio: 'S3-1001', monto: 250 },
        ]);
    });

    it('sólo combina cuando ninguna alcanza sola, y empieza por la más vieja', () => {
        // $900: no hay ninguna de $900. Se juntan 300 + 600.
        const r = elegirBolsas(lista, 900);
        expect(r.repartos).toEqual([
            { bolsa_id: 1, folio: 'S3-1001', monto: 300 },
            { bolsa_id: 2, folio: 'S3-1002', monto: 600 },
        ]);
        expect(r.combinada).toBe(true);
        expect(r.alcanza).toBe(true);
    });

    it('dice que NO alcanza en vez de devolver un reparto corto', () => {
        // Un reparto que no suma el total dejaría un vale por menos de lo que
        // se sacó, y el servidor lo rechaza. Mejor decirlo antes.
        const r = elegirBolsas(lista, 2000);
        expect(r.alcanza).toBe(false);
        expect(r.repartos).toEqual([]);
        expect(r.falta).toBe(500);
    });

    it('los centavos cierran exactos', () => {
        const centavitos = [B(1, 'A', '2026-08-13', '10:00', 0.1), B(2, 'B', '2026-08-14', '10:00', 0.2)];
        const r = elegirBolsas(centavitos, 0.3);
        expect(r.repartos.reduce((a, x) => a + x.monto, 0)).toBeCloseTo(0.3, 10);
        expect(r.alcanza).toBe(true);
    });

    it('sin monto o sin bolsas no elige nada', () => {
        expect(elegirBolsas(lista, 0).repartos).toEqual([]);
        expect(elegirBolsas([], 100).alcanza).toBe(false);
    });
});

describe('qué bolsas están disponibles', () => {
    it('sólo las que están en la sala y tienen saldo, de la más vieja primero', () => {
        const crudas = [
            { id: 3, folio: 'C', fecha: '2026-08-15', hora: '19:01', estado: 'ABIERTA', monto_inicial: 500 },
            { id: 1, folio: 'A', fecha: '2026-08-13', hora: '19:01', estado: 'ABIERTA', monto_inicial: 300 },
            { id: 2, folio: 'B', fecha: '2026-08-14', hora: '12:49', estado: 'ENTREGADA', monto_inicial: 700 },
            { id: 4, folio: 'D', fecha: '2026-08-15', hora: '20:00', estado: 'ABIERTA', monto_inicial: 100 },
        ];
        // La 4 quedó en cero porque ya salió todo su efectivo.
        const saldos = new Map([[1, { saldo: 300 }], [3, { saldo: 500 }], [4, { saldo: 0 }]]);
        expect(disponibles(crudas, saldos).map((b) => b.folio)).toEqual(['A', 'C']);
    });

    it('sin el mapa usa el saldo que la fila ya trae, no lo guardado', () => {
        // El caso real: la pantalla ya resolvió los saldos y se los pegó a cada
        // fila. Cayendo a `monto_inicial` ofrecería sacar plata que ya salió.
        const conSaldo = [{
            id: 1, folio: 'A', fecha: '2026-08-13', hora: '19:01',
            estado: 'ABIERTA', monto_inicial: 300, saldo: 100,
        }];
        expect(disponibles(conSaldo, null)[0].saldo).toBe(100);
        expect(elegirBolsas(disponibles(conSaldo, null), 200).alcanza).toBe(false);
    });

    it('el saldo manda sobre lo guardado: una bolsa con salidas vale menos', () => {
        const crudas = [{ id: 1, folio: 'A', fecha: '2026-08-13', hora: '19:01', estado: 'ABIERTA', monto_inicial: 300 }];
        const [b] = disponibles(crudas, new Map([[1, { saldo: 100 }]]));
        expect(b.saldo).toBe(100);
        expect(totalDisponible([b])).toBe(100);
    });
});

// ── El paso del motivo: las monedas se quedan en la bolsa ───────────────────
//
// Las cinco bolsas reales de La Popular del 28-ago-2026, que son las que el
// usuario tenía en pantalla cuando dictó la regla. Anclarlas con sus impares
// verdaderos importa: con saldos redondos inventados la regla no se distingue
// de no tenerla.
const laPopular = [
    B(145, 'LP-1144', '2026-08-26', '13:06', 373.85),
    B(148, 'LP-1147', '2026-08-26', '16:01', 563.07),
    B(150, 'LP-1149', '2026-08-26', '19:01', 211.91),
    B(160, 'LP-1159', '2026-08-27', '14:22', 941.40),
    B(162, 'LP-1161', '2026-08-27', '19:00', 376.02),
];

describe('cuando el motivo paga en billetes', () => {
    it('un monto redondo toma múltiplos del paso y deja el impar adentro', () => {
        const r = elegirBolsas(laPopular, 2000);
        expect(r.redondo).toBe(true);
        expect(r.repartos).toEqual([
            { bolsa_id: 145, folio: 'LP-1144', monto: 370 },
            { bolsa_id: 148, folio: 'LP-1147', monto: 560 },
            { bolsa_id: 150, folio: 'LP-1149', monto: 210 },
            { bolsa_id: 160, folio: 'LP-1159', monto: 860 },
        ]);
        // Ninguna bolsa queda en cero: cada una conserva sus monedas. Sin la
        // regla, tres viajaban vacías a administración.
        expect(r.repartos.every((x) => x.monto % 10 === 0)).toBe(true);
        expect(r.repartos.reduce((a, x) => a + x.monto, 0)).toBe(2000);
    });

    it('el techo baja: lo que hay en monedas no se puede pedir', () => {
        // $2,466.25 en la sala, pero sólo $2,450 en billetes de $10.
        expect(totalDisponible(laPopular)).toBeCloseTo(2466.25, 10);
        expect(elegirBolsas(laPopular, 2000).disponible).toBeCloseTo(2450, 10);
        const r = elegirBolsas(laPopular, 2460);
        expect(r.alcanza).toBe(false);
        expect(r.falta).toBeCloseTo(10, 10);
    });

    it('un monto con impar sale EXACTO y de una sola bolsa', () => {
        // «solo si la salida de dinero es 125.75 ahi si debe permitirlo y decir
        // de que bolsa sacarlo» (usuario, 2026-08-28). La regla la dispara el
        // monto, no el motivo: si la disparara el motivo, esto se rechazaría.
        const r = elegirBolsas(laPopular, 125.75);
        expect(r.redondo).toBe(false);
        expect(r.repartos).toEqual([{ bolsa_id: 145, folio: 'LP-1144', monto: 125.75 }]);
        expect(r.disponible).toBeCloseTo(2466.25, 10);
    });

    it('el paso sale del MONTO y ya no del motivo: $2,000 va en billetes de $10', () => {
        /* Antes esto probaba lo contrario —«sin paso el reparto es el de
         * siempre, monedas incluidas»— porque el paso era un campo por motivo y
         * sólo «Cambio por monedas» lo tenía. Se dio vuelta el 1-sep por regla
         * del usuario: vale para TODOS los vales, y el paso lo decide el monto.
         *
         * Lo destapó `REM-1058`: $500 repartidos en $55.82 + $324.80 + $119.38,
         * o sea monedas contadas a mano para completar un total redondo. */
        const r = elegirBolsas(laPopular, 2000);
        expect(r.redondo).toBe(true);
        for (const x of r.repartos) expect(Math.round(x.monto * 100) % 1000).toBe(0);
    });

    it('un monto múltiplo de 5 va en billetes de $5, no de $10', () => {
        // «si es 55 por ejemplo, salen 55 en múltiplos de 5 mínimo» (usuario).
        // Con paso 10, $55 no se podría cuadrar nunca — el paso tiene que
        // dividir al monto o la salida queda sin poder cerrar.
        const r = elegirBolsas(laPopular, 55);
        expect(r.redondo).toBe(true);
        expect(r.alcanza).toBe(true);
        for (const x of r.repartos) expect(Math.round(x.monto * 100) % 500).toBe(0);
    });

    it('un monto que no es múltiplo de 5 sale exacto', () => {
        // $7 es entero y no tiene paso: forzarlo dejaría la salida sin cuadrar.
        const r = elegirBolsas(laPopular, 7);
        expect(r.redondo).toBe(false);
        expect(r.repartos).toEqual([{ bolsa_id: 145, folio: 'LP-1144', monto: 7 }]);
    });

    it('la más vieja que alcance sola, medida en billetes y no en saldo', () => {
        // LP-1159 tiene $941.40 y LP-1147 $563.07. Para $560 la más vieja que
        // alcanza sola es LP-1147: $560 <= $560 redondeado. Para $570 ya no.
        expect(elegirBolsas(laPopular, 560).repartos)
            .toEqual([{ bolsa_id: 148, folio: 'LP-1147', monto: 560 }]);
        expect(elegirBolsas(laPopular, 570).repartos)
            .toEqual([{ bolsa_id: 160, folio: 'LP-1159', monto: 570 }]);
    });
});

/* ── La prioridad es el CAJÓN (regla del usuario, 2026-09-02) ───────────────
 *
 * Lo trajo OTR-1060 de Salud 3: $3.37 de un pago sacados de una bolsa del día
 * ANTERIOR con el cajón lleno de las ventas de la mañana. Antes de esto el
 * botón de Mi caja ni ofrecía el cajón mientras hubiera una bolsa abierta. */
describe('de dónde sale: el cajón primero', () => {
    const conCajon = (efectivoEnCaja, monto, puedeElCajon = true) =>
        elegirOrigen({ efectivoEnCaja, puedeElCajon, lista, monto });

    it('si el cajón tiene el efectivo, sale de ahí y no se toca ninguna bolsa', () => {
        const r = conCajon(120, 3.37);
        expect(r.origen).toBe('CAJA');
        expect(r.alcanza).toBe(true);
        // Sin repartos a propósito: no hay bolsa que abrir, así que tampoco hay
        // etiqueta nueva que anunciar.
        expect(r.repartos).toEqual([]);
    });

    it('si no alcanza en el cajón, sale de las bolsas con la regla de siempre', () => {
        const r = conCajon(50, 300);
        expect(r.origen).toBe('BOLSAS');
        expect(r.repartos).toEqual([{ bolsa_id: 1, folio: 'S3-1001', monto: 300 }]);
    });

    it('el cajón entra ENTERO: no se parte una salida entre el cajón y una bolsa', () => {
        // Con $200 en el cajón y una salida de $300, el cajón no aporta nada:
        // serían dos vales en dos archivos distintos por una sola entrega.
        const r = conCajon(200, 300);
        expect(r.origen).toBe('BOLSAS');
        expect(r.repartos).toEqual([{ bolsa_id: 1, folio: 'S3-1001', monto: 300 }]);
    });

    it('el cajón respeta el paso: con $505 no paga una salida de $500', () => {
        // $500 es múltiplo de 10, así que del cajón salen billetes de $10: de
        // $505 sólo puede entregar $500... que alcanza. Con $499 no.
        expect(conCajon(505, 500).origen).toBe('CAJA');
        expect(conCajon(499, 500).origen).toBe('BOLSAS');
    });

    it('no poder medir el efectivo NO es tener cero: manda a las bolsas', () => {
        // `null` es «no sé». La falla segura es la regla vieja, no mandar a
        // alguien a buscar billetes que capaz no están.
        expect(conCajon(null, 3.37).origen).toBe('BOLSAS');
    });

    it('un motivo sin mapear al catálogo de la caja va a las bolsas', () => {
        // `bolsas_tipos_salida.caja_tipo` en NULL = ese motivo nunca sale del
        // cajón, por más efectivo que haya.
        expect(conCajon(5000, 3.37, false).origen).toBe('BOLSAS');
    });
});

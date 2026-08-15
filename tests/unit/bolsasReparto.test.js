import { describe, it, expect } from 'vitest';
import { disponibles, elegirBolsas, totalDisponible } from '../../src/utils/bolsasReparto';

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

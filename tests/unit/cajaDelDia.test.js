import { describe, expect, it } from 'vitest';
import {
    avanceDeMetaDelDia, conMayuscula, cuentaDelCajon, lineasDelDia, netoDelTramo, tituloDeCorreccion,
} from '@nucleo/utils/cajaDelDia';
import { filtrarCortes } from '@nucleo/utils/cortesDiagnostico';
import { laMasVieja } from '@nucleo/utils/bolsasTexto';

describe('cuentaDelCajon', () => {
    const ventas = [
        { tipo_pago: 'tarjeta', documentos: 2, total: 30 },
        { tipo_pago: 'efectivo', documentos: 5, total: 70 },
    ];
    it('ordena las formas por monto y suma ventas y documentos', () => {
        const c = cuentaDelCajon({ estado: null, ventas });
        expect(c.formas.map((f) => f.tipo)).toEqual(['efectivo', 'tarjeta']);
        expect(c.total).toBe(100);
        expect(c.docs).toBe(7);
    });
    it('el efectivo sale de las piezas del servidor, no de las ventas', () => {
        const estado = { efectivo: 118.75, apertura: 20, efectivo_piezas: { ventas_efectivo: 97.75, entradas: 1, vales: 0, en_bolsas: 0 } };
        const c = cuentaDelCajon({ estado, ventas });
        expect(c.puedeSumar).toBe(true);
        expect(c.efectivoVendido).toBe(97.75);
        expect(c.enCaja).toBe(118.75);
        expect(c.entradas).toBe(1);
    });
    it('sin piezas no afirma total y cae a la venta en efectivo', () => {
        const c = cuentaDelCajon({ estado: { efectivo: 50 }, ventas });
        expect(c.puedeSumar).toBe(false);
        expect(c.efectivoVendido).toBe(70);
    });
});

describe('lineasDelDia', () => {
    const lineas = lineasDelDia({
        movimientos: [{ id: 1, tipo: 'ENTRADA', monto: 10, registrado_at: '2026-10-06T10:00:00Z', concepto: 'Ingreso' }],
        deBolsas: [{ id: 2, monto: -5, registrado_at: '2026-10-06T11:00:00Z', tipo: 'REMESA', montoDeHoy: 5 }],
        cobros: [
            { id: 3, monto: 7, forma: 'Efectivo', created_at: '2026-10-06T12:00:00Z', cliente: 'Ana', credito_erp: 9, saldo_despues: 0 },
            { id: 4, monto: 8, forma: 'Tarjeta', created_at: '2026-10-06T09:00:00Z', cliente: 'Luis', credito_erp: 10, saldo_despues: 3 },
        ],
        etiquetaDe: (c) => (c === 'REMESA' ? 'Remesa' : c),
    });
    it('junta las tres fuentes, la más reciente arriba', () => {
        expect(lineas.map((l) => l.clave)).toEqual(['cobro-3', 'bolsa-2', 'caja-1', 'cobro-4']);
    });
    it('el cobro con otra forma no entra al cajón ni al neto', () => {
        expect(lineas.find((l) => l.clave === 'cobro-4').sinEfectivo).toBe(true);
        // +7 (cobro en efectivo) − 5 (bolsa) + 10 (ingreso); el de tarjeta no cuenta
        expect(netoDelTramo(lineas)).toBe(12);
    });
    it('la bolsa lleva su etiqueta del catálogo', () => {
        expect(lineas.find((l) => l.clave === 'bolsa-2').titulo).toBe('Remesa');
    });
});

describe('tituloDeCorreccion y conMayuscula', () => {
    it('dice los tres estados', () => {
        expect(tituloDeCorreccion({ estado: 'PENDING', que: 'ANULAR' })).toBe('Se pidió anularlo');
        expect(tituloDeCorreccion({ estado: 'APPROVED', que: 'MONTO', monto_antes: 5 })).toContain('antes decía $5.00');
        expect(tituloDeCorreccion({ estado: 'REJECTED', que: 'ANULAR' })).toContain('se rechazó');
    });
    it('pone mayúscula y deja guion al vacío', () => {
        expect(conMayuscula('efectivo')).toBe('Efectivo');
        expect(conMayuscula('')).toBe('—');
    });
});

describe('avanceDeMetaDelDia', () => {
    it('reparte la meta del mes entre sus días', () => {
        expect(avanceDeMetaDelDia({ monto_meta: 3000, dias_mes: 30, venta_hoy: 50 })).toEqual({ meta: 100, vendido: 50, pct: 50 });
    });
    it('una meta que no se pudo leer no es un cero', () => {
        expect(avanceDeMetaDelDia(null)).toBeNull();
        expect(avanceDeMetaDelDia({ monto_meta: 0, dias_mes: 30, venta_hoy: 5 })).toBeNull();
    });
});

describe('filtrarCortes', () => {
    const cortes = [
        { id: 1, tipo: 'C', estado: 'PENDIENTE', tramo: 0, branch_id: 2, hizo: { name: 'Ana Pérez' } },
        { id: 2, tipo: 'C', estado: 'CONFIRMADO', tramo: -3, branch_id: 4 },
        { id: 3, tipo: 'Z', estado: 'PENDIENTE', tramo: null, branch_id: 2 },
    ];
    it('la Z no entra con un filtro de estado puesto', () => {
        expect(filtrarCortes(cortes, { estado: 'PENDIENTE' }).map((c) => c.id)).toEqual([1]);
        expect(filtrarCortes(cortes).map((c) => c.id)).toEqual([1, 2, 3]);
    });
    it('filtra por diferencia, sala y por quien cortó', () => {
        expect(filtrarCortes(cortes, { diferencia: 'falta' }).map((c) => c.id)).toEqual([2]);
        expect(filtrarCortes(cortes, { sala: '2' }).map((c) => c.id)).toEqual([1, 3]);
        expect(filtrarCortes(cortes, { busqueda: 'ana' }).map((c) => c.id)).toEqual([1]);
    });
});

describe('laMasVieja', () => {
    it('elige la de fecha más antigua y cuenta sus días', () => {
        const r = laMasVieja([{ id: 1, fecha: '2026-10-04' }, { id: 2, fecha: '2026-10-01' }], '2026-10-06');
        expect(r.bolsa.id).toBe(2);
        expect(r.dias).toBe(5);
    });
    it('sin pendientes no hay ninguna', () => {
        expect(laMasVieja([], '2026-10-06')).toEqual({ bolsa: null, dias: 0 });
    });
});

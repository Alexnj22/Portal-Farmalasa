import { describe, it, expect } from 'vitest';
import {
    conEstados, diaEnFiltro, estadoDeCorte, peorEstado, pendientesDeRegistrar, porSigno, resumenDeDias,
    saldoDeDiferencia,
} from '../../src/utils/diferenciasDeCaja';

// El caso real que originó la pestaña: Salud 2, 24-sep, faltante de −$20.25 en
// el corte de la 1:05 p. m., confirmado y sin resolver.
const salud2 = {
    branch_id: 25, fecha: '2026-09-24', neto: -20.25, cortes_del_dia: 2,
    cortes: [{ id: 1444, hora: '13:05:44', estado: 'CONFIRMADO', tramo: -20.25, diferencia: null }],
};

const repone = (asignado, abonado, sinAsentar = 0) => ({
    via: 'REPONE', asignado, abonado, abonos_sin_asentar: sinAsentar,
});

describe('estadoDeCorte', () => {
    it('confirmado sin resolución: sin resolver', () => {
        expect(estadoDeCorte(salud2.cortes[0])).toBe('sin_resolver');
    });
    it('pendiente sin resolución: por confirmar', () => {
        expect(estadoDeCorte({ estado: 'PENDIENTE', tramo: -1 })).toBe('por_confirmar');
    });
    it('con responsables que deben: con saldo', () => {
        expect(estadoDeCorte({ estado: 'CONFIRMADO', diferencia: repone(20.25, 10) })).toBe('con_saldo');
    });
    it('saldado pero con abonos sin anotar: por registrar', () => {
        expect(estadoDeCorte({ estado: 'CONFIRMADO', diferencia: repone(20.25, 20.25, 2) })).toBe('por_registrar');
    });
    it('saldado y anotado: resuelto', () => {
        expect(estadoDeCorte({ estado: 'CONFIRMADO', diferencia: repone(20.25, 20.25, 0) })).toBe('resuelto');
    });
    it('retiro sin anotar: por registrar; anotado: resuelto', () => {
        expect(estadoDeCorte({ diferencia: { via: 'RETIRA' } })).toBe('por_registrar');
        expect(estadoDeCorte({ diferencia: { via: 'RETIRA', asentado_at: 'x' } })).toBe('resuelto');
    });
    it('causa encontrada: resuelto', () => {
        expect(estadoDeCorte({ diferencia: { via: 'JUSTIFICA' } })).toBe('resuelto');
    });
});

describe('saldoDeDiferencia', () => {
    it('resta al centavo sin arrastrar flotantes', () => {
        expect(saldoDeDiferencia(repone(20.25, 10.1))).toBe(10.15);
    });
    it('nunca negativo, y cero fuera de REPONE', () => {
        expect(saldoDeDiferencia(repone(5, 6))).toBe(0);
        expect(saldoDeDiferencia({ via: 'JUSTIFICA' })).toBe(0);
    });
});

describe('peorEstado', () => {
    it('manda el más urgente', () => {
        expect(peorEstado(['resuelto', 'con_saldo', 'por_registrar'])).toBe('con_saldo');
        expect(peorEstado(['por_confirmar', 'sin_resolver'])).toBe('sin_resolver');
        expect(peorEstado([])).toBe('resuelto');
    });
});

describe('conEstados y resumenDeDias', () => {
    it('el día toma el peor estado y separa faltante de sobrante', () => {
        const [d] = conEstados([{
            ...salud2,
            cortes: [
                ...salud2.cortes,
                { id: 2, estado: 'CONFIRMADO', tramo: 3.5, diferencia: { via: 'JUSTIFICA' } },
            ],
        }]);
        expect(d.estadoDif).toBe('sin_resolver');
        expect(d.faltante).toBe(-20.25);
        expect(d.sobrante).toBe(3.5);
    });
    it('suma el saldo pendiente de todos los días', () => {
        const dias = conEstados([
            { cortes: [{ estado: 'CONFIRMADO', tramo: -4.05, diferencia: repone(4.05, 2) }] },
            { cortes: [{ estado: 'CONFIRMADO', tramo: -1.1, diferencia: repone(1.1, 0) }] },
        ]);
        const r = resumenDeDias(dias);
        expect(r.con_saldo).toBe(2);
        expect(r.saldo).toBe(3.15);
    });
});

describe('diaEnFiltro', () => {
    const [d] = conEstados([salud2]);
    it('PENDIENTES deja fuera sólo lo resuelto', () => {
        expect(diaEnFiltro(d, 'PENDIENTES')).toBe(true);
        expect(diaEnFiltro({ estadoDif: 'resuelto' }, 'PENDIENTES')).toBe(false);
    });
    it('un estado concreto filtra por ese estado', () => {
        expect(diaEnFiltro(d, 'sin_resolver')).toBe(true);
        expect(diaEnFiltro(d, 'con_saldo')).toBe(false);
        expect(diaEnFiltro(d, 'TODOS')).toBe(true);
    });
});


describe('pendientesDeRegistrar', () => {
    const res = [
        { id: 1, via: 'RETIRA', monto: 50, branch_id: 29, fecha: '2026-08-31' },
        { id: 2, via: 'RETIRA', monto: 5, branch_id: 29, asentado_at: 'x' },
        { id: 3, via: 'JUSTIFICA', monto: 3, branch_id: 29 },
        { id: 4, via: 'REPONE', monto: -20.25, branch_id: 25, fecha: '2026-09-24', hora: '13:05:44',
          abonos: [
              { id: 1, nombre: 'Cristian Humberto', monto: 4.05 },
              { id: 9, nombre: 'Sergio', monto: 2, asentado_at: 'x' },
              { id: 10, nombre: 'Brissa', monto: 1, anulada_at: 'x' },
          ] },
        { id: 5, via: 'RETIRA', monto: 7, branch_id: 29, anulada_at: 'x' },
    ];
    it('trae retiros y abonos sin anotar, nada más', () => {
        const f = pendientesDeRegistrar(res);
        expect(f.map((x) => `${x.kind}:${x.id}`)).toEqual(['diferencia:1', 'abono:1']);
    });
    it('el abono entra: monto negativo, con la fecha del faltante', () => {
        const [, ab] = pendientesDeRegistrar(res);
        expect(ab.monto).toBe(-4.05);
        expect(ab.fecha).toBe('2026-09-24');
        expect(ab.branch_id).toBe(25);
    });
    it('respeta la sala', () => {
        expect(pendientesDeRegistrar(res, { sala: '25' }).map((x) => x.kind)).toEqual(['abono']);
    });
});

describe('porSigno', () => {
    const dias = conEstados([
        // Salud 2, 24-sep: faltante de verdad.
        { fecha: 'a', neto: -20.25, cortes: [{ id: 1, estado: 'CONFIRMADO', tramo: -20.25, diferencia: null }] },
        // La Popular, 24-sep: +0.20 y después −0.20 → cerró exacto.
        { fecha: 'b', neto: 0, cortes: [
            { id: 2, estado: 'CONFIRMADO', tramo: 0.2, diferencia: null },
            { id: 3, estado: 'CONFIRMADO', tramo: -0.2, diferencia: null },
        ] },
        // Sobró 5 a mediodía y faltaron 3 a la noche: el día cerró +2.
        { fecha: 'c', neto: 2, cortes: [
            { id: 4, estado: 'CONFIRMADO', tramo: 5, diferencia: null },
            { id: 5, estado: 'CONFIRMADO', tramo: -3, diferencia: null },
        ] },
    ]);
    it('un día que cerró exacto está compensado y no es pendiente', () => {
        const b = porSigno(dias).find((d) => d.fecha === 'b');
        expect(b.compensado).toBe(true);
        expect(b.estadoDif).toBe('compensado');
        expect(diaEnFiltro(b, 'PENDIENTES')).toBe(false);
        expect(diaEnFiltro(b, 'resuelto')).toBe(true);
    });
    it('faltantes = días que cerraron en negativo', () => {
        expect(porSigno(dias, 'falta').map((d) => d.fecha)).toEqual(['a']);
        expect(porSigno(dias, 'sobra').map((d) => d.fecha)).toEqual(['c']);
        expect(porSigno(dias, 'todos')).toHaveLength(3);
    });
    it('el corte del signo contrario se compensó y no decide el estado', () => {
        const c = porSigno(dias).find((d) => d.fecha === 'c');
        expect(c.cortes.find((k) => k.id === 5).estadoDif).toBe('compensado');
        expect(c.estadoDif).toBe('sin_resolver');
        expect(c.faltanteDia).toBe(-3);
        expect(c.sobranteDia).toBe(5);
    });
    it('un corte por confirmar siempre cuenta', () => {
        const [d] = porSigno(conEstados([{ fecha: 'd', neto: 0, cortes: [
            { id: 6, estado: 'PENDIENTE', tramo: -1, diferencia: null },
        ] }]), 'falta');
        expect(d.estadoDif).toBe('por_confirmar');
    });
    it('el resumen cuenta los compensados como resueltos', () => {
        expect(resumenDeDias(porSigno(dias)).resuelto).toBe(1);
    });
});

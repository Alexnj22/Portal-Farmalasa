import { describe, it, expect } from 'vitest';
import {
    conEstados, diaEnFiltro, diaEnMes, estadoDeCorte, mesesDeLosDias, ordenarDias, peorEstado,
    pendientesDeRegistrar, porSigno, resumenDeDias,
    saldoDeDiferencia, desgloseDelDia, responsablesDelDia,
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

describe('porSigno: faltantes y sobrantes no se mezclan', () => {
    const dias = conEstados([
        // Salud 2, 24-sep: faltante de verdad.
        { fecha: 'a', neto: -20.25, cortes: [{ id: 1, estado: 'CONFIRMADO', tramo: -20.25, diferencia: null }] },
        // La Popular, 24-sep: sobró 0.20 y después el corte no los tenía.
        // Es un sobrante que se acumula Y un faltante que se paga.
        { fecha: 'b', neto: 0, cortes: [
            { id: 2, estado: 'CONFIRMADO', tramo: 0.2, diferencia: null },
            { id: 3, estado: 'CONFIRMADO', tramo: -0.2, diferencia: null },
        ] },
    ]);
    it('un +0.20 y un −0.20 no se compensan: el faltante se cobra', () => {
        const f = porSigno(dias, 'falta');
        expect(f.map((d) => d.fecha)).toEqual(['a', 'b']);
        expect(f[1].estadoDif).toBe('sin_resolver');
        expect(f[1].faltante).toBe(-0.2);
    });
    it('y el sobrante queda acumulado, sin pedir nada', () => {
        const s = porSigno(dias, 'sobra');
        expect(s.map((d) => d.fecha)).toEqual(['b']);
        expect(s[0].estadoDif).toBe('acumulado');
        expect(diaEnFiltro(s[0], 'PENDIENTES')).toBe(false);
    });
    it('el acumulado suma sólo sobrantes confirmados sin causa', () => {
        const s = porSigno(conEstados([{ fecha: 'c', cortes: [
            { id: 4, estado: 'CONFIRMADO', tramo: 5, diferencia: null },
            { id: 5, estado: 'CONFIRMADO', tramo: 1.5, diferencia: { via: 'JUSTIFICA' } },
            { id: 6, estado: 'PENDIENTE', tramo: 2, diferencia: null },
        ] }]), 'sobra');
        const r = resumenDeDias(s);
        expect(r.montoAcumulado).toBe(5);
        expect(s[0].estadoDif).toBe('por_confirmar');
    });
    it('un sobrante con causa sale del acumulado', () => {
        expect(estadoDeCorte({ estado: 'CONFIRMADO', tramo: 3, diferencia: { via: 'JUSTIFICA' } })).toBe('resuelto');
        expect(estadoDeCorte({ estado: 'CONFIRMADO', tramo: 3, diferencia: null })).toBe('acumulado');
    });
});

describe('diaEnMes y ordenarDias', () => {
    const [viejo, reciente, sobra] = porSigno(conEstados([
        { fecha: '2026-08-10', cortes: [{ id: 1, estado: 'CONFIRMADO', tramo: -3, diferencia: null }] },
        { fecha: '2026-09-02', cortes: [{ id: 2, estado: 'CONFIRMADO', tramo: -1, diferencia: { via: 'JUSTIFICA' } }] },
        { fecha: '2026-08-11', cortes: [{ id: 3, estado: 'CONFIRMADO', tramo: -2, diferencia: { via: 'JUSTIFICA' } }] },
    ]), 'falta');
    it('un faltante sin resolver de otro mes se muestra igual', () => {
        expect(diaEnMes(viejo, '2026-09')).toBe(true);
        expect(diaEnMes(sobra, '2026-09')).toBe(false);
        expect(diaEnMes(reciente, '2026-09')).toBe(true);
        expect(diaEnMes(sobra, 'TODOS')).toBe(true);
    });
    it('lo urgente primero, después lo reciente', () => {
        expect(ordenarDias([sobra, reciente, viejo]).map((d) => d.fecha))
            .toEqual(['2026-08-10', '2026-09-02', '2026-08-11']);
    });
    it('los meses, del más reciente al más viejo', () => {
        expect(mesesDeLosDias([viejo, reciente, sobra])).toEqual(['2026-09', '2026-08']);
    });
});

describe('desgloseDelDia', () => {
    const dia = { cortes: [
        { tramo: -10, estado: 'CONFIRMADO', diferencia: { via: 'REPONE', asignado: 10, abonado: 3.25 } },
        { tramo: -5, estado: 'CONFIRMADO', diferencia: { via: 'JUSTIFICA' } },
        { tramo: -2, estado: 'CONFIRMADO', diferencia: null },
        { tramo: -1, estado: 'PENDIENTE', diferencia: null },
    ] };
    it('reparte el faltante sin perder un centavo', () => {
        const d = desgloseDelDia(dia, 'falta');
        expect(d).toMatchObject({ total: 18, abonado: 3.25, porCobrar: 6.75, explicado: 5, sinResolver: 2, porConfirmar: 1 });
        expect(d.cubierto).toBe(8.25);
        expect(d.pct).toBe(45);
    });
    it('un sobrante sin causa se acumula, no queda sin resolver', () => {
        const d = desgloseDelDia({ cortes: [{ tramo: 4, estado: 'CONFIRMADO', diferencia: null }] }, 'sobra');
        expect(d).toMatchObject({ acumulado: 4, sinResolver: 0, pct: 0 });
    });
    it('no pinta 100 hasta que está completo', () => {
        const d = desgloseDelDia({ cortes: [{ tramo: -100, diferencia: { via: 'REPONE', asignado: 100, abonado: 99.99 } }] });
        expect(d.pct).toBe(99);
    });
});

describe('responsablesDelDia', () => {
    it('une a la misma persona de varios cortes, los que deben primero', () => {
        const r = responsablesDelDia({ cortes: [
            { diferencia: { via: 'REPONE', personas: [{ persona_id: 10, employee_id: 'a', nombre: 'A', monto: 2, abonado: 2, saldo: 0 }, { persona_id: 11, employee_id: 'b', nombre: 'B', monto: 3, abonado: 0, saldo: 3 }] } },
            { diferencia: { via: 'REPONE', personas: [{ persona_id: 12, employee_id: 'a', nombre: 'A', monto: 1.1, abonado: 0, saldo: 1.1 }] } },
            { diferencia: { via: 'JUSTIFICA', personas: [{ persona_id: 9 }] } },
        ] });
        expect(r.map((p) => p.employee_id)).toEqual(['b', 'a']);
        expect(r[1]).toMatchObject({ monto: 3.1, abonado: 2, saldo: 1.1 });
    });
});

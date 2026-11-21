import { describe, it, expect } from 'vitest';
import { cifraDeEncargo, encargoPorCobrar, porCobrarDeSala } from '@nucleo/utils/reservasDeSala';

// E-000016 (2026-11-04): «Esperando pago» con la cifra «Pagado $130.00». El
// `anticipo` es lo que el cliente paga desde que se confirma el precio, no lo
// que ya entró: lo que decide es `pago_estado`.
const base = { id: 16, estado: 'confirmado', pago_estado: 'pendiente', anticipo: '130.00', precio_unitario: '130.00', cantidad: 1, reserva_id: null };

describe('encargo por cobrar', () => {
    it('confirmado sin pago: «Por cobrar», no «Pagado»', () => {
        expect(encargoPorCobrar(base)).toBe(true);
        expect(cifraDeEncargo(base)).toEqual({ rotulo: 'Por cobrar', valor: 130, cobrado: false });
    });
    it('ya pagado: «Pagado»', () => {
        const e = { ...base, estado: 'aceptado', pago_estado: 'pagado' };
        expect(encargoPorCobrar(e)).toBe(false);
        expect(cifraDeEncargo(e)).toEqual({ rotulo: 'Pagado', valor: 130, cobrado: true });
    });
    it('el resto de una reserva no se cobra por aquí', () => {
        expect(encargoPorCobrar({ ...base, reserva_id: 9, reserva: 'R-000009' })).toBe(false);
    });
    it('sin monto no hay cifra', () => {
        expect(cifraDeEncargo({ ...base, anticipo: null })).toBeNull();
    });
    it('«Por cobrar» de Apartar lista los mismos encargos', () => {
        const filas = porCobrarDeSala([base, { ...base, id: 17, pago_estado: 'pagado' }], []);
        expect(filas.map((f) => f.clave)).toEqual(['e16']);
    });
});

import { pasosDeEncargo, siguientePasoDeEncargo } from '@nucleo/utils/reservasDeSala';

describe('pasos del encargo', () => {
    const pasos = [
        { paso: 'encargado', at: '2026-11-04T16:22:15Z', por_id: 'a', por: 'ANDY OSMANI MANCÍA CLAVEL', por_nombres: 'ANDY OSMANI', por_apellidos: 'MANCÍA CLAVEL' },
        { paso: 'confirmado', at: '2026-11-04T16:39:31Z', por_id: 'c', por: 'CENDY', por_nombres: 'CENDY YANETH', por_apellidos: 'QUINTANILLA' },
        { paso: 'cobrado', at: '2026-11-04T17:04:58Z', por_id: 'a', por: 'ANDY', por_nombres: 'ANDY OSMANI', por_apellidos: 'MANCÍA CLAVEL' },
        { paso: 'pedido', at: '2026-11-04T17:18:13Z', por_id: 'a', por: 'ANDY', por_nombres: 'ANDY OSMANI', por_apellidos: 'MANCÍA CLAVEL' },
    ];
    it('E-000016 pedido: cuatro hechos con su persona, dos por hacer', () => {
        const r = pasosDeEncargo({ ...base, estado: 'pedido', pago_estado: 'pagado', pasos });
        expect(r.map((p) => [p.clave, p.hecho])).toEqual([
            ['encargado', true], ['confirmado', true], ['cobrado', true], ['pedido', true], ['llego', false], ['entregado', false]]);
        expect(r[1].persona.first_names).toBe('CENDY YANETH');
        expect(r[4].persona).toBeNull();
    });
    it('sin bitácora: lo pidió el cliente desde la app', () => {
        const r = pasosDeEncargo({ ...base, estado: 'solicitado', pasos: [{ paso: 'encargado', at: '2026-11-01T10:00:00Z', por_id: null }] });
        expect(r[0]).toMatchObject({ hecho: true, persona: null, quien: 'El cliente, desde la app' });
        expect(r[1].hecho).toBe(false);
    });
    it('qué toca ahora, según el estado', () => {
        expect(siguientePasoDeEncargo({ ...base, estado: 'aceptado' })).toMatch(/«Ya se pidió»/);
        expect(siguientePasoDeEncargo(base, { cobraAqui: true })).toMatch(/cobrarle el total \(\$130\.00\)/);
        expect(siguientePasoDeEncargo(base)).toMatch(/Por cobrar/);
        expect(siguientePasoDeEncargo({ ...base, estado: 'pedido', fecha_estimada: '2026-11-06' })).toMatch(/«Llegó»/);
    });
});

import { encargoACargo, encargoCancelableSinPago, encargoPasaASaldo, pagadoDeEncargo } from '@nucleo/utils/reservasDeSala';

// Encargo con adelanto o sin anticipo, a cargo de quien lo cobra (2026-11-18).
describe('encargo sin el 100 %', () => {
    const resp = { id: 'u1', first_names: 'Katherine', last_names: 'Salinas', at: '2026-11-18T10:00:00Z' };
    const base = { id: 25, estado: 'aceptado', anticipo: 210, precio_unitario: 70, cantidad: 3 };

    it('con adelanto: lo que falta al retirar y quién responde', () => {
        const e = { ...base, pago_estado: 'anticipo', abonado: 100, responsable: resp };
        expect(encargoACargo(e)).toMatchObject({ abonado: 100, falta: 110, sinAnticipo: false, persona: { id: 'u1' } });
        expect(cifraDeEncargo(e)).toEqual({ rotulo: 'Falta al retirar', valor: 110, cobrado: false });
        expect(pagadoDeEncargo(e)).toBe(100);
        expect(encargoPasaASaldo(e)).toBe(true);
        expect(encargoCancelableSinPago(e)).toBe(false);
        expect(siguientePasoDeEncargo(e)).toMatch(/Dejó \$100\.00: faltan \$110\.00 al retirar/);
        expect(pasosDeEncargo(e).find((p) => p.clave === 'cobrado')).toMatchObject({ hecho: true, titulo: 'Dejó $100.00 de adelanto' });
    });

    it('sin anticipo: todo al retirar, se puede cancelar y no pasa a saldo', () => {
        const e = { ...base, pago_estado: 'pendiente', responsable: resp };
        expect(encargoACargo(e)).toMatchObject({ abonado: 0, falta: 210, sinAnticipo: true });
        expect(cifraDeEncargo(e)).toEqual({ rotulo: 'Falta al retirar', valor: 210, cobrado: false });
        expect(encargoCancelableSinPago(e)).toBe(true);
        expect(encargoPasaASaldo(e)).toBe(false);
        expect(pasosDeEncargo(e).find((p) => p.clave === 'cobrado')).toMatchObject({ titulo: 'Sin anticipo, a cargo de', persona: { id: 'u1' } });
    });

    it('pagado completo: igual que antes', () => {
        const e = { ...base, pago_estado: 'pagado', abonado: 210 };
        expect(encargoACargo(e)).toBeNull();
        expect(cifraDeEncargo(e)).toEqual({ rotulo: 'Pagado', valor: 210, cobrado: true });
        expect(pagadoDeEncargo(e)).toBe(210);
        expect(encargoCancelableSinPago(e)).toBe(false);
    });
});

import { encargoAnticipable } from '@nucleo/utils/reservasDeSala';
import { construirConstanciaDeReserva } from '@nucleo/utils/reservaConstancia';

// Anticipo antes de que Bodega confirme (2026-11-21): contra el precio de la
// viñeta, y el papel dice que puede cambiar.
describe('encargo sin confirmar con anticipo', () => {
    const sol = { id: 40, estado: 'solicitado', pago_estado: 'pendiente', anticipo: null, precio_unitario: null,
        precio_referencia: 26.2, cantidad: 2, reserva_id: null, cliente: 'X', producto: 'P' };
    it('con precio de referencia se puede cobrar; sin él, no', () => {
        expect(encargoAnticipable(sol)).toBe(true);
        expect(encargoPorCobrar(sol)).toBe(true);
        expect(encargoPorCobrar({ ...sol, precio_referencia: null })).toBe(false);
        expect(encargoPorCobrar({ ...sol, pago_estado: 'anticipo', abonado: 10 })).toBe(false);
    });
    it('«Por cobrar» lo lista con el total de referencia y marcado por confirmar', () => {
        const [f] = porCobrarDeSala([sol], []);
        expect(f).toMatchObject({ clave: 'e40', saldo: 52.4, precio: 26.2, porConfirmar: true });
        expect(porCobrarDeSala([base], [])[0].porConfirmar).toBe(false);
    });
    it('la cifra: precio aprox. antes de cobrar, el anticipo después', () => {
        expect(cifraDeEncargo(sol)).toEqual({ rotulo: 'Precio aprox.', valor: 52.4, cobrado: false });
        expect(cifraDeEncargo({ ...sol, pago_estado: 'anticipo', abonado: 10 })).toEqual({ rotulo: 'Anticipo', valor: 10, cobrado: true });
    });
    it('si desiste antes de confirmar, lo que dejó pasa a saldo a favor', () => {
        expect(encargoPasaASaldo({ ...sol, pago_estado: 'anticipo', abonado: 10 })).toBe(true);
        expect(encargoPasaASaldo(sol)).toBe(false);
    });
    it('el papel dice que el precio puede cambiar', () => {
        const d = construirConstanciaDeReserva({ codigo: 'E-000040', producto: 'P', cantidad: 2, precio: 26.2, anticipo: 10,
            metodo: 'Efectivo', sala: 'Centro', porConfirmar: true });
        expect(d.encabezado.titulo).toBe('ENCARGO E-000040');
        expect(d.totales.map((t) => t[0])).toEqual(['Total aprox.', 'Anticipo (Efectivo)', 'Falta aprox.']);
        expect(d.pie[0]).toMatch(/PRECIO POR CONFIRMAR/);
        // El rollo sólo imprime ASCII y corta en la columna 54.
        for (const l of d.pie) { expect(l).toMatch(/^[\x20-\x7e]*$/); expect(l.length).toBeLessThanOrEqual(54); }
    });
});

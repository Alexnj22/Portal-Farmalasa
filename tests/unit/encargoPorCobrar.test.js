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

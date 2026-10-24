import { describe, expect, it } from 'vitest';
import { construirComprobanteDeAbono, reglasDelAbono, vigenciaDelSaldo, CONDICIONES_DEL_PAPEL, CONDICIONES_DEL_PAPEL_V2 } from '@nucleo/utils/abonoTicket';
import { construirConstanciaDeReserva } from '@nucleo/utils/reservaConstancia';
import { accionesDeReservaNucleo, plazoAlApartar, textoDeNivel } from '@nucleo/utils/reservasDeSala';

// Lo que devuelve `reserva_reglas()` antes y después de `reglas_v2_desde()`.
const V1 = { v2: false, desde: '2026-11-15', dias_sin_pago: 3, dias_anticipo: 7, dias_pagada: 7, dias_encargo: 7, dias_saldo_favor: 60, prorroga_dias: 7 };
const V2 = { v2: true, desde: '2026-11-15', dias_sin_pago: 7, dias_anticipo: 30, dias_pagada: 60, dias_encargo: 60, dias_saldo_favor: 365, prorroga_dias: 0 };

describe('reglamento de reservas v2 — textos que dependen de la fecha', () => {
    it('sin reglas (o antes de la fecha) el abono dice lo de siempre', () => {
        expect(reglasDelAbono(null)).toMatchObject({ dias: 7, condiciones: CONDICIONES_DEL_PAPEL });
        expect(reglasDelAbono(V1)).toMatchObject({ dias: 7, condiciones: CONDICIONES_DEL_PAPEL });
    });
    it('desde la fecha el abono aparta 30 días y el saldo vale 12 meses', () => {
        expect(reglasDelAbono(V2)).toMatchObject({ dias: 30, condiciones: CONDICIONES_DEL_PAPEL_V2 });
        expect(vigenciaDelSaldo(V2)).toBe('un año');
        expect(vigenciaDelSaldo(V1)).toBe('60 días');
    });
    it('un abono de antes de la fecha conserva sus condiciones al reimprimirse', () => {
        expect(reglasDelAbono(V2, '2026-11-10T15:00:00Z').condiciones).toBe(CONDICIONES_DEL_PAPEL);
        const t = JSON.stringify(construirComprobanteDeAbono({ abono: { created_at: '2026-11-10T15:00:00Z', abonado: 5, renglones: [] }, sala: 'S', hechoPor: 'X', hechoAt: '2026-11-20T15:00:00Z', reglas: V2 }));
        expect(t).toContain(CONDICIONES_DEL_PAPEL[0]);
    });
    it('el papel de la reserva sólo usa ASCII y dice la vigencia vigente', () => {
        const base = { codigo: 'R-1', producto: 'X', cantidad: 1, precio: 10, anticipo: 5, metodo: 'Efectivo' };
        const v1 = JSON.stringify(construirConstanciaDeReserva(base));
        const v2 = JSON.stringify(construirConstanciaDeReserva({ ...base, reglas: V2 }));
        expect(v1).toContain('por 60 dias');
        expect(v2).toContain('por 12 meses');
        expect(/[^\x20-\x7E]/.test(construirConstanciaDeReserva({ ...base, reglas: V2 }).pie.join(''))).toBe(false);
    });
    it('el plazo al apartar y el nivel', () => {
        expect(plazoAlApartar(null)).toBe('7 días');
        expect(plazoAlApartar(V2)).toBe('30 días (60 si lo paga completo)');
        expect(textoDeNivel({ nombre: 'Oro', prioridad: true })).toBe('Cliente Oro · con prioridad');
        expect(textoDeNivel(null)).toBeNull();
    });
    it('la prórroga la decide la base: sin `prorrogable` no hay botón', () => {
        const lista = { id: 1, estado: 'lista', vence_at: '2026-12-01', tiene_app: true };
        const ks = (r) => accionesDeReservaNucleo(r, {}).map((a) => a.k);
        expect(ks(lista)).toContain('prorrogar');                       // respuesta vieja: regla v1
        expect(ks({ ...lista, prorrogable: false })).not.toContain('prorrogar');
        expect(ks({ ...lista, prorrogable: false, registrar_llamada: true })).toContain('llamada');
    });
});

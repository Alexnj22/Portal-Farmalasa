// El vencimiento de los documentos del expediente.
//
// RTS 11.02.04:24 §6.3.1 exige acreditación vigente para TODO el personal, no
// sólo para regente y enfermería, así que esto decide si alguien puede seguir
// trabajando. Se prueba con RELOJ FIJO: sin eso, una prueba de fechas pasa hoy y
// falla en marzo, y una que falla sola se termina borrando.
//
// Lo que ancla, y que se rompe solo si alguien lo "simplifica":
//
//   · `new Date(fecha + 'T00:00:00')` — la hora explícita NO es adorno. Sin
//     ella, `new Date('2026-08-24')` se lee como UTC y en El Salvador (UTC-6)
//     retrocede al 23, así que un documento vencería un día antes de tiempo;
//   · la anualidad del CSSP usa `T12:00:00` —mediodía— para que ningún ajuste
//     de una hora la corra de día.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    daysUntilExpiry, getExpiryBadge, getExpiringDocuments,
    getNextAnnualidadCsspDueDate, DOC_EXPIRY_WARN_DAYS, DOC_EXPIRY_DANGER_DAYS,
} from '../../src/utils/documentExpiry';

// Un martes cualquiera, a media mañana, para que ningún caso quede pegado a un
// borde de día por accidente.
const HOY = new Date('2026-08-24T10:00:00');

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(HOY); });
afterEach(() => { vi.useRealTimers(); });

const enDias = (n) => {
    const d = new Date(HOY); d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
};

describe('días que faltan', () => {
    it('cuenta hacia adelante y hacia atrás', () => {
        expect(daysUntilExpiry(enDias(10))).toBe(10);
        expect(daysUntilExpiry(enDias(1))).toBe(1);
        expect(daysUntilExpiry(enDias(-5))).toBe(-5);
    });

    it('el día de hoy NO cuenta como vencido', () => {
        // Un documento que vence hoy sigue valiendo hoy. Lo que separa «vence
        // hoy» de «venció» es que el número NO sea menor que cero: con -1 el
        // badge diría «Vencido» a alguien que todavía puede trabajar.
        //
        // Y da **-0**, no 0: `Math.ceil` de una fracción negativa devuelve el
        // cero negativo. Es un artefacto de JavaScript y acá es inofensivo
        // —`-0 < 0` es false y `${-0}` se imprime «0»—, pero queda escrito
        // porque `toBe(0)` falla contra él y el próximo que escriba una prueba
        // acá va a chocar con lo mismo.
        const hoy = daysUntilExpiry(enDias(0));
        expect(hoy < 0).toBe(false);
        expect(Math.abs(hoy)).toBe(0);
        expect(getExpiryBadge(enDias(0)).label).toBe('Vence en 0 días');
        expect(getExpiryBadge(enDias(0)).variant).toBe('danger');
    });

    it('la fecha se lee en hora LOCAL, no en UTC', () => {
        // Ésta es la regresión que importa. `new Date('2026-08-24')` sin hora se
        // interpreta como UTC medianoche, que en El Salvador (UTC-6) es el 23 a
        // las 18:00 — o sea un día ANTES. Un documento se daría por vencido
        // veinticuatro horas antes de tiempo y nadie sabría por qué.
        expect(Math.abs(daysUntilExpiry('2026-08-24'))).toBe(0);
        expect(daysUntilExpiry('2026-08-25')).toBe(1);
        // Si la fecha se leyera como UTC, el de hoy daría -1 y el de mañana 0.
        expect(daysUntilExpiry('2026-08-24')).not.toBe(-1);
    });

    it('sin fecha, o con basura, devuelve null — no NaN ni 0', () => {
        // Un 0 diría «vence hoy» sobre un documento que ni siquiera tiene fecha.
        for (const v of [null, undefined, '', 'no es fecha', '2026-13-45'])
            expect(daysUntilExpiry(v)).toBe(null);
    });
});

describe('el badge', () => {
    it('los tres tramos, en sus bordes exactos', () => {
        expect(getExpiryBadge(enDias(-1)).label).toBe('Vencido');
        expect(getExpiryBadge(enDias(DOC_EXPIRY_DANGER_DAYS)).variant).toBe('danger');
        expect(getExpiryBadge(enDias(DOC_EXPIRY_DANGER_DAYS + 1)).variant).toBe('warning');
        expect(getExpiryBadge(enDias(DOC_EXPIRY_WARN_DAYS)).variant).toBe('warning');
        expect(getExpiryBadge(enDias(DOC_EXPIRY_WARN_DAYS + 1))).toBe(null);
    });

    it('«1 día» va en singular', () => {
        expect(getExpiryBadge(enDias(1)).label).toBe('Vence en 1 día');
        expect(getExpiryBadge(enDias(2)).label).toBe('Vence en 2 días');
    });

    it('devuelve la VARIANTE del canónico, no clases sueltas', () => {
        // Antes devolvía `className` con la paleta escrita a mano y los dos
        // sitios la pegaban en un `<span>` propio: dos chips a mano del mismo
        // estado, y por lo tanto dos formas distintas de verse.
        const b = getExpiryBadge(enDias(-1));
        expect(Object.keys(b).sort()).toEqual(['daysLeft', 'label', 'variant']);
        expect(b.className).toBeUndefined();
    });

    it('sin fecha no hay badge', () => {
        expect(getExpiryBadge(null)).toBe(null);
    });
});

describe('el barrido del expediente', () => {
    const doc = (nombre, dias, url = 'x.pdf') => ({ nombre, url, expiry_date: enDias(dias) });

    it('ordena por urgencia: lo vencido primero', () => {
        const r = getExpiringDocuments([doc('a', 20), doc('b', -5), doc('c', 3)]);
        expect(r.map(d => d.nombre)).toEqual(['b', 'c', 'a']);
    });

    it('deja fuera lo que todavía no entra en el aviso', () => {
        const r = getExpiringDocuments([doc('lejano', DOC_EXPIRY_WARN_DAYS + 1), doc('cerca', 5)]);
        expect(r.map(d => d.nombre)).toEqual(['cerca']);
    });

    it('un documento SIN archivo subido no cuenta', () => {
        // La fecha sola no acredita nada: lo que vence es el papel.
        const r = getExpiringDocuments([{ nombre: 'sin archivo', expiry_date: enDias(1) }]);
        expect(r).toEqual([]);
    });

    it('lo que no es una lista no rompe', () => {
        for (const v of [null, undefined, 'texto', {}, 42])
            expect(getExpiringDocuments(v)).toEqual([]);
    });
});

describe('la anualidad del CSSP', () => {
    it('es el 31 de marzo, y si ya pasó apunta al año que viene', () => {
        // Agosto de 2026: el 31 de marzo ya pasó, así que la próxima es 2027.
        expect(getNextAnnualidadCsspDueDate()).toBe('2027-03-31');
        expect(getNextAnnualidadCsspDueDate(new Date('2026-01-15T10:00:00'))).toBe('2026-03-31');
    });

    it('el mismo 31 de marzo todavía cuenta como este año', () => {
        // El plazo es «hasta el 31», no «antes del 31». Correrlo un año por un
        // signo mal puesto haría que el portal pida el comprobante del año que
        // viene el día mismo del vencimiento.
        expect(getNextAnnualidadCsspDueDate(new Date('2026-03-31T09:00:00'))).toBe('2026-03-31');
        expect(getNextAnnualidadCsspDueDate(new Date('2026-04-01T09:00:00'))).toBe('2027-03-31');
    });
});

import { describe, expect, it } from 'vitest';
import { conVersionesAlDia, datosDePieza, faltaEnPieza, PIEZA_VACIA, versionesDe } from '@nucleo/utils/marketing';

describe('formulario de pieza', () => {
    const lista = { ...PIEZA_VACIA, titulo: 'Día del padre', fecha: '2026-10-10', marcas: [3], formato: 'post' };
    it('falta título, fecha, marca o formato', () => {
        expect(faltaEnPieza(PIEZA_VACIA)).toBe(true);
        expect(faltaEnPieza(lista)).toBe(false);
    });
    it('no deja pasar el tope de pauta del mes', () => {
        expect(faltaEnPieza({ ...lista, pautar: true, monto: '60' }, { limite: 100, otros: 50 })).toBe(true);
        expect(faltaEnPieza({ ...lista, pautar: true, monto: '50' }, { limite: 100, otros: 50 })).toBe(false);
    });
    it('la fila: sin monto, vacíos en null y la primera marca', () => {
        const d = datosDePieza({ ...lista, monto: '20', hora: '' });
        expect(d).not.toHaveProperty('monto');
        expect(d).toMatchObject({ hora: null, pilar: null, marca_id: 3 });
        expect(datosDePieza({ ...lista, estado: 'publicado' }).publicado_en).toBeTruthy();
        expect(datosDePieza({ ...lista, estado: 'publicado' }, { publicado_en: 'x' }).publicado_en).toBeUndefined();
    });
});

// H32: la V2 «Sin enviar» no retira a la V1 en la base; quien la subió recibe
// las dos y tiene que ver sólo la V2 como vigente. Quien no la ve, la V1.
describe('versiones sin enviar', () => {
    const v1 = { id: 'a', version: 1, anterior_id: null, reemplazado: false, borrador: false };
    const v2 = { id: 'b', version: 2, anterior_id: 'a', reemplazado: false, borrador: true };
    it('para la autora, la V1 queda retirada y la V2 vigente', () => {
        const r = conVersionesAlDia([v1, v2]);
        expect(r.filter((x) => !x.reemplazado).map((x) => x.id)).toEqual(['b']);
        expect(versionesDe(r, r[1]).map((x) => x.version)).toEqual([1, 2]);
    });
    it('para quien no ve el borrador, la V1 sigue vigente', () => {
        expect(conVersionesAlDia([v1]).filter((x) => !x.reemplazado).map((x) => x.id)).toEqual(['a']);
    });
    it('no toca lo que ya venía retirado ni cambia el orden', () => {
        const r = conVersionesAlDia([{ ...v1, reemplazado: true }, { ...v2, borrador: false }]);
        expect(r.map((x) => [x.id, x.reemplazado])).toEqual([['a', true], ['b', false]]);
        expect(conVersionesAlDia(null)).toEqual([]);
    });
});

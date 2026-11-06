import { describe, it, expect } from 'vitest';
import { trozosDeGenerico } from '../../supabase/functions/_shared/erp-asignar-lote.ts';

describe('trozosDeGenerico', () => {
    it('del mayor al menor, hasta cubrir', () => {
        expect(trozosDeGenerico([2, 2], 4)).toEqual([2, 2]);
        expect(trozosDeGenerico([2, 5, 3], 7)).toEqual([5, 2]);
        expect(trozosDeGenerico([0, 4], 3)).toEqual([3]);
    });
    it('si la suma no alcanza, nada', () => {
        expect(trozosDeGenerico([2, 1], 4)).toEqual([]);
    });
});

import { describe, it, expect } from 'vitest';
import { ordenarTiposPorUso } from '@nucleo/utils/tiposPorUso';

const T = ['APARTADO', 'APLICACION', 'GLUCOSA', 'OTRO_ENTRADA', 'POS_PROMERICA'].map((codigo) => ({ codigo }));
const codigos = (l) => l.map((t) => t.codigo);

describe('ordenarTiposPorUso', () => {
    it('lo más anotado primero, «Otro» al final aunque se use mucho', () => {
        const uso = new Map([['POS_PROMERICA', 90], ['APLICACION', 40], ['OTRO_ENTRADA', 200]]);
        expect(codigos(ordenarTiposPorUso(T, uso)))
            .toEqual(['POS_PROMERICA', 'APLICACION', 'APARTADO', 'GLUCOSA', 'OTRO_ENTRADA']);
    });
    it('sin cuenta queda el orden del catálogo, con «Otro» al final', () => {
        expect(codigos(ordenarTiposPorUso(T, null)))
            .toEqual(['APARTADO', 'APLICACION', 'GLUCOSA', 'POS_PROMERICA', 'OTRO_ENTRADA']);
    });
    it('no modifica la lista que recibe', () => {
        const copia = codigos(T);
        ordenarTiposPorUso(T, new Map([['GLUCOSA', 5]]));
        expect(codigos(T)).toEqual(copia);
    });
});

import { describe, expect, it } from 'vitest';
import { agregarFiltroDeBitacora, filtrosEfectivosDeBitacora, quitarFiltroDeBitacora, rotuloDeFiltroDeBitacora } from '@nucleo/utils/inyeccionesPendientes';

describe('subfiltros de la bitácora de inyecciones', () => {
    it('fija lo escrito como filtro de un campo y no repite uno igual', () => {
        let f = agregarFiltroDeBitacora([], 'cliente', '  Ramírez ');
        expect(f).toEqual([{ campo: 'cliente', texto: 'Ramírez' }]);
        f = agregarFiltroDeBitacora(f, 'cliente', 'ramírez');
        expect(f).toHaveLength(1);
        f = agregarFiltroDeBitacora(f, 'medicamento', 'Neurobion');
        expect(f.map((x) => x.campo)).toEqual(['cliente', 'medicamento']);
    });
    it('el texto vacío no agrega nada', () => {
        expect(agregarFiltroDeBitacora([], 'cliente', '   ')).toEqual([]);
    });
    it('lo escrito sin fijar se suma como «todo»', () => {
        const fijados = [{ campo: 'cliente', texto: 'Sol' }];
        expect(filtrosEfectivosDeBitacora(fijados, ' neuro ')).toEqual([...fijados, { campo: 'todo', texto: 'neuro' }]);
        expect(filtrosEfectivosDeBitacora(fijados, '')).toBe(fijados);
    });
    it('quitar y rotular', () => {
        const f = [{ campo: 'cliente', texto: 'Sol' }, { campo: 'todo', texto: 'x' }];
        expect(quitarFiltroDeBitacora(f, 0)).toEqual([{ campo: 'todo', texto: 'x' }]);
        expect(rotuloDeFiltroDeBitacora(f[0])).toBe('Cliente: Sol');
        expect(rotuloDeFiltroDeBitacora(f[1])).toBe('«x»');
    });
});

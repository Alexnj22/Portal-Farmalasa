import { describe, it, expect } from 'vitest';
import { faltantesDelExpediente } from '@nucleo/utils/expediente';
import { datosPendientesDePersona } from '@nucleo/utils/alertasDePersona';

// 2026-10-26: la ficha decía «1 dato por completar: Profesión u oficio» y la
// tarjeta del directorio no decía nada, porque tenía su propia lista.
describe('la tarjeta y el formulario cuentan lo mismo', () => {
    it('la profesión vacía sale en la tarjeta', () => {
        expect(datosPendientesDePersona({ profession: null })).toContain('Profesión u oficio');
    });

    it('lo que no llegó (`undefined`) no se acusa en la fila del store', () => {
        const fila = { profession: 'Dependiente' };
        expect(faltantesDelExpediente(fila, { soloLoConocido: true }).map(f => f.campo)).toEqual([]);
        // En el formulario sí: ahí un campo ausente es un campo sin llenar.
        expect(faltantesDelExpediente(fila).length).toBeGreaterThan(5);
    });

    it('`null` sí es un dato que falta, aunque se mire sólo lo conocido', () => {
        const campos = faltantesDelExpediente({ dui: null, contrato_lugar_celebracion: '' }, { soloLoConocido: true })
            .map(f => f.campo);
        expect(campos).toEqual(expect.arrayContaining(['dui', 'contrato_lugar_celebracion']));
    });
});

import { agruparFaltantes } from '@nucleo/utils/expediente';

describe('el globo del avatar agrupa lo que falta', () => {
    it('ordena por tramo del expediente, sin grupos vacíos y con el rótulo corto', () => {
        const grupos = agruparFaltantes([
            { campo: 'afp_estado', label: 'Si tiene AFP' },
            { campo: 'gender', label: 'Género' },
            { campo: 'dui_lugar_expedicion', label: 'Lugar de expedición del documento' },
        ]);
        expect(grupos.map(g => g.rotulo)).toEqual(['Datos personales', 'Identidad', 'ISSS y AFP']);
        expect(grupos[1].items).toEqual(['Lugar de expedición']);
    });

    it('un campo sin grupo no se pierde', () => {
        expect(agruparFaltantes([{ campo: 'nuevo', label: 'Algo nuevo' }])).toEqual([
            { clave: 'otros', rotulo: 'Otros', items: ['Algo nuevo'] },
        ]);
    });
});

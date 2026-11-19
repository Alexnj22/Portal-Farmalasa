import { describe, it, expect } from 'vitest';
import {
    zonasDe, metaDeZonas, conZonaNueva, conZonaCambiada, sinZona, nombreDeZona, avanceDeZona, metaTotal, tablaDeRespuestas,
} from '@nucleo/utils/encuestasClientes';

// Zonas de campo (2026-11-19): Chalatenango Norte, Centro y Sur, 100 cada una.
const CHALATE = [
    { id: 'z1', nombre: 'Chalatenango Norte', meta: 100 },
    { id: 'z2', nombre: 'Chalatenango Centro', meta: 100 },
    { id: 'z3', nombre: 'Chalatenango Sur', meta: 100 },
];

describe('zonas de campo', () => {
    it('zonasDe siempre devuelve un arreglo', () => {
        expect(zonasDe(null)).toEqual([]);
        expect(zonasDe({ zonas_campo: null })).toEqual([]);
        expect(zonasDe({ zonas_campo: CHALATE })).toBe(CHALATE);
    });

    it('la meta de las zonas es la suma de las que tienen meta', () => {
        expect(metaDeZonas(CHALATE)).toBe(300);
        expect(metaDeZonas([{ id: 'a', nombre: 'A', meta: null }])).toBeNull();
        expect(metaDeZonas([{ id: 'a', nombre: 'A', meta: 50 }, { id: 'b', nombre: 'B', meta: null }])).toBe(50);
    });

    it('con zonas con meta, la meta general es su suma (no meta_total)', () => {
        expect(metaTotal({ alcance: 'general', meta_total: 384, zonas_campo: CHALATE })).toBe(300);
        expect(metaTotal({ alcance: 'general', meta_total: 384, zonas_campo: [] })).toBe(384);
        expect(metaTotal({ alcance: 'sucursales', zonas_campo: CHALATE }, [{ branch_id: 1, meta: 20 }])).toBe(320);
    });

    it('agregar, cambiar y quitar no tocan el arreglo original', () => {
        const una = conZonaNueva([]);
        expect(una).toHaveLength(1);
        expect(una[0]).toMatchObject({ nombre: '', meta: null });
        expect(una[0].id).toMatch(/^z/);
        const dos = conZonaNueva(una);
        expect(new Set(dos.map((z) => z.id)).size).toBe(2);

        const cambiada = conZonaCambiada(CHALATE, 'z2', { meta: '1a20' });
        expect(cambiada[1].meta).toBe(120);
        expect(CHALATE[1].meta).toBe(100);
        expect(conZonaCambiada(CHALATE, 'z1', { meta: '' })[0].meta).toBeNull();
        expect(conZonaCambiada(CHALATE, 'z1', { nombre: 'x'.repeat(80) })[0].nombre).toHaveLength(60);

        expect(sinZona(CHALATE, 'z3').map((z) => z.id)).toEqual(['z1', 'z2']);
    });

    it('nombre y avance de una zona', () => {
        expect(nombreDeZona(CHALATE, 'z3')).toBe('Chalatenango Sur');
        expect(nombreDeZona(CHALATE, null)).toBe('Sin zona');
        expect(nombreDeZona(CHALATE, 'z9')).toBe('Zona quitada');
        expect(avanceDeZona({ respuestas: 12, meta: 100 })).toBe('12 de 100');
        expect(avanceDeZona({ respuestas: 7, meta: null })).toBe('7');
    });

    it('el CSV lleva la columna Zona, neutralizada', () => {
        const { headers, rows } = tablaDeRespuestas({ secciones: [] }, [
            { fecha: '2026-11-19T10:00:00Z', sucursal: 'Campo', canal: 'campo', zona: '=Chalatenango Norte', respuestas: {} },
        ], { fechaHora: () => 'f' });
        const i = headers.indexOf('Zona');
        expect(i).toBe(3);
        expect(rows[0][i]).not.toMatch(/^=/);
    });
});

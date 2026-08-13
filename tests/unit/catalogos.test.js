import { describe, it, expect } from 'vitest';
import {
    CATEGORIAS_DOCUMENTO, TERMINATION_REASONS, categoriaDeDocumento, opcionesDeCatalogo,
} from '../../src/data/constants';

// Estos dos catálogos guardaban el RÓTULO como valor (`value === label`), así
// que corregirle una mayúscula desincronizaba lo guardado de lo que el código
// busca. Ahora guardan la clave. Lo que estas pruebas cuidan es el puente: que
// un valor escrito con el formato viejo siga cayendo donde corresponde, porque
// no hay migración que lo reescriba (medido el 2026-08-13 contra producción: 0
// filas guardadas, así que no había nada que migrar — pero un respaldo, otro
// entorno o una copia vieja del navegador sí pueden traerlo).

describe('categoriaDeDocumento — el puente entre el rótulo viejo y la clave', () => {
    it('deja pasar la clave', () => {
        for (const clave of Object.keys(CATEGORIAS_DOCUMENTO)) {
            expect(categoriaDeDocumento(clave)).toBe(clave);
        }
    });

    // Los seis literales exactos que `FormAddCustomDocument` guardaba hasta
    // v2.590.1. Si alguno dejara de resolver, ese documento desaparecería de
    // `TabExpediente` sin dar error.
    it('resuelve los rótulos con los que se guardaba antes', () => {
        expect(categoriaDeDocumento('Permisos y Licencias')).toBe('PERMISOS');
        expect(categoriaDeDocumento('Documentos Legales')).toBe('LEGALES');
        expect(categoriaDeDocumento('Fiscal y Financiero')).toBe('FISCAL');
        expect(categoriaDeDocumento('Operativo y Logística')).toBe('OPERATIVO');
        expect(categoriaDeDocumento('Recursos Humanos')).toBe('RRHH');
        expect(categoriaDeDocumento('Otro')).toBe('OTRO');
    });

    it('tolera la tilde, la mayúscula y el espacio de sobra', () => {
        expect(categoriaDeDocumento('operativo y logistica')).toBe('OPERATIVO');
        expect(categoriaDeDocumento('  Permisos  y  licencias ')).toBe('PERMISOS');
        expect(categoriaDeDocumento('FISCAL Y FINANCIERO')).toBe('FISCAL');
    });

    // Preferimos verlo mal clasificado antes que no verlo: `OTRO` es una
    // sección que se pinta, y una categoría desconocida no lo es.
    it('manda a OTRO lo que no reconoce, en vez de dejarlo sin sección', () => {
        expect(categoriaDeDocumento('Inventada')).toBe('OTRO');
        expect(categoriaDeDocumento('')).toBe('OTRO');
        expect(categoriaDeDocumento(null)).toBe('OTRO');
        expect(categoriaDeDocumento(undefined)).toBe('OTRO');
    });
});

describe('las claves son el contrato con las pantallas que agrupan por ellas', () => {
    // `TabExpediente` nombra estas claves a mano en sus cuatro secciones y
    // `FormAddCustomDocument` toma la primera como valor por omisión. Renombrar
    // una acá sin tocar allá deja una sección vacía sin fallar.
    it('CATEGORIAS_DOCUMENTO tiene exactamente las seis claves esperadas, en orden', () => {
        expect(Object.keys(CATEGORIAS_DOCUMENTO)).toEqual([
            'PERMISOS', 'RRHH', 'OPERATIVO', 'LEGALES', 'FISCAL', 'OTRO',
        ]);
    });

    it('TERMINATION_REASONS tiene las cuatro causas legales', () => {
        expect(Object.keys(TERMINATION_REASONS)).toEqual([
            'RENUNCIA', 'DESPIDO_SIN_RESPONSABILIDAD',
            'DESPIDO_CON_RESPONSABILIDAD', 'ABANDONO',
        ]);
    });

    it('ninguna clave se parece a su rótulo: si vuelven a coincidir, volvió el defecto', () => {
        for (const [clave, { label }] of Object.entries(CATEGORIAS_DOCUMENTO)) {
            expect(clave).not.toBe(label);
        }
        for (const [clave, { label }] of Object.entries(TERMINATION_REASONS)) {
            expect(clave).not.toBe(label);
        }
    });
});

describe('opcionesDeCatalogo — lo que come LiquidSelect', () => {
    it('mantiene el orden y separa valor de rótulo', () => {
        expect(opcionesDeCatalogo(TERMINATION_REASONS)[0])
            .toEqual({ value: 'RENUNCIA', label: 'Renuncia voluntaria' });
        expect(opcionesDeCatalogo(CATEGORIAS_DOCUMENTO).map(o => o.value))
            .toEqual(Object.keys(CATEGORIAS_DOCUMENTO));
    });
});

import { describe, expect, it } from 'vitest';
import { carnesConPersona, carnesPorSala, SIN_SUCURSAL } from '@nucleo/utils/carnesDelDia';

const gente = [
    { id: 'a', name: 'Luis Alberto Romero Paz', branchId: 2, role: 'Cajero' },
    { id: 'b', name: 'Ana María Díaz Soto', branchId: 4 },
    { id: 'c', name: 'Usuario De Pruebas' },
];
const salas = [{ id: 2, name: 'Salud 2' }, { id: 4, name: 'La Popular' }];

describe('carnesDelDia', () => {
    it('cada carné con su persona; la sala es la de la persona', () => {
        const [x, y] = carnesConPersona([
            { id: 1, employee_id: 'a', emitido_por: 'c', impreso_en: 4 },
            { id: 2, employee_id: 'zz', emitido_por: null, impreso_en: null },
        ], gente, salas);
        expect(x).toMatchObject({ nombre: 'Luis Romero', sala: 'Salud 2', impresoEn: 'La Popular', cargo: 'Cajero' });
        expect(y).toMatchObject({ nombre: 'Alguien que ya no está en la lista', sala: SIN_SUCURSAL, impresoEn: 'La computadora de quien lo emitió', loEntrego: '—' });
    });
    it('por sala, con «Sin sucursal» al final', () => {
        const g = carnesPorSala([{ sala: SIN_SUCURSAL, nombre: 'Z' }, { sala: 'Salud 2', nombre: 'B' }, { sala: 'Salud 2', nombre: 'A' }, { sala: 'La Popular', nombre: 'C' }]);
        expect(g.map((x) => x.sala)).toEqual(['La Popular', 'Salud 2', SIN_SUCURSAL]);
        expect(g[1].items.map((x) => x.nombre)).toEqual(['A', 'B']);
    });
});

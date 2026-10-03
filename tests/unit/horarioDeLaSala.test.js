import { describe, expect, it } from 'vitest';
import { pesoDeCargo, personasDelHorario } from '@nucleo/utils/horarioDeLaSala';

describe('horarioDeLaSala', () => {
    it('peso del cargo', () => {
        expect(pesoDeCargo('Jefe de Sala')).toBe(1);
        expect(pesoDeCargo('Subjefe')).toBe(2);
        expect(pesoDeCargo('Regente')).toBe(3);
        expect(pesoDeCargo('Dependiente')).toBe(4);
        expect(pesoDeCargo('Bodeguero')).toBe(5);
    });
    it('sólo la planilla activa de la sala, por cargo y nombre', () => {
        const r = personasDelHorario([
            { id: 1, name: 'Zoe', role: 'Dependiente', branch_id: 2, status: 'ACTIVO', tipo_ficha: 'empleado' },
            { id: 2, name: 'Ana', role: 'Jefe de Sala', branch_id: 2, status: 'ACTIVO', tipo_ficha: 'empleado' },
            { id: 3, name: 'Beto', role: 'Dependiente', branch_id: 2, status: 'INACTIVO', tipo_ficha: 'empleado' },
            { id: 4, name: 'Carla', role: 'Dependiente', branch_id: 5, status: 'ACTIVO', tipo_ficha: 'empleado' },
        ], 2);
        expect(r.map((e) => e.id)).toEqual([2, 1]);
    });
});

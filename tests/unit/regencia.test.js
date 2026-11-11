import { describe, it, expect } from 'vitest';
import {
    esQuimicoFarmaceutico, horasMinimasDeRegencia, asignacionesDeRegencia, faltantesDeRegencia,
} from '@nucleo/utils/regencia';

describe('regencia', () => {
    it('reconoce el cargo por id, principal o secundario', () => {
        expect(esQuimicoFarmaceutico({ role_id: 8 })).toBe(true);
        expect(esQuimicoFarmaceutico({ role_id: 30, secondary_role_id: '9' })).toBe(true);
        expect(esQuimicoFarmaceutico({ role_id: 23 })).toBe(false); // Regente de Enfermería no es QF
        expect(esQuimicoFarmaceutico(null)).toBe(false);
    });

    it('horas mínimas por categoría', () => {
        expect(horasMinimasDeRegencia('3')).toBe(20);
        expect(horasMinimasDeRegencia(2)).toBe(30);
        expect(horasMinimasDeRegencia('1')).toBe(174);
        expect(horasMinimasDeRegencia(undefined)).toBeNull();
    });

    it('un regente en varias salas suma sus horas', () => {
        const m = asignacionesDeRegencia([
            { id: 4, name: 'Salud 1', settings: { legal: { regentEmployeeId: 'a', regentHorasMes: 20, srsCategoria: '3', pharmacovigilanceEmployeeId: 'a' } } },
            { id: 25, name: 'Salud 2', settings: { legal: { regentEmployeeId: 'a', regentHorasMes: '25', srsCategoria: '3' } } },
            { id: 27, name: 'Salud 3', settings: { legal: {} } },
        ]);
        expect(m.get('a').regente.map((r) => r.nombre)).toEqual(['Salud 1', 'Salud 2']);
        expect(m.get('a').horasMes).toBe(45);
        expect(m.get('a').farmacovigilancia).toHaveLength(1);
    });

    it('dice qué le falta a una sala', () => {
        expect(faltantesDeRegencia({ settings: { legal: {} } }))
            .toEqual(['Sin regente asignado', 'Sin referente de farmacovigilancia']);
        expect(faltantesDeRegencia({ settings: { legal: { regentEmployeeId: 'a', regentHorasMes: 10, srsCategoria: '3', pharmacovigilanceEmployeeId: 'b' } } }))
            .toEqual(['El regente cubre 10 h al mes; la categoría pide 20']);
        expect(faltantesDeRegencia({ settings: { legal: { regentEmployeeId: 'a', regentHorasMes: 20, srsCategoria: '3', pharmacovigilanceEmployeeId: 'b' } } }))
            .toEqual([]);
    });
});

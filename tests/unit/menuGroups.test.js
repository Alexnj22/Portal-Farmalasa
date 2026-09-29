import { describe, expect, it } from 'vitest';
import { MENU_GROUPS, gruposVisibles } from '@nucleo/constants/menuGroups';
import { MODULE_MAP } from '@nucleo/constants/moduleMap';

const con = (...claves) => (k) => claves.includes(k);

describe('gruposVisibles', () => {
    it('sólo deja los grupos con algún módulo permitido, en el orden declarado', () => {
        const g = gruposVisibles(MENU_GROUPS, MODULE_MAP, con('bitacoras', 'requests', 'traslados'));
        expect(g.map((x) => x.key)).toEqual(['solicitudes', 'bitacoras']);
        expect(g[0].visibleModules.map((m) => m.key)).toEqual(['requests', 'traslados']);
    });

    it('dos módulos con la misma ruta son una sola entrada (gana el primero del grupo)', () => {
        const g = gruposVisibles(MENU_GROUPS, MODULE_MAP, con('caja_vales', 'cortes_caja'));
        expect(g[0].visibleModules.map((m) => m.key)).toEqual(['caja_vales']);
        const soloCortes = gruposVisibles(MENU_GROUPS, MODULE_MAP, con('cortes_caja'));
        expect(soloCortes[0].visibleModules.map((m) => m.key)).toEqual(['cortes_caja']);
    });

    it('un «próximamente» no abre un grupo por sí solo', () => {
        expect(gruposVisibles(MENU_GROUPS, MODULE_MAP, con('entrevistas'))).toEqual([]);
    });

    it('todo módulo de un grupo existe en el catálogo', () => {
        for (const g of MENU_GROUPS) for (const k of g.modules) expect(MODULE_MAP[k], k).toBeTruthy();
    });
});

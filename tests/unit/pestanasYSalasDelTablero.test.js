// El tablero: en qué pestaña vive cada widget, y en qué orden salen las salas.
//
// Las dos son listas que gobiernan lo que se VE, y las dos ya se rompieron por
// el mismo motivo: existían dos veces. `dashboardTabs` vive fuera de la vista
// porque lo leen el tablero Y Permisos; `salas.js` nació el día que el buscador
// se partió en dos archivos y había que elegir entre duplicar el orden de las
// salas o cerrar un ciclo entre ellos.

import { describe, it, expect } from 'vitest';
import { PESTANAS_TEMATICAS, catalogoDePestana, hospedaBaldosasDeSucursal, tematicaDe }
    from '../../src/constants/dashboardTabs';
import { ERP_BRANCH_MAP, BRANCH_ORDER, MI_ERP_POR_BRANCH }
    from '../../src/views/dashboard/inventario/salas';

describe('qué widget vive en qué pestaña', () => {
    it('son tres temáticas; general no se declara porque es todo el catálogo', () => {
        expect(Object.keys(PESTANAS_TEMATICAS).sort()).toEqual(['comercial', 'operacion', 'rrhh']);
        expect(PESTANAS_TEMATICAS.general).toBeUndefined();
    });

    it('general devuelve el catálogo entero, no una lista propia', () => {
        const todos = ['kpi', 'sales', 'inv_search', 'lo_que_sea'];
        expect(catalogoDePestana('general', todos)).toEqual(todos);
    });

    it('una temática devuelve su lista y no le importa el catálogo', () => {
        expect(catalogoDePestana('comercial', ['nada'])).toBe(PESTANAS_TEMATICAS.comercial);
    });

    it('una pestaña que no existe devuelve vacío, nunca undefined', () => {
        // Un `undefined` acá reventaría el `.map` que arma la rejilla.
        expect(catalogoDePestana('inventada', ['x'])).toEqual([]);
    });
});

describe('`kpi` está en dos pestañas a propósito', () => {
    it('aparece en comercial y en rrhh', () => {
        expect(PESTANAS_TEMATICAS.comercial).toContain('kpi');
        expect(PESTANAS_TEMATICAS.rrhh).toContain('kpi');
    });

    it('y por eso NO pertenece a ninguna', () => {
        // No es un widget de la rejilla: se pinta aparte, arriba de todo. En
        // Permisos cada widget tiene que aparecer UNA vez — dos interruptores
        // del mismo permiso no se pueden leer.
        expect(tematicaDe('kpi')).toBeNull();
    });

    it('un widget de una sola lista sí pertenece a ella', () => {
        expect(tematicaDe('meta_sala')).toBe('comercial');
        expect(tematicaDe('bitacoras')).toBe('operacion');
        expect(tematicaDe('birthdays')).toBe('rrhh');
    });

    it('uno que no está en ninguna lista tampoco pertenece', () => {
        expect(tematicaDe('no_existe')).toBeNull();
    });
});

describe('las baldosas por sucursal siguen al widget del que dependen', () => {
    it('salen en general y en la pestaña que tenga `sales`', () => {
        // Sus ids son DINÁMICOS —uno por sucursal con ventas— así que no pueden
        // estar en una lista fija. Reportado por el usuario: «¿por qué los de
        // ventas por sucursal no salen? ¿ni en comercial?».
        expect(hospedaBaldosasDeSucursal('general')).toBe(true);
        expect(hospedaBaldosasDeSucursal('comercial')).toBe(true);
    });

    it('no salen donde `sales` no está', () => {
        expect(hospedaBaldosasDeSucursal('rrhh')).toBe(false);
        expect(hospedaBaldosasDeSucursal('operacion')).toBe(false);
    });

    it('la regla ES «donde va `sales`», no una lista aparte', () => {
        // Escrito así, el día que `sales` cambie de categoría las baldosas lo
        // siguen sin que nadie tenga que acordarse.
        for (const [tab, ids] of Object.entries(PESTANAS_TEMATICAS))
            expect(hospedaBaldosasDeSucursal(tab)).toBe(ids.includes('sales'));
    });
});

describe('el orden de las salas del buscador', () => {
    it('Bodega SIEMPRE primero', () => {
        // Pedido del usuario (2026-08-07). Venía última, con el orden de
        // despacho del resto del tablero, y acá ese orden no aplica: esta
        // pantalla no reparte, contesta «dónde hay». Lo primero que se mira
        // antes de pedirle a otra sala es si Bodega lo tiene.
        expect(BRANCH_ORDER[0]).toBe(6);
        expect(ERP_BRANCH_MAP[6]).toBe('Bodega');
    });

    it('están las siete y ninguna repetida', () => {
        expect(BRANCH_ORDER).toHaveLength(7);
        expect(new Set(BRANCH_ORDER).size).toBe(7);
        for (const id of BRANCH_ORDER) expect(ERP_BRANCH_MAP[id]).toBeTruthy();
    });

    it('el orden nombra exactamente a las salas que el mapa conoce', () => {
        expect([...BRANCH_ORDER].sort()).toEqual(Object.keys(ERP_BRANCH_MAP).map(Number).sort());
    });
});

describe('la sala del portal y la del sistema de origen son numeraciones distintas', () => {
    it('ninguna sala se llama igual en las dos', () => {
        // Confundirlas apunta a otra sala sin dar error. Sólo dos coinciden por
        // casualidad, y ese es justamente el motivo por el que un error así
        // sobrevive: funciona en algunos casos.
        const pares = Object.entries(MI_ERP_POR_BRANCH).map(([b, e]) => [Number(b), e]);
        expect(pares.filter(([b, e]) => b === e)).toEqual([]);
    });

    it('cada destino existe en el mapa de salas, y no hay dos apuntando al mismo', () => {
        const destinos = Object.values(MI_ERP_POR_BRANCH);
        expect(new Set(destinos).size).toBe(destinos.length);
        for (const d of destinos) expect(ERP_BRANCH_MAP[d]).toBeTruthy();
    });

    it('cubre las siete salas', () => {
        expect(Object.keys(MI_ERP_POR_BRANCH)).toHaveLength(7);
    });
});

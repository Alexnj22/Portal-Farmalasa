// Escrituras que dejan su propia entrada en la bitácora (D3: la anota la
// función que guarda, así el portal y la app del teléfono la heredan).
//
// Estas seis no dejaban rastro —el barrido de la auditoría las marcaba como
// `escritura-sin-bitacora`—: el arrastre de un cambio de permiso, crear una
// categoría, cambiar la foto de un producto, arrancar una ruta en el mismo
// clic en que se crea, fijar las hojas de una sala y cerrar la quincena. Se
// prueba lo que importa: que se anota con la acción y el detalle correctos,
// que NO se anota lo que no entró, y que la anotación nunca rompe la acción.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Un cliente de Supabase mínimo: registra cada escritura y cada entrada de la
// bitácora (`registrar_bitacora`), y responde lo que la prueba le pida.
const estado = { escrituras: [], anotaciones: [], respuesta: null, bitacoraRota: false };

function cadena(tabla) {
    const paso = { tabla, ops: [] };
    estado.escrituras.push(paso);
    const nodo = {
        then: (ok, ko) => Promise.resolve(estado.respuesta ?? { data: [{ id: 1 }], error: null }).then(ok, ko),
    };
    for (const m of ['insert', 'update', 'upsert', 'delete', 'select', 'eq', 'in']) {
        nodo[m] = (...args) => { paso.ops.push([m, ...args]); return nodo; };
    }
    return nodo;
}

vi.mock('@nucleo/supabaseClient', () => ({
    supabase: {
        from: (tabla) => cadena(tabla),
        rpc: async (nombre, p) => {
            if (nombre !== 'registrar_bitacora') return { data: null, error: null };
            if (estado.bitacoraRota) return { data: null, error: new Error('permission denied for audit_logs') };
            estado.anotaciones.push({ accion: p.p_action, target: p.p_target_id, detalle: p.p_details });
            return { data: { id: 1 }, error: null };
        },
    },
}));

const { guardarArrastreDePermiso } = await import('@nucleo/data/permissions');
const { insertProductCategory, updateProductFoto } = await import('@nucleo/data/productos');
const { completarRutaRecienCreada, guardarPaginasDeSala } = await import('@nucleo/data/pedidos');
const { closeQuincenaTimesheets } = await import('@nucleo/data/attendanceAudit');

// `conBitacora` anota por detrás, sin demorar la respuesta: se espera un tick.
const asentar = () => new Promise(r => setTimeout(r, 0));
const ultima = () => estado.anotaciones.at(-1);
const parche = (paso) => paso.ops.find(([m]) => m === 'update')?.[1];

beforeEach(() => {
    estado.escrituras.length = 0;
    estado.anotaciones.length = 0;
    estado.respuesta = null;
    estado.bitacoraRota = false;
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('permisos — lo que arrastra un cambio', () => {
    it('sin nada que arrastrar no escribe ni anota', async () => {
        const r = await guardarArrastreDePermiso(4, { cascada: [], apagadas: [], inicio: null });
        await asentar();
        expect(r.error).toBeNull();
        expect(estado.escrituras).toHaveLength(0);
        expect(estado.anotaciones).toHaveLength(0);
    });

    it('escribe cada tanda y anota UNA entrada con los módulos arrastrados', async () => {
        const plan = {
            cascada: [{ role_id: 4, module_key: 'pedidos_aprobar' }],
            apagadas: [{ role_id: 4, module_key: 'pedidos_editar' }, { role_id: 4, module_key: 'pedidos_rutas' }],
            inicio: { role_id: 4, module_key: 'inicio' },
            principal: { role_id: 4, module_key: 'pedidos' },   // lo guarda otra función: acá se ignora
        };
        await guardarArrastreDePermiso(4, plan, { cargo: 'Regente', desde_modulo: 'pedidos' });
        await asentar();
        expect(estado.escrituras.map(e => e.tabla)).toEqual(['role_permissions', 'role_permissions', 'role_permissions']);
        expect(estado.anotaciones).toHaveLength(1);
        expect(ultima()).toMatchObject({
            accion: 'PERMISOS_ARRASTRE', target: '4',
            detalle: { cargo: 'Regente', desde_modulo: 'pedidos', modulos: ['pedidos_aprobar', 'pedidos_editar', 'pedidos_rutas', 'inicio'] },
        });
    });

    it('si una tanda falla, devuelve el error y el INTENTO queda anotado con él', async () => {
        estado.respuesta = { data: null, error: new Error('violates row-level security') };
        const r = await guardarArrastreDePermiso(4, { cascada: [{ role_id: 4, module_key: 'x' }] });
        await asentar();
        expect(r.error?.message).toMatch(/row-level/);
        expect(ultima()).toMatchObject({ accion: 'PERMISOS_ARRASTRE', detalle: { modulos: ['x'], error: 'violates row-level security' } });
    });
});

describe('productos — categoría y foto', () => {
    it('crear una categoría se anota con su nombre', async () => {
        const r = await insertProductCategory('Dermocosmética');
        await asentar();
        expect(r.error).toBeNull();
        expect(estado.escrituras[0]).toMatchObject({ tabla: 'product_categories', ops: [['insert', { nombre: 'Dermocosmética' }]] });
        expect(ultima()).toMatchObject({ accion: 'CREAR_CATEGORIA_PRODUCTO', detalle: { categoria: 'Dermocosmética' } });
    });

    it('si la base rechaza la categoría, no se anota', async () => {
        estado.respuesta = { data: null, error: new Error('duplicate key') };
        await insertProductCategory('Dermocosmética');
        await asentar();
        expect(estado.anotaciones).toHaveLength(0);
    });

    it('la foto se anota sin la URL, con el producto como objetivo', async () => {
        await updateProductFoto(77, 'https://x/product-photos/77.jpg?t=1', { producto: 'Gasa estéril' });
        await asentar();
        expect(ultima()).toMatchObject({ accion: 'PRODUCTO_FOTO_CAMBIADA', target: '77', detalle: { producto: 'Gasa estéril' } });
        expect(JSON.stringify(ultima().detalle)).not.toContain('product-photos');
    });

    it('una foto que no tocó ninguna fila (RLS) es un error y no se anota', async () => {
        estado.respuesta = { data: [], error: null };
        const r = await updateProductFoto(77, 'https://x/77.jpg');
        await asentar();
        expect(r.error?.message).toMatch(/PERMISSION_DENIED/);
        expect(estado.anotaciones).toHaveLength(0);
    });
});

describe('pedidos — la ruta recién creada y las hojas de la sala', () => {
    it('si sale ahora: la arranca y anota RUTA_INICIADA, marcada como parte de la creación', async () => {
        const visitas = [{ erp_sucursal_id: 5, suc_name: 'Salud 5', orden: 2 }];
        const r = await completarRutaRecienCreada(31, { saleAhora: true, visitas }, { conductor: 'Mario' });
        await asentar();
        expect(r.error).toBeNull();
        const p = parche(estado.escrituras[0]);
        expect(p).toMatchObject({ status: 'en_ruta', visitas });
        expect(Number.isNaN(Date.parse(p.salida_at))).toBe(false);
        expect(ultima()).toMatchObject({ accion: 'RUTA_INICIADA', target: '31', detalle: { al_crear: true, encargos: 1, conductor: 'Mario' } });
    });

    it('si no sale todavía pero lleva encargos, sólo guarda los encargos y lo dice', async () => {
        await completarRutaRecienCreada(31, { saleAhora: false, visitas: [{ erp_sucursal_id: 5 }] });
        await asentar();
        expect(parche(estado.escrituras[0])).toEqual({ visitas: [{ erp_sucursal_id: 5 }] });
        expect(ultima().accion).toBe('RUTA_ENCARGOS_GUARDADOS');
    });

    it('sin salida ni encargos no toca la base', async () => {
        const r = await completarRutaRecienCreada(31, { saleAhora: false, visitas: [] });
        await asentar();
        expect(r).toEqual({ data: null, error: null });
        expect(estado.escrituras).toHaveLength(0);
        expect(estado.anotaciones).toHaveLength(0);
    });

    it('una ruta que el RLS no dejó arrancar devuelve error y no se anota', async () => {
        estado.respuesta = { data: [], error: null };
        const r = await completarRutaRecienCreada(31, { saleAhora: true });
        await asentar();
        expect(r.error).toBeTruthy();
        expect(estado.anotaciones).toHaveLength(0);
    });

    it('las hojas de la sala se anotan con la sucursal y cuántas son', async () => {
        await guardarPaginasDeSala(12, 4, [{ hoja: 1 }, { hoja: 2 }, { hoja: 3 }]);
        await asentar();
        expect(estado.escrituras[0].tabla).toBe('pedido_sucursal_status');
        expect(ultima()).toMatchObject({ accion: 'PEDIDO_HOJAS_GUARDADAS', target: '12', detalle: { sucursal: 4, hojas: 3 } });
    });
});

describe('asistencia — cerrar la quincena', () => {
    it('aprueba los días y anota CERRAR_QUINCENA con la quincena como objetivo', async () => {
        const r = await closeQuincenaTimesheets([1, 2, 3], { quincena: '2026-10-01' });
        await asentar();
        expect(r.error).toBeNull();
        expect(parche(estado.escrituras[0])).toEqual({ status: 'APPROVED' });
        expect(ultima()).toMatchObject({
            accion: 'CERRAR_QUINCENA', target: '2026-10-01',
            detalle: { count: 3, new_value: '3 días aprobados', dimension: 'HR' },
        });
        expect(ultima().detalle).not.toHaveProperty('quincena');
    });

    it('el teléfono puede afinar el texto del detalle', async () => {
        await closeQuincenaTimesheets([1], { quincena: '2026-10-16', new_value: '1 días aprobados de Salud 2', desde: 'app' });
        await asentar();
        expect(ultima().detalle).toMatchObject({ new_value: '1 días aprobados de Salud 2', desde: 'app' });
    });

    it('si la bitácora falla, la quincena igual queda cerrada', async () => {
        estado.bitacoraRota = true;
        const r = await closeQuincenaTimesheets([1, 2], { quincena: '2026-10-01' });
        await asentar();
        expect(r.error).toBeNull();
        expect(estado.escrituras).toHaveLength(1);
    });
});

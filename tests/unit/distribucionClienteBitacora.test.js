// La ficha de un cliente de Distribución se anota sola en la bitácora.
//
// `guardarCliente` escribía en `dist_clientes` sin dejar rastro: el barrido de
// la auditoría la marcaba como `escritura-sin-bitacora`. Se prueba lo que
// importa: que el alta y la edición se anotan con su acción, que NO se anota
// lo que no entró, que el detalle no lleva el documento del cliente, y que una
// bitácora rota nunca rompe el guardado.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const estado = { escrituras: [], anotaciones: [], respuesta: null, bitacoraRota: false };

function cadena(tabla) {
    const paso = { tabla, ops: [] };
    estado.escrituras.push(paso);
    const nodo = {
        then: (ok, ko) => Promise.resolve(estado.respuesta ?? { data: { id: 77 }, error: null }).then(ok, ko),
    };
    for (const m of ['insert', 'update', 'select', 'eq', 'single']) {
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

const { guardarCliente } = await import('@nucleo/data/distribucion');

const asentar = () => new Promise(r => setTimeout(r, 0));
const FICHA = { nombre: 'FARMACIA LA ESPERANZA', nit: '06141234567890', dui: '012345678', nrc: '1234567', tipo: 'farmacia' };

beforeEach(() => {
    estado.escrituras.length = 0;
    estado.anotaciones.length = 0;
    estado.respuesta = null;
    estado.bitacoraRota = false;
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('distribución — guardar la ficha de un cliente', () => {
    it('un alta se anota con el id nuevo y su nombre', async () => {
        const id = await guardarCliente({ ...FICHA });
        await asentar();
        expect(id).toBe(77);
        expect(estado.escrituras[0].ops[0][0]).toBe('insert');
        expect(estado.anotaciones).toHaveLength(1);
        expect(estado.anotaciones[0]).toMatchObject({
            accion: 'DISTRIBUCION_CLIENTE_ALTA', target: '77',
            detalle: expect.objectContaining({ cliente: 'FARMACIA LA ESPERANZA', operacion: 'alta' }),
        });
    });

    it('una edición se anota sobre el id existente', async () => {
        const id = await guardarCliente({ id: 12, ...FICHA, created_at: 'x', updated_at: 'y', contribuyente: true });
        await asentar();
        expect(id).toBe(12);
        expect(estado.escrituras[0].ops[0][0]).toBe('update');
        expect(estado.anotaciones[0]).toMatchObject({
            accion: 'DISTRIBUCION_CLIENTE_EDITAR', target: '12',
            detalle: expect.objectContaining({ operacion: 'edicion' }),
        });
    });

    it('el detalle no lleva el NIT, el DUI ni el NRC', async () => {
        await guardarCliente({ ...FICHA });
        await asentar();
        const texto = JSON.stringify(estado.anotaciones[0].detalle);
        for (const doc of [FICHA.nit, FICHA.dui, FICHA.nrc]) expect(texto).not.toContain(doc);
    });

    it('lo que la base rechaza no se anota', async () => {
        estado.respuesta = { data: null, error: new Error('dist_clientes_documento_unico') };
        await expect(guardarCliente({ ...FICHA })).rejects.toThrow('dist_clientes_documento_unico');
        await expect(guardarCliente({ id: 12, ...FICHA })).rejects.toThrow();
        await asentar();
        expect(estado.anotaciones).toHaveLength(0);
    });

    it('una bitácora rota no rompe el guardado', async () => {
        estado.bitacoraRota = true;
        await expect(guardarCliente({ ...FICHA })).resolves.toBe(77);
        await asentar();
        expect(estado.anotaciones).toHaveLength(0);
    });
});

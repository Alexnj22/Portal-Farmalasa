import { describe, it, expect, vi, beforeEach } from 'vitest';

// Un supabase de mentira que anota cada llamada: lo que importa acá es QUÉ se
// le pide a la base, no lo que contesta.
const llamadas = [];
function consulta(tabla) {
    const q = { tabla, ops: [] };
    const cadena = new Proxy({}, {
        get(_, op) {
            if (op === 'then') return (res) => { llamadas.push(q); return Promise.resolve({ data: q.respuesta ?? [], error: null }).then(res); };
            return (...args) => { q.ops.push([op, ...args]); return cadena; };
        },
    });
    return cadena;
}
vi.mock('@nucleo/supabaseClient', () => ({
    supabase: { from: (t) => consulta(t), rpc: vi.fn(async () => ({ data: null, error: null })) },
}));
vi.mock('@nucleo/data/audit', () => ({ anotar: vi.fn() }));

const { guardarSucursales, guardarDiseno } = await import('@nucleo/data/encuestasClientes');
const { anotar } = await import('@nucleo/data/audit');

beforeEach(() => { llamadas.length = 0; vi.clearAllMocks(); });

const ops = (q, nombre) => q.ops.filter(([op]) => op === nombre);

describe('guardarSucursales — el QR impreso no puede cambiar', () => {
    it('una sucursal que sigue se ACTUALIZA, no se borra y recrea (conserva su token)', async () => {
        await guardarSucursales('e1', [{ branch_id: 4, meta: 50 }], [{ branch_id: 4, meta: 30 }]);
        expect(llamadas).toHaveLength(1);
        expect(ops(llamadas[0], 'update')[0][1]).toEqual({ meta: 50 });
        expect(llamadas.some((q) => ops(q, 'delete').length || ops(q, 'insert').length)).toBe(false);
    });
    it('sólo agrega las nuevas y sólo quita las que salieron', async () => {
        await guardarSucursales('e1', [{ branch_id: 4, meta: null }, { branch_id: 25, meta: null }],
            [{ branch_id: 4, meta: null }, { branch_id: 27, meta: null }]);
        const borrar = llamadas.find((q) => ops(q, 'delete').length);
        const insertar = llamadas.find((q) => ops(q, 'insert').length);
        expect(ops(borrar, 'in')[0]).toEqual(['in', 'branch_id', [27]]);
        expect(ops(insertar, 'insert')[0][1]).toEqual([{ encuesta_id: 'e1', branch_id: 25, meta: null }]);
        expect(llamadas.some((q) => ops(q, 'update').length)).toBe(false);
    });
    it('sin cambios no escribe ni anota nada', async () => {
        await guardarSucursales('e1', [{ branch_id: 4, meta: 10 }], [{ branch_id: 4, meta: 10 }]);
        expect(llamadas).toHaveLength(0);
        expect(anotar).not.toHaveBeenCalled();
    });
    it('un cambio real queda en la bitácora', async () => {
        await guardarSucursales('e1', [{ branch_id: 25, meta: null }], []);
        expect(anotar).toHaveBeenCalledWith('ENCUESTA_CLIENTE_SUCURSALES', 'e1', expect.objectContaining({ agregadas: [25] }));
    });
});

describe('guardarDiseno — sólo viajan los campos del diseño', () => {
    it('descarta lo que no es diseño (estado, firmas)', async () => {
        await guardarDiseno('e1', { nombre: 'X', estado: 'aprobada', aprobada_por: 'yo' });
        expect(ops(llamadas[0], 'update')[0][1]).toEqual({ nombre: 'X' });
    });
    it('sin campos de diseño no llama a la base', async () => {
        expect(await guardarDiseno('e1', { estado: 'publicada' })).toBeNull();
        expect(llamadas).toHaveLength(0);
    });
});

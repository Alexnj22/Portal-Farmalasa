import { describe, expect, it, vi, beforeEach } from 'vitest';

// Tres capas de datos de la app de clientes vistas desde el portal: la vitrina
// (ofertas, historias, banners, pre-registros), el horario real de las salas
// que decide los mensajes automáticos del chat, y los clientes mayoristas.
// Lo que importa: la fila que viaja (sólo los campos permitidos), que una
// escritura sin permiso —cero filas, sin error— se diga, y que lo hecho quede
// en la bitácora.

const pedidas = [];
let responder = () => ({ data: [], error: null });
const firmar = vi.fn();
const quitar = vi.fn(async () => ({ error: null }));
vi.mock('@nucleo/supabaseClient', () => {
    const cadena = (tabla) => {
        const q = { tabla, ops: [] };
        const p = new Proxy({}, {
            get(_, op) {
                if (op === 'then') return (res, rej) => { pedidas.push(q); return Promise.resolve(responder(q)).then(res, rej); };
                return (...a) => { q.ops.push([op, ...a]); return p; };
            },
        });
        return p;
    };
    return { supabase: {
        from: cadena,
        rpc: vi.fn(async () => ({ data: null, error: null })),
        storage: { from: () => ({ createSignedUrls: (...a) => firmar(...a), remove: (...a) => quitar(...a) }) },
    } };
});
vi.mock('@nucleo/data/audit', () => ({ anotar: vi.fn() }));

const ofertas = await import('@nucleo/data/ofertasClientes');
const horarios = await import('@nucleo/data/horarios');
const mayoristas = await import('@nucleo/data/mayoristas');
const { anotar } = await import('@nucleo/data/audit');
const { supabase } = await import('@nucleo/supabaseClient');

beforeEach(() => { pedidas.length = 0; vi.clearAllMocks(); responder = () => ({ data: [], error: null }); });
const op = (q, nombre) => q.ops.find(([o]) => o === nombre);

describe('ofertas para clientes', () => {
    it('guardar sólo manda los campos de la oferta (nada de id, fechas de sistema ni lo que traiga la pantalla)', async () => {
        responder = () => ({ data: { id: 'o1' }, error: null });
        const id = await ofertas.guardarOferta(null, { titulo: '2x1', exclusiva: true, nivel_minimo: 'oro', imagen_url: 'firmada', id: 'x', updated_at: 'y' });
        expect(id).toBe('o1');
        expect(op(pedidas[0], 'insert')[1]).toEqual({ titulo: '2x1', exclusiva: true, nivel_minimo: 'oro' });
        expect(anotar).toHaveBeenCalledWith('OFERTA_CLIENTE_CREAR', 'o1', { titulo: '2x1', exclusiva: true, nivel_minimo: 'oro' });
    });

    it('la lista firma las imágenes en UNA llamada; sin imagen no firma', async () => {
        responder = () => ({ data: [{ id: 1, imagen_path: 'a.jpg' }, { id: 2, imagen_path: null }], error: null });
        firmar.mockResolvedValueOnce({ data: [{ path: 'a.jpg', signedUrl: 'https://f/a' }], error: null });
        const r = await ofertas.fetchOfertas();
        expect(firmar).toHaveBeenCalledTimes(1);
        expect(firmar.mock.calls[0][0]).toEqual(['a.jpg']);
        expect(r.map((f) => f.imagen_url)).toEqual(['https://f/a', null]);
    });

    it('si la firma falla la lista igual llega (sin vista previa)', async () => {
        const consola = vi.spyOn(console, 'error').mockImplementation(() => {});
        responder = () => ({ data: [{ id: 1, imagen_path: 'a.jpg' }], error: null });
        firmar.mockResolvedValueOnce({ data: null, error: new Error('x') });
        expect(await ofertas.fetchOfertas()).toEqual([{ id: 1, imagen_path: 'a.jpg' }]);
        consola.mockRestore();
    });

    it('borrar se lleva la imagen del bucket y queda anotado', async () => {
        responder = () => ({ data: { id: 'o1' }, error: null });
        await ofertas.borrarOferta({ id: 'o1', titulo: 'X', imagen_path: '2026-10/a.jpg' });
        expect(quitar).toHaveBeenCalledWith(['2026-10/a.jpg']);
        expect(anotar).toHaveBeenCalledWith('OFERTA_CLIENTE_BORRAR', 'o1', { titulo: 'X' });
    });

    it('publicar sin permiso lanza (el .single() sin fila es error) y no se anota', async () => {
        responder = () => ({ data: null, error: new Error('0 rows') });
        await expect(ofertas.publicarOferta('o1', true)).rejects.toThrow();
        expect(anotar).not.toHaveBeenCalled();
    });

    it('historias y banners también filtran sus campos', async () => {
        responder = () => ({ data: { id: 'h1' }, error: null });
        await ofertas.guardarHistoria('h1', { titulo: 'T', oferta_id: 3, cosa: 1 });
        expect(op(pedidas[0], 'update')[1]).toMatchObject({ titulo: 'T', oferta_id: 3 });
        expect(op(pedidas[0], 'update')[1]).not.toHaveProperty('cosa');
        await ofertas.guardarBanner(null, { titulo: 'B', titulo_visible: false, otra: 2 });
        expect(op(pedidas[1], 'insert')[1]).toEqual({ titulo: 'B', titulo_visible: false });
    });
});

describe('pre-registros y fichas por documento', () => {
    it('el documento se busca limpio y en mayúsculas; uno corto no consulta', async () => {
        expect(await ofertas.fetchPreregistroPorDocumento('12-3')).toEqual([]);
        expect(pedidas).toHaveLength(0);
        await ofertas.fetchPreregistroPorDocumento('a1234567-8');
        expect(pedidas[0].ops).toContainEqual(['eq', 'documento', 'A12345678']);
        expect(pedidas[0].ops).toContainEqual(['eq', 'estado', 'pendiente']);
    });

    it('las fichas se buscan por documento, nunca por nombre, y el filtro no deja pasar caracteres de PostgREST', async () => {
        await ofertas.buscarFichasPorDocumento('01234567-8,name.ilike.*');
        const filtro = op(pedidas[0], 'or')[1];
        // La coma, el punto y el asterisco no llegan: siguen siendo cuatro
        // condiciones, todas sobre columnas de documento.
        expect(filtro.split(',').map((c) => c.split('.')[0])).toEqual(['ids_busq', 'dui', 'nit', 'pasaporte']);
        expect(filtro).not.toMatch(/\*/);
        expect(filtro).toMatch(/^ids_busq\.ilike\.%012345678nameilike%,dui\.eq\.012345678nameilike,/);
    });

    it('resolver va por la función de la base', async () => {
        await ofertas.resolverPreregistro(4, 'vincular', 9);
        expect(supabase.rpc).toHaveBeenCalledWith('app_preregistro_resolver', { p_id: 4, p_accion: 'vincular', p_customer_id: 9 });
    });
});

describe('horario de las salas y mensajes del chat', () => {
    it('guardar los mensajes sin permiso (cero filas) es un error explícito y no se anota', async () => {
        responder = () => ({ data: [], error: null });
        await expect(horarios.guardarAjustesDelChat({ mensajeAbierto: ' a ', mensajeCerrado: 'b', employeeId: 'e1' })).rejects.toThrow('permiso');
        expect(anotar).not.toHaveBeenCalled();
    });

    it('con permiso guarda recortado y anota el largo, no el texto', async () => {
        responder = () => ({ data: [{ mensaje_abierto: 'a' }], error: null });
        await horarios.guardarAjustesDelChat({ mensajeAbierto: ' hola ', mensajeCerrado: 'chao', employeeId: 'e1' });
        expect(op(pedidas[0], 'update')[1]).toMatchObject({ mensaje_abierto: 'hola', mensaje_cerrado: 'chao', updated_by: 'e1' });
        expect(anotar).toHaveBeenCalledWith('CHAT_AJUSTES_MENSAJES', 'app_chat_ajustes', { largo_abierto: 4, largo_cerrado: 4 });
    });

    it('un día que ya tenía horario especial se ACTUALIZA, no se borra y recrea', async () => {
        responder = (q) => (op(q, 'maybeSingle') && !op(q, 'update') ? { data: { id: 77 }, error: null } : { data: { id: 77 }, error: null });
        await horarios.guardarHorarioEspecial({ branchId: '4', fecha: '2026-12-24', cerrada: false, abre: '08:00', cierra: '14:00', motivo: ' Nochebuena ', employeeId: 'e1' });
        expect(pedidas).toHaveLength(2);
        expect(op(pedidas[1], 'update')[1]).toEqual({ branch_id: 4, fecha: '2026-12-24', cerrada: false, abre: '08:00', cierra: '14:00', motivo: 'Nochebuena' });
        expect(op(pedidas[1], 'eq')).toEqual(['eq', 'id', 77]);
        expect(pedidas.some((q) => op(q, 'insert') || op(q, 'delete'))).toBe(false);
        expect(anotar).toHaveBeenCalledWith('SUCURSAL_HORARIO_ESPECIAL_GUARDAR', '4', expect.objectContaining({ fecha: '2026-12-24' }));
    });

    it('un día nuevo se inserta firmado por quien lo carga; cerrada no lleva horas', async () => {
        let n = 0;
        responder = () => (n++ === 0 ? { data: null, error: null } : { data: { id: 1 }, error: null });
        await horarios.guardarHorarioEspecial({ branchId: 4, fecha: '2026-12-25', cerrada: true, abre: '08:00', cierra: '12:00', motivo: '', employeeId: 'e1' });
        expect(op(pedidas[1], 'insert')[1]).toEqual({ branch_id: 4, fecha: '2026-12-25', cerrada: true, abre: null, cierra: null, motivo: null, creado_por: 'e1' });
    });

    it('sin permiso para actualizar (null) lo dice', async () => {
        let n = 0;
        responder = () => (n++ === 0 ? { data: { id: 5 }, error: null } : { data: null, error: null });
        await expect(horarios.guardarHorarioEspecial({ branchId: 4, fecha: '2026-12-25', cerrada: true, employeeId: 'e1' })).rejects.toThrow('permiso');
        expect(anotar).not.toHaveBeenCalled();
    });

    it('borrar sin permiso (cero filas) lo dice', async () => {
        responder = () => ({ data: [], error: null });
        await expect(horarios.borrarHorarioEspecial({ id: 1, branchId: 4, fecha: 'x' })).rejects.toThrow('permiso');
    });

    it('los feriados que se leen son sólo los nacionales', async () => {
        await horarios.fetchFeriadosNacionales();
        expect(pedidas[0].ops).toContainEqual(['is', 'municipality', null]);
    });
});

describe('clientes mayoristas', () => {
    it('los rangos suben de menos a más compra y de menos a más puntos', () => {
        const r = Object.values(mayoristas.RANGOS);
        for (let i = 1; i < r.length; i++) {
            expect(r[i].desde).toBeGreaterThan(r[i - 1].desde);
            expect(r[i].puntos).toBeGreaterThan(r[i - 1].puntos);
        }
        expect(r[0].desde).toBe(0);
    });

    it('cada estado tiene rótulo para la pantalla', () => {
        for (const e of ['solicitado', 'aprobado', 'rechazado', 'retirado', 'descartado']) expect(mayoristas.ESTADOS[e].label).toBeTruthy();
    });

    it('resolver manda el cliente como número y nulls donde no hay precio', async () => {
        await mayoristas.resolverMayorista('31', 'retirar');
        expect(supabase.rpc).toHaveBeenCalledWith('mayorista_resolver', { p_customer: 31, p_accion: 'retirar', p_precio: null, p_nota: '' });
        await mayoristas.proponerMayorista('31', 'mayoreo_plus');
        expect(supabase.rpc).toHaveBeenLastCalledWith('mayorista_proponer', { p_customer: 31, p_precio: 'mayoreo_plus', p_nota: '' });
    });

    it('las solicitudes por decidir son sólo las «solicitado», la más vieja primero', async () => {
        await mayoristas.fetchSolicitudesMayorista();
        expect(pedidas[0].ops).toContainEqual(['eq', 'estado', 'solicitado']);
        expect(pedidas[0].ops).toContainEqual(['order', 'solicitado_at', { ascending: true }]);
    });

    it('un error de la base se lanza', async () => {
        supabase.rpc.mockResolvedValueOnce({ data: null, error: new Error('FORBIDDEN') });
        await expect(mayoristas.fetchMayoristas()).rejects.toThrow('FORBIDDEN');
    });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// La capa de datos del planificador de marketing. Un supabase de mentira que
// anota QUÉ se le pide a la base y contesta lo que cada prueba le dice: lo que
// importa es la fila que viaja, la ruta del bucket y que una escritura que no
// tocó nada se diga como error, no como éxito.

const llamadas = [];
let responder = () => ({ data: null, error: null });
function consulta(tabla) {
    const q = { tabla, ops: [] };
    const cadena = new Proxy({}, {
        get(_, op) {
            if (op === 'then') return (res, rej) => { llamadas.push(q); return Promise.resolve(responder(q)).then(res, rej); };
            return (...args) => { q.ops.push([op, ...args]); return cadena; };
        },
    });
    return cadena;
}
const quitados = [];
let errorAlQuitar = null;
vi.mock('@nucleo/supabaseClient', () => ({
    supabase: {
        from: (t) => consulta(t),
        rpc: vi.fn(async () => ({ data: { version: 3 }, error: null })),
        storage: { from: (b) => ({ remove: async (rutas) => { quitados.push([b, rutas]); return { error: errorAlQuitar }; } }) },
    },
}));
vi.mock('@nucleo/data/audit', () => ({ anotar: vi.fn() }));
vi.mock('@nucleo/utils/storageFiles', () => ({
    subirArchivo: vi.fn(async (bucket, path) => `https://x.supabase.co/storage/v1/object/public/${bucket}/${path}`),
    signPhotosDeep: vi.fn(async (x) => x),
    signStorageUrls: vi.fn(async (urls) => new Map(urls.map((u) => [u, `${u}?firmada`]))),
}));

const datos = await import('@nucleo/data/marketing');
const { anotar } = await import('@nucleo/data/audit');
const { supabase } = await import('@nucleo/supabaseClient');
const { subirArchivo, signStorageUrls } = await import('@nucleo/utils/storageFiles');

beforeEach(() => {
    llamadas.length = 0; quitados.length = 0; errorAlQuitar = null;
    responder = () => ({ data: null, error: null });
    vi.clearAllMocks();
});
const op = (q, nombre) => q.ops.find(([o]) => o === nombre);

describe('las piezas', () => {
    it('guardar limpia la fila: vacíos a null, título recortado y nada fuera de la lista', async () => {
        responder = () => ({ data: { id: 'p1', titulo: 'Día del padre' }, error: null });
        await datos.guardarPieza('m1', { titulo: '  Día del padre ', hora: '', copy: 'hola', estado: 'pendiente', aprobado_por: 'yo', revisado_at: 'x' });
        const fila = op(llamadas[0], 'insert')[1];
        expect(fila).toEqual({ titulo: 'Día del padre', hora: null, copy: 'hola', estado: 'pendiente', mes_id: 'm1' });
        expect(anotar).toHaveBeenCalledWith('MARKETING_PIEZA_CREAR', 'p1', expect.objectContaining({ titulo: 'Día del padre' }));
    });

    it('con id actualiza esa pieza y no inserta', async () => {
        responder = () => ({ data: { id: 'p1' }, error: null });
        await datos.guardarPieza('m1', { id: 'p1', titulo: 'X' });
        expect(op(llamadas[0], 'update')[1]).toEqual({ titulo: 'X' });
        expect(op(llamadas[0], 'eq')).toEqual(['eq', 'id', 'p1']);
        expect(op(llamadas[0], 'insert')).toBeUndefined();
        expect(anotar).toHaveBeenCalledWith('MARKETING_PIEZA_EDITAR', 'p1', expect.any(Object));
    });

    it('un error de la base se lanza y no queda anotado como hecho', async () => {
        responder = () => ({ data: null, error: new Error('Sólo quien creó la pieza la mueve') });
        await expect(datos.moverPieza('p1', { estado: 'en_proceso' })).rejects.toThrow('Sólo quien creó');
        expect(anotar).not.toHaveBeenCalled();
    });

    it('borrar una pieza que la policy no deja es un error, no un éxito de cero filas', async () => {
        responder = () => ({ data: null, error: null, count: 0 });
        await expect(datos.borrarPieza('p1', 'X', [])).rejects.toThrow('Sólo quien creó la pieza puede quitarla');
        expect(quitados).toHaveLength(0);
        expect(anotar).not.toHaveBeenCalled();
    });

    it('al borrarla se llevan sus archivos del bucket, con la ruta decodificada y sin la firma', async () => {
        responder = () => ({ data: null, error: null, count: 1 });
        const url = 'https://x.supabase.co/storage/v1/object/public/marketing/m1/p1/123-D%C3%ADa.png?token=abc';
        await datos.borrarPieza('p1', 'X', [{ url }, { enlace: 'https://drive' }]);
        expect(quitados).toEqual([['marketing', ['m1/p1/123-Día.png']]]);
        expect(anotar).toHaveBeenCalledWith('MARKETING_PIEZA_BORRAR', 'p1', { titulo: 'X', archivos: 1 });
    });

    it('si el bucket no se deja borrar no lanza (la fila ya se fue) pero lo deja en la consola', async () => {
        responder = () => ({ data: null, error: null, count: 1 });
        errorAlQuitar = { message: 'denegado' };
        const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await datos.borrarPieza('p1', 'X', [{ url: 'https://x/storage/v1/object/public/marketing/a/b/c.png' }]);
        expect(aviso).toHaveBeenCalled();
        expect(anotar).toHaveBeenCalled();
        aviso.mockRestore();
    });

    it('la lista: la pauta siempre objeto, versiones al día y archivos por orden', async () => {
        responder = () => ({ data: [{
            id: 'p1', pauta: [{ presupuesto: 10 }],
            archivos: [
                { id: 'v2', anterior_id: 'v1', orden: 0, created_at: '2026-10-02', reemplazado: false },
                { id: 'v1', anterior_id: null, orden: 0, created_at: '2026-10-01', reemplazado: false },
                { id: 'z', anterior_id: null, orden: 1, created_at: '2026-09-30', reemplazado: false },
            ],
        }, { id: 'p2', pauta: [], archivos: [] }], error: null });
        const [p1, p2] = await datos.fetchPiezas('m1');
        expect(p1.pauta).toEqual({ presupuesto: 10 });
        expect(p2.pauta).toBeNull();
        expect(p1.archivos.map((a) => a.id)).toEqual(['v1', 'v2', 'z']);
        // La V1 tiene sucesora: queda retirada aunque la base la mande viva (H32).
        expect(p1.archivos.find((a) => a.id === 'v1').reemplazado).toBe(true);
    });
});

describe('los diseños', () => {
    it('sube a <mes>/<pieza>/ con un nombre sin tildes ni espacios', async () => {
        responder = () => ({ data: { id: 'a1', version: 1 }, error: null });
        await datos.subirDiseno({ mesId: 'm1', piezaId: 'p1', archivo: { name: 'Diseño final (v2).png', type: 'image/png', size: 9 }, subidoPor: 'e1' });
        const [bucket, ruta] = subirArchivo.mock.calls[0];
        expect(bucket).toBe('marketing');
        expect(ruta).toMatch(/^m1\/p1\/\d+-Diseno-final-v2-\.png$/);
        const fila = op(llamadas[0], 'insert')[1];
        expect(fila).toMatchObject({ pieza_id: 'p1', subido_por: 'e1', anterior_id: null, tamano: 9, mime: 'image/png' });
        // `borrador` lo decide la base (trigger H32), nunca el navegador.
        expect(fila).not.toHaveProperty('borrador');
        expect(anotar).toHaveBeenCalledWith('MARKETING_ARCHIVO_SUBIR', 'p1', expect.any(Object));
    });

    it('con anterior es una versión: lo anota como tal y respeta las medidas de la pantalla', async () => {
        responder = () => ({ data: { id: 'a2', version: 2 }, error: null });
        await datos.subirDiseno({ mesId: 'm1', piezaId: 'p1', archivo: { name: 'x.mp4', type: 'video/mp4', size: 5 }, anteriorId: 'a1',
            medidas: { tamano: 7, ancho: 1080, alto: 1920 } });
        expect(op(llamadas[0], 'insert')[1]).toMatchObject({ anterior_id: 'a1', tamano: 7, ancho: 1080, alto: 1920 });
        expect(anotar).toHaveBeenCalledWith('MARKETING_ARCHIVO_VERSION', 'p1', { nombre: 'x.mp4', version: 2 });
    });

    it('quitar un archivo que no se pudo quitar lo dice', async () => {
        responder = () => ({ data: null, error: null, count: 0 });
        await expect(datos.quitarArchivo({ id: 'a1', url: 'https://x/marketing/m/p/f.png' })).rejects.toThrow('No se pudo quitar');
        expect(quitados).toHaveLength(0);
    });

    it('firma los diseños de todo el mes en UNA tanda, y sin diseños no pide nada', async () => {
        expect((await datos.firmarDisenos([{ archivos: [{ enlace: 'x' }] }])).size).toBe(0);
        expect(signStorageUrls).not.toHaveBeenCalled();
        await datos.firmarDisenos([{ archivos: [{ url: 'u1' }, { url: 'u2' }] }, { archivos: [{ url: 'u3' }] }]);
        expect(signStorageUrls).toHaveBeenCalledTimes(1);
        expect(signStorageUrls.mock.calls[0][0]).toEqual(['u1', 'u2', 'u3']);
    });
});

describe('la pauta', () => {
    it('un resultado vacío es «sin anotar» (null), no cero; el presupuesto vacío sí es 0', async () => {
        responder = () => ({ data: { presupuesto: 0, gastado: null }, error: null });
        await datos.guardarPauta('p1', { presupuesto: '', gastado: '', alcance: '1200', objetivo: 'mensajes', notas: null });
        expect(op(llamadas[0], 'upsert')[1]).toEqual({ pieza_id: 'p1', presupuesto: 0, gastado: null, alcance: 1200, objetivo: 'mensajes', notas: null });
    });
});

describe('el mes y la revisión', () => {
    it('crear el mes guarda su primer día', async () => {
        responder = () => ({ data: { id: 'm1' }, error: null });
        await datos.crearMes('2026-11');
        expect(op(llamadas[0], 'insert')[1]).toEqual({ mes: '2026-11-01' });
    });

    it('publicar el mes va por la función de la base (el estado no se escribe con un update)', async () => {
        await datos.publicarMes('m1', '');
        expect(supabase.rpc).toHaveBeenCalledWith('marketing_publicar_mes', { p_mes_id: 'm1', p_nota: null });
        expect(llamadas).toHaveLength(0);
        expect(anotar).toHaveBeenCalledWith('MARKETING_MES_PUBLICAR', 'm1', { version: 3 });
    });

    it('enviar una pieza sola también va por la función (la que publica sus borradores)', async () => {
        await datos.enviarPieza('p1');
        expect(supabase.rpc).toHaveBeenCalledWith('marketing_enviar_pieza', { p_pieza_id: 'p1' });
    });

    it('aprobar o pedir cambios se anota con la decisión', async () => {
        await datos.revisarPieza('p1', 'cambios', 'el logo más grande');
        expect(anotar).toHaveBeenCalledWith('MARKETING_PIEZA_CAMBIOS', 'p1', { texto: 'el logo más grande' });
        await datos.revisarPieza('p1', 'aprobar');
        expect(supabase.rpc).toHaveBeenLastCalledWith('marketing_revisar_pieza', { p_pieza_id: 'p1', p_decision: 'aprobar', p_texto: null });
    });

    it('un comentario con respuestas no se quita: cero filas es un error', async () => {
        responder = () => ({ data: null, error: null, count: 0 });
        await expect(datos.quitarComentario('c1')).rejects.toThrow('Ya tiene respuestas');
    });
});

describe('las solicitudes', () => {
    it('el tamaño sólo viaja si es impreso', async () => {
        responder = () => ({ data: { id: 's1', titulo: 'Banner', prioridad: 'normal' }, error: null });
        await datos.crearSolicitud({ titulo: ' Banner ', tipo: 'digital', tamano: '2 × 1 m' }, 'e1');
        expect(op(llamadas[0], 'insert')[1]).toMatchObject({ titulo: 'Banner', tipo: 'digital', tamano: null, prioridad: 'normal', solicitado_por: 'e1' });
        await datos.crearSolicitud({ titulo: 'Banner', tipo: 'impreso', tamano: ' 2 × 1 m ' }, 'e1');
        expect(op(llamadas[1], 'insert')[1].tamano).toBe('2 × 1 m');
    });
});

describe('las personas', () => {
    it('sin ids no consulta, y con ids repetidos pide cada uno una vez', async () => {
        expect(await datos.fetchPersonas([null, undefined])).toEqual({});
        expect(llamadas).toHaveLength(0);
        responder = () => ({ data: [{ id: 'e1', name: 'Ana', photo_url: 'u' }], error: null });
        const r = await datos.fetchPersonas(['e1', 'e1', null]);
        expect(op(llamadas[0], 'in')).toEqual(['in', 'id', ['e1']]);
        expect(r.e1.photo).toBe('u');
    });
});

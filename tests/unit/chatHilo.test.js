import { describe, expect, it, vi, beforeEach } from 'vitest';

// El hilo del chat con clientes (portal y app del personal): la precarga al
// pasar por la bandeja y la reconciliación del envío optimista. La precarga
// sólo LEE —no toma la conversación ni la marca leída—, nunca lanza y nunca
// pide dos veces lo mismo a la vez.

const fetchMensajes = vi.fn();
const fetchReacciones = vi.fn();
vi.mock('@nucleo/data/chatClientes', () => ({
    MENSAJES_POR_PAGINA: 3,
    fetchMensajes: (...a) => fetchMensajes(...a),
    fetchReacciones: (...a) => fetchReacciones(...a),
}));

const { fusionar, guardarHilo, leerHilo, precargarHilo } = await import('@nucleo/data/chatHilo');

beforeEach(() => { vi.clearAllMocks(); });

describe('precargarHilo', () => {
    it('trae los mensajes y agrupa las reacciones por mensaje', async () => {
        fetchMensajes.mockResolvedValueOnce([{ id: 1 }, { id: 2 }, { id: 3 }]);
        fetchReacciones.mockResolvedValueOnce([{ mensaje_id: 1, emoji: '👍' }, { mensaje_id: 1, emoji: '❤️' }, { mensaje_id: 3, emoji: '✅' }]);
        await precargarHilo('10');
        const h = leerHilo(10);
        expect(h.mensajes.map((m) => m.id)).toEqual([1, 2, 3]);
        expect(h.reacciones.get(1)).toHaveLength(2);
        expect(h.reacciones.has(2)).toBe(false);
        // Una página llena dice que puede haber más atrás.
        expect(h.hayAnteriores).toBe(true);
    });

    it('dos pasadas seguidas comparten la misma lectura', async () => {
        let soltar;
        fetchMensajes.mockReturnValueOnce(new Promise((r) => { soltar = r; }));
        fetchReacciones.mockResolvedValue([]);
        const a = precargarHilo(20);
        const b = precargarHilo(20);
        expect(b).toBe(a);
        soltar([]);
        await a;
        expect(fetchMensajes).toHaveBeenCalledTimes(1);
    });

    it('un hilo recién leído no se vuelve a pedir', async () => {
        guardarHilo(30, { mensajes: [], hayAnteriores: false, reacciones: new Map() });
        expect(precargarHilo(30)).toBeNull();
        expect(fetchMensajes).not.toHaveBeenCalled();
    });

    it('nunca lanza: si la red falla, no deja nada a medias y se puede reintentar', async () => {
        fetchMensajes.mockRejectedValueOnce(new Error('offline'));
        await expect(precargarHilo(40)).resolves.toBeUndefined();
        expect(leerHilo(40)).toBeNull();
        fetchMensajes.mockResolvedValueOnce([{ id: 9 }]);
        fetchReacciones.mockRejectedValueOnce(new Error('sin reacciones'));
        await precargarHilo(40);
        // Sin reacciones el hilo igual se pinta.
        expect(leerHilo(40).mensajes).toEqual([{ id: 9 }]);
        expect(leerHilo(40).hayAnteriores).toBe(false);
    });
});

describe('fusionar — el envío optimista', () => {
    const tmp = { id: 't1', temporal: true, autor: 'equipo', employee_id: 5, texto: 'hola' };

    it('el mensaje real retira el globo temporal del mismo autor y texto', () => {
        const r = fusionar([{ id: 1 }, tmp], [{ id: 2, autor: 'equipo', employee_id: '5', texto: 'hola' }]);
        expect(r.map((m) => m.id)).toEqual([1, 2]);
    });

    it('un temporal que no coincide sigue al final, donde se escribió', () => {
        const r = fusionar([{ id: 1 }, tmp], [{ id: 2, autor: 'cliente', texto: 'hola' }]);
        expect(r.map((m) => m.id)).toEqual([1, 2, 't1']);
    });

    it('un temporal FALLIDO no lo reemplaza nadie: el dependiente tiene que verlo', () => {
        const r = fusionar([{ ...tmp, fallido: true }], [{ id: 2, autor: 'equipo', employee_id: 5, texto: 'hola' }]);
        expect(r.map((m) => m.id)).toEqual([2, 't1']);
    });

    it('dos envíos iguales seguidos retiran un temporal cada uno', () => {
        const t2 = { ...tmp, id: 't2' };
        const r = fusionar([tmp, t2], [
            { id: 2, autor: 'equipo', employee_id: 5, texto: 'hola' },
            { id: 3, autor: 'equipo', employee_id: 5, texto: 'hola' },
        ]);
        expect(r.map((m) => m.id)).toEqual([2, 3]);
    });

    it('lo que ya está no se duplica, y sin nada nuevo devuelve el mismo arreglo', () => {
        const base = [{ id: 1 }];
        expect(fusionar(base, [{ id: 1 }])).toBe(base);
        expect(fusionar(null, [{ id: 1 }])).toEqual([{ id: 1 }]);
    });

    it('libera la URL local de la foto del temporal reemplazado', () => {
        const revocar = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        fusionar([{ ...tmp, texto: null, foto_url: 'blob:abc', adjunto: null }],
            [{ id: 2, autor: 'equipo', employee_id: 5, texto: null }]);
        expect(revocar).toHaveBeenCalledWith('blob:abc');
        revocar.mockRestore();
    });
});

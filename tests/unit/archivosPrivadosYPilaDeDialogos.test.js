// Los archivos privados y la pila de diálogos.
//
// Dos piezas del chasis, y las dos existen porque una regla de PROSA no se
// sostiene:
//
//   · **un bucket privado sirve su archivo sólo con una URL firmada.** En la
//     base se guarda la URL formato-público como identificador, así que
//     olvidarse de firmar no da error: da una imagen rota. `inventario-evidencia`
//     era privado desde que nació y **nunca estuvo en la lista**: las fotos de
//     un descarte por daño habrían salido rotas el día que alguien las pintara,
//     y no lo detectó nadie porque hasta ese día NINGUNA pantalla las mostraba;
//   · **un diálogo sobre otro está prohibido**, y la prohibición no se sostiene
//     pidiéndole a cada vista que cierre lo suyo antes de abrir lo otro — eso es
//     una regla de prosa, y hay 18 llamadores. Se sostiene desde el canónico:
//     `ModalShell` pregunta si es el de encima y, si no lo es, no pinta.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const createSignedUrls = vi.fn(async (paths) =>
    ({ data: paths.map(p => ({ signedUrl: `https://x.supabase.co/storage/v1/object/sign/${p}?token=T` })), error: null }));
vi.mock('../../src/supabaseClient', () => ({
    supabase: { storage: { from: () => ({ createSignedUrls: (...a) => createSignedUrls(...a) }) } },
}));

const { getStoragePathFromUrl, webpSignedUrl, signStorageUrls, signPhotosDeep, clearSignedUrlCache } =
    await import('../../src/utils/storageFiles');
const { abrirDialogo } = await import('../../src/components/common/dialogosAbiertos');

const PRIVADA = 'https://x.supabase.co/storage/v1/object/public/empleados/fotos/ana.png';
const PUBLICA = 'https://x.supabase.co/storage/v1/object/public/product-photos/900.png';

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); clearSignedUrlCache(); });

describe('leer el bucket y el camino de una URL guardada', () => {
    it('saca los dos de una URL formato-público', () => {
        expect(getStoragePathFromUrl(PRIVADA)).toEqual({ bucket: 'empleados', path: 'fotos/ana.png' });
    });

    it('también de una firmada y de una autenticada', () => {
        // Las tres formas conviven: lo que se guardó, lo que devolvió una firma
        // y lo que vino de un select.
        expect(getStoragePathFromUrl('https://x/storage/v1/object/sign/empleados/a.png?token=T').bucket)
            .toBe('empleados');
        expect(getStoragePathFromUrl('https://x/storage/v1/object/authenticated/empleados/a.png').path)
            .toBe('a.png');
    });

    it('decodifica el camino: un nombre con espacios no es otro archivo', () => {
        expect(getStoragePathFromUrl('https://x/storage/v1/object/public/documents/mi%20contrato.pdf').path)
            .toBe('mi contrato.pdf');
    });

    it('lo que no es de storage devuelve null, no un objeto a medias', () => {
        expect(getStoragePathFromUrl('https://otro-sitio.com/foto.png')).toBeNull();
        expect(getStoragePathFromUrl(null)).toBeNull();
        expect(getStoragePathFromUrl('')).toBeNull();
    });
});

describe('firmar en LOTE lo privado, y dejar pasar lo demás', () => {
    it('una URL de bucket privado sale firmada', async () => {
        const m = await signStorageUrls([PRIVADA]);
        expect(m.get(PRIVADA)).toContain('/object/sign/');
        expect(m.get(PRIVADA)).toContain('token=');
    });

    it('una de bucket PÚBLICO se devuelve tal cual, sin gastar una firma', async () => {
        const m = await signStorageUrls([PUBLICA]);
        expect(m.get(PUBLICA)).toBe(PUBLICA);
        expect(createSignedUrls).not.toHaveBeenCalled();
    });

    it('una URL externa tampoco se toca', async () => {
        const externa = 'https://otro-sitio.com/foto.png';
        expect((await signStorageUrls([externa])).get(externa)).toBe(externa);
    });

    it('`inventario-evidencia` está en la lista de privados', async () => {
        // Era privado desde que nació y no estaba: las fotos de un descarte por
        // daño habrían salido rotas el día que alguien las pintara.
        const u = 'https://x.supabase.co/storage/v1/object/public/inventario-evidencia/d/1.jpg';
        expect((await signStorageUrls([u])).get(u)).toContain('/object/sign/');
    });

    it('es UNA petición por bucket, no una por archivo', async () => {
        // Personal › Listado bajaba 25 fotos: 25 peticiones de firma serían 25
        // viajes antes de pintar la primera.
        await signStorageUrls([
            PRIVADA,
            'https://x.supabase.co/storage/v1/object/public/empleados/fotos/luis.png',
            'https://x.supabase.co/storage/v1/object/public/documents/c.pdf',
        ]);
        expect(createSignedUrls).toHaveBeenCalledTimes(2);          // empleados + documents
        expect(createSignedUrls.mock.calls[0][0]).toHaveLength(2);  // las dos fotos, juntas
    });

    it('una URL repetida se pide UNA vez', async () => {
        await signStorageUrls([PRIVADA, PRIVADA, PRIVADA]);
        expect(createSignedUrls.mock.calls[0][0]).toHaveLength(1);
    });

    it('dos URLs del MISMO archivo se piden una vez y salen firmadas LAS DOS', async () => {
        // El patrón descarta la query, así que un cache-buster da la misma
        // clave. Agrupar y quedarse con la primera dejaría a la otra sin firmar,
        // y `signPhotosDeep` —que reemplaza sólo lo que está en el mapa— la
        // pintaría cruda.
        const conBuster = `${PRIVADA}?t=123`;
        const m = await signStorageUrls([PRIVADA, conBuster]);
        expect(createSignedUrls.mock.calls[0][0]).toHaveLength(1);
        expect(m.get(PRIVADA)).toContain('/object/sign/');
        expect(m.get(conBuster)).toContain('/object/sign/');
    });

    it('si la firma falla, las DOS vuelven crudas y ninguna queda fuera del mapa', async () => {
        createSignedUrls.mockResolvedValueOnce({ data: null, error: { message: 'x' } });
        const conBuster = `${PRIVADA}?t=123`;
        const m = await signStorageUrls([PRIVADA, conBuster]);
        expect(m.get(PRIVADA)).toBe(PRIVADA);
        expect(m.get(conBuster)).toBe(conBuster);
    });

    it('la segunda vuelta usa la firma guardada, sin pedir nada', async () => {
        await signStorageUrls([PRIVADA]);
        createSignedUrls.mockClear();
        const m = await signStorageUrls([PRIVADA]);
        expect(createSignedUrls).not.toHaveBeenCalled();
        expect(m.get(PRIVADA)).toContain('token=');
    });

    it('si la firma falla, se devuelve la URL cruda en vez de un hueco', async () => {
        // Una imagen rota es mejor que una pantalla que no carga: el resto de la
        // fila sigue sirviendo.
        createSignedUrls.mockResolvedValueOnce({ data: null, error: { message: 'x' } });
        expect((await signStorageUrls([PRIVADA])).get(PRIVADA)).toBe(PRIVADA);
    });

    it('si la llamada REVIENTA, tampoco se pierde la fila', async () => {
        createSignedUrls.mockRejectedValueOnce(new Error('sin red'));
        expect((await signStorageUrls([PRIVADA])).get(PRIVADA)).toBe(PRIVADA);
    });

    it('sin URLs no llama a nadie', async () => {
        expect((await signStorageUrls([])).size).toBe(0);
        expect((await signStorageUrls(null)).size).toBe(0);
        expect(createSignedUrls).not.toHaveBeenCalled();
    });
});

describe('la versión liviana de una foto ya firmada', () => {
    it('reescribe al endpoint de render conservando el token', () => {
        // El token sigue valiendo porque está firmado sobre el path.
        // 168 kB PNG → 20 kB WEBP, medido sobre las fotos de perfil.
        const firmada = 'https://x/storage/v1/object/sign/empleados/a.png?token=T';
        expect(webpSignedUrl(firmada)).toBe('https://x/storage/v1/render/image/sign/empleados/a.png?token=T');
    });

    it('lo que no es una URL firmada se devuelve tal cual', () => {
        expect(webpSignedUrl(PUBLICA)).toBe(PUBLICA);
        expect(webpSignedUrl(null)).toBeNull();
    });
});

describe('recorrer filas anidadas y firmar lo que encuentre', () => {
    it('reemplaza la URL privada esté donde esté', async () => {
        const filas = [{ id: 1, empleado: { photo_url: PRIVADA }, nota: 'sin fotos' }];
        await signPhotosDeep(filas);
        expect(filas[0].empleado.photo_url).toContain('/object/sign/');
        expect(filas[0].nota).toBe('sin fotos');
    });

    it('no se cuelga con una referencia circular', async () => {
        // Un select con relaciones puede traerlas: recorrerlo sin marcar lo
        // visto sería un bucle infinito en el navegador de la sala.
        const a = { photo_url: PRIVADA };
        a.yo = a;
        await expect(signPhotosDeep([a])).resolves.toBeDefined();
        expect(a.photo_url).toContain('/object/sign/');
    });

    it('lo vacío no revienta', async () => {
        await expect(signPhotosDeep([])).resolves.toBeDefined();
        await expect(signPhotosDeep(null)).resolves.toBeDefined();
    });
});

describe('la pila de diálogos: un diálogo sobre otro está prohibido', () => {
    it('el primero no tiene nada debajo', () => {
        const { cerrar, debajo } = abrirDialogo('a', 'Detalle');
        expect(debajo).toBeNull();
        cerrar();
    });

    it('el segundo DICE a quién tapó', () => {
        // Que la pantalla se salve no vuelve legítimo el anidamiento: el flujo
        // hay que rediseñarlo igual, y por eso el nombre viaja.
        const a = abrirDialogo('a', 'Detalle de la persona');
        const b = abrirDialogo('b', 'Bloquear');
        expect(b.debajo).toBe('Detalle de la persona');
        b.cerrar(); a.cerrar();
    });

    it('cerrar el de ENCIMA devuelve la pila al de abajo', () => {
        // El de abajo no se desmonta: sigue montado con su estado intacto, que
        // es lo que hace que «Cancelar» devuelva la pantalla como estaba.
        const a = abrirDialogo('a', 'Detalle');
        const b = abrirDialogo('b', 'Bloquear');
        b.cerrar();
        const c = abrirDialogo('c', 'Otro');
        expect(c.debajo).toBe('Detalle');
        c.cerrar(); a.cerrar();
    });

    it('cerrar el de ABAJO primero no descoloca al de encima', () => {
        // Se filtra por id, no se hace `pop()`: si se hiciera, cerrar el de
        // abajo se llevaría al de encima.
        const a = abrirDialogo('a', 'Detalle');
        const b = abrirDialogo('b', 'Bloquear');
        a.cerrar();
        const c = abrirDialogo('c', 'Otro');
        expect(c.debajo).toBe('Bloquear');
        c.cerrar(); b.cerrar();
    });

    it('cerrar dos veces no rompe la pila', () => {
        const a = abrirDialogo('a', 'Detalle');
        a.cerrar(); a.cerrar();
        expect(abrirDialogo('b', 'Otro').debajo).toBeNull();
    });
});

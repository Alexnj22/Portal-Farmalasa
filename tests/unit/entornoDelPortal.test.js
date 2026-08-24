// Contra qué base está corriendo el portal.
//
// De acá sale el marco y la píldora «ENTORNO DE PRUEBAS», y el error caro tiene
// una sola dirección: **creer que estás en pruebas mientras escribís en
// producción**. Por eso se DERIVA de la URL de Supabase y no de una bandera
// propia — una bandera se puede olvidar al armar un `.env` nuevo; la URL no,
// porque sin ella el cliente ni arranca.
//
// Y por eso una URL ausente o rota enciende el aviso en vez de apagarlo: ante la
// duda conviene el falso positivo («creí que era producción y era pruebas»)
// antes que el silencio.

import { describe, it, expect, afterEach, vi } from 'vitest';

const REF_PRODUCCION = 'sacecdkdmsdvgqnrsett';

/** Carga `entorno.js` de cero con esta URL. */
async function conUrl(url) {
    vi.resetModules();
    if (url === undefined) vi.stubEnv('VITE_SUPABASE_URL', '');
    else vi.stubEnv('VITE_SUPABASE_URL', url);
    return import('../../src/entorno');
}

afterEach(() => vi.unstubAllEnvs());

describe('de dónde sale el aviso', () => {
    it('la URL de producción NO enciende el aviso', async () => {
        const e = await conUrl(`https://${REF_PRODUCCION}.supabase.co`);
        expect(e.REF_SUPABASE).toBe(REF_PRODUCCION);
        expect(e.ES_PRODUCCION).toBe(true);
        expect(e.ES_PRUEBAS).toBe(false);
    });

    it('cualquier otro proyecto es entorno de pruebas', async () => {
        // El ref del branch cambia cada vez que se rehace, así que la regla no
        // puede ser una lista de refs de prueba: es «no es el de producción».
        for (const ref of ['qvctarsqvlhbzgvwbbbt', 'cbnjplmnfmfsambavjce', 'loquesea']) {
            const e = await conUrl(`https://${ref}.supabase.co`);
            expect(e.REF_SUPABASE).toBe(ref);
            expect(e.ES_PRUEBAS).toBe(true);
        }
    });

    it('una URL rota enciende el aviso, no lo apaga', async () => {
        for (const url of ['', 'no-es-una-url', undefined]) {
            const e = await conUrl(url);
            expect(e.REF_SUPABASE).toBe('');
            expect(e.ES_PRUEBAS).toBe(true);
            expect(e.ES_PRODUCCION).toBe(false);
        }
    });

    it('los dos valores son siempre opuestos: no hay estado sin decidir', async () => {
        for (const url of [`https://${REF_PRODUCCION}.supabase.co`, 'https://otro.supabase.co', '']) {
            const e = await conUrl(url);
            expect(e.ES_PRUEBAS).toBe(!e.ES_PRODUCCION);
        }
    });

    it('el ref sale del subdominio, no del resto de la dirección', async () => {
        // La clave de sesión también sale de ahí, así que producción y pruebas
        // no se pisan en `localStorage`.
        const e = await conUrl(`https://${REF_PRODUCCION}.supabase.co/rest/v1?x=1`);
        expect(e.REF_SUPABASE).toBe(REF_PRODUCCION);
    });

    it('un dominio que sólo CONTIENE el ref de producción no cuenta como producción', async () => {
        const e = await conUrl(`https://copia-de-${REF_PRODUCCION}.supabase.co`);
        expect(e.ES_PRODUCCION).toBe(false);
    });
});

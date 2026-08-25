import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    _reiniciarParaPruebas,
    actualizarAhora,
    consultarPublicada,
    entradaQueCorre,
    esOtraVersion,
    leerEstadoVersion,
    marcarVersionNueva,
    posponerAviso,
    revisarVersion,
} from '../../src/utils/versionNueva';

/**
 * El aviso de versión nueva — y sobre todo, la regresión que tiene que cazar.
 *
 * Hasta el 2026-08-25 el portal se RECARGABA solo al detectar que su bundle
 * había quedado viejo, y esa recarga se llevaba todo lo escrito y no guardado.
 * El caso que lo motivó: alguien llenando un formulario cuando sale una
 * publicación. La prueba central de este archivo no es que el aviso aparezca —
 * es que **nada recargue sin que alguien lo apriete**.
 */

const ENTRADA = 'index-aaa111.js';

let recargar;

function ponerEntradaEnElDom(nombre) {
    document.head.innerHTML = '';
    if (!nombre) return;
    const s = document.createElement('script');
    s.type = 'module';
    s.setAttribute('src', `/assets/${nombre}`);
    document.head.appendChild(s);
}

const respuesta = (cuerpo, ok = true) => ({
    ok,
    json: async () => cuerpo,
});

beforeEach(() => {
    _reiniciarParaPruebas();
    ponerEntradaEnElDom(ENTRADA);
    recargar = vi.fn();
    Object.defineProperty(window, 'location', {
        configurable: true,
        value: { reload: recargar, pathname: '/pedidos', search: '' },
    });
});

afterEach(() => {
    document.head.innerHTML = '';
    vi.restoreAllMocks();
});

describe('qué archivo está corriendo', () => {
    it('lo lee del script del build', () => {
        expect(entradaQueCorre()).toBe(ENTRADA);
    });

    it('en desarrollo no hay ninguno y devuelve null', () => {
        ponerEntradaEnElDom(null);
        expect(entradaQueCorre()).toBeNull();
    });
});

describe('comparar publicado contra lo que corre', () => {
    it('el mismo archivo no es otra versión', () => {
        expect(esOtraVersion({ entrada: ENTRADA }, ENTRADA)).toBe(false);
    });

    it('otro archivo sí lo es, aunque el número no haya subido', () => {
        expect(esOtraVersion({ entrada: 'index-bbb222.js', version: '2.762.1' }, ENTRADA)).toBe(true);
    });

    it('compara sólo el nombre, no la ruta', () => {
        expect(esOtraVersion({ entrada: `assets/${ENTRADA}` }, ENTRADA)).toBe(false);
    });

    it('sin dato publicado no inventa una versión nueva', () => {
        expect(esOtraVersion(null, ENTRADA)).toBe(false);
        expect(esOtraVersion({ entrada: '' }, ENTRADA)).toBe(false);
    });

    it('sin saber qué corre tampoco', () => {
        expect(esOtraVersion({ entrada: 'index-bbb222.js' }, null)).toBe(false);
    });
});

describe('consultar qué está publicado', () => {
    it('no saber devuelve null, no una versión nueva', async () => {
        expect(await consultarPublicada(async () => { throw new Error('sin red'); })).toBeNull();
        expect(await consultarPublicada(async () => respuesta({}, false))).toBeNull();
        expect(await consultarPublicada(async () => respuesta({ v: '1.0.0' }))).toBeNull();
        expect(await consultarPublicada(async () => respuesta(null))).toBeNull();
    });

    it('pide sin caché', async () => {
        const traer = vi.fn(async () => respuesta({ v: '2.763.0', e: 'index-bbb222.js' }));
        const r = await consultarPublicada(traer);
        expect(r).toEqual({ version: '2.763.0', entrada: 'index-bbb222.js' });
        expect(traer.mock.calls[0][0]).toMatch(/^\/version\.json\?t=\d+/);
        expect(traer.mock.calls[0][1]).toEqual({ cache: 'no-store' });
    });
});

describe('NADIE recarga salvo la persona', () => {
    it('detectar una versión nueva avisa y no recarga', async () => {
        await revisarVersion({ forzar: true, fetchImpl: async () => respuesta({ v: '2.763.0', e: 'index-bbb222.js' }) });
        expect(leerEstadoVersion().hay).toBe(true);
        expect(leerEstadoVersion().version).toBe('2.763.0');
        expect(recargar).not.toHaveBeenCalled();
    });

    it('un chunk que no cargó avisa en su forma bloqueante y tampoco recarga', () => {
        marcarVersionNueva({ bloqueado: true });
        expect(leerEstadoVersion()).toMatchObject({ hay: true, bloqueado: true });
        expect(recargar).not.toHaveBeenCalled();
    });

    it('sólo `actualizarAhora` recarga', () => {
        marcarVersionNueva({ version: '2.763.0', entrada: 'index-bbb222.js' });
        expect(recargar).not.toHaveBeenCalled();
        actualizarAhora();
        expect(recargar).toHaveBeenCalledTimes(1);
    });
});

describe('cuándo NO se avisa', () => {
    it('si lo publicado es lo que ya corre', async () => {
        await revisarVersion({ forzar: true, fetchImpl: async () => respuesta({ v: '2.762.1', e: ENTRADA }) });
        expect(leerEstadoVersion().hay).toBe(false);
    });

    it('si no se pudo consultar', async () => {
        await revisarVersion({ forzar: true, fetchImpl: async () => { throw new Error('sin red'); } });
        expect(leerEstadoVersion().hay).toBe(false);
    });

    it('en desarrollo, donde no hay archivo con hash que comparar', async () => {
        ponerEntradaEnElDom(null);
        const traer = vi.fn();
        await revisarVersion({ forzar: true, fetchImpl: traer });
        expect(traer).not.toHaveBeenCalled();
        expect(leerEstadoVersion().hay).toBe(false);
    });

    it('respeta el piso entre consultas', async () => {
        const traer = vi.fn(async () => respuesta({ v: '2.762.1', e: ENTRADA }));
        await revisarVersion({ forzar: true, fetchImpl: traer });
        await revisarVersion({ fetchImpl: traer });
        expect(traer).toHaveBeenCalledTimes(1);
    });

    it('y no vuelve a preguntar una vez que ya avisó', async () => {
        const traer = vi.fn(async () => respuesta({ v: '2.763.0', e: 'index-bbb222.js' }));
        await revisarVersion({ forzar: true, fetchImpl: traer });
        await revisarVersion({ forzar: true, fetchImpl: traer });
        expect(traer).toHaveBeenCalledTimes(1);
    });
});

describe('el freno contra el bucle', () => {
    it('si la recarga no trajo el bundle pedido, el aviso se calla', () => {
        sessionStorage.setItem('portal_version_intento', String(Date.now()));
        sessionStorage.setItem('portal_version_objetivo', 'index-bbb222.js');   // sigue corriendo el viejo
        marcarVersionNueva({ version: '2.763.0', entrada: 'index-bbb222.js' });
        expect(leerEstadoVersion().hay).toBe(false);
    });

    it('pero una pantalla que YA no abre se avisa igual', () => {
        sessionStorage.setItem('portal_version_intento', String(Date.now()));
        sessionStorage.setItem('portal_version_objetivo', 'index-bbb222.js');
        marcarVersionNueva({ bloqueado: true });
        expect(leerEstadoVersion()).toMatchObject({ hay: true, bloqueado: true });
    });

    it('cuando la recarga sí llegó, el freno se levanta solo', () => {
        sessionStorage.setItem('portal_version_intento', String(Date.now()));
        sessionStorage.setItem('portal_version_objetivo', ENTRADA);   // llegó
        marcarVersionNueva({ version: '2.763.0', entrada: 'index-ccc333.js' });
        expect(leerEstadoVersion().hay).toBe(true);
        expect(sessionStorage.getItem('portal_version_intento')).toBeNull();
    });
});

describe('«ahora no»', () => {
    it('calla el aviso pero no lo olvida', () => {
        marcarVersionNueva({ version: '2.763.0', entrada: 'index-bbb222.js' });
        posponerAviso(60_000);
        const e = leerEstadoVersion();
        expect(e.hay).toBe(true);
        expect(e.callado).toBe(true);
        expect(e.pospuestoHasta).toBeGreaterThan(Date.now());
    });

    it('sobre un bloqueo BAJA el diálogo a franja, y ahí se queda', () => {
        // Callarlo por un rato no serviría: `bloqueado` no se apaga solo, así
        // que al vencer el plazo volvería el mismo diálogo.
        marcarVersionNueva({ bloqueado: true });
        posponerAviso(60_000);
        const e = leerEstadoVersion();
        expect(e.bloqueado).toBe(true);
        expect(e.degradado).toBe(true);
        expect(e.callado).toBe(false);
        expect(e.pospuestoHasta).toBe(0);
    });

    it('dicho una vez alcanza: otra pantalla que no abre NO lo vuelve a subir', () => {
        // Con el bundle viejo, toda vista que se abra por primera vez falla
        // igual. Re-subir el diálogo por cada una es un modal por clic.
        marcarVersionNueva({ bloqueado: true });
        posponerAviso(60_000);
        marcarVersionNueva({ bloqueado: true });
        expect(leerEstadoVersion().degradado).toBe(true);
    });

    it('un bloqueo cancela el «ahora no»: esa pantalla no abrió', () => {
        marcarVersionNueva({ version: '2.763.0', entrada: 'index-bbb222.js' });
        posponerAviso(60_000);
        marcarVersionNueva({ bloqueado: true });
        expect(leerEstadoVersion().callado).toBe(false);
        expect(leerEstadoVersion().pospuestoHasta).toBe(0);
    });
});

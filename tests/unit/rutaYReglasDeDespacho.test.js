// La ruta del pedido y las reglas de despacho.
//
// Dos cosas distintas con el mismo modo de falla que el resto del portal —
// **nada avisa cuando salen mal**:
//
//   · el orden de una ruta puede ser peor sin que nadie lo note: el camión llega
//     igual, sólo que más tarde;
//   · una regla de despacho mal filtrada no da error: ofrece una presentación
//     que ya no existe, o esconde el producto que se estaba buscando.
//
// Y el aviso de salida existe porque hasta el 2026-08-14 **tres caminos ponían
// una ruta en marcha y sólo uno avisaba**. Los otros dos son los que se usan
// cuando la ruta quedó pendiente o se arma hoy y sale mañana: la sala se quedaba
// esperando sin enterarse.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { crearEspia } from './_espiaSupabase';

const espia = crearEspia();
vi.mock('../../src/supabaseClient', () => ({ supabase: espia.supabase }));

const notifyBranch = vi.fn();
const fetchBranchIdsForSucursales = vi.fn(async () => ({
    data: [{ erp_sucursal_id: 3, branch_id: 25 }, { erp_sucursal_id: 5, branch_id: 2 }],
    error: null,
}));
vi.mock('../../src/utils/notify', () => ({ notifyBranch: (...a) => notifyBranch(...a) }));
vi.mock('../../src/data/pedidos', () => ({
    fetchBranchIdsForSucursales: (...a) => fetchBranchIdsForSucursales(...a),
}));

const { avisarSalidaALasSalas } = await import('../../src/utils/avisoSalidaPedido');
const { haversineMeters, optimizeRoute, totalRoute, decodePolyline } =
    await import('../../src/utils/routeOptimizer');
const { PAUSE_REASONS, STAGE_CONFIG, COLOR_CLS, SUC_VARIANTE } =
    await import('../../src/views/pedidos/tabpedidos/constants');
const { fetchProductPresentacionesForDispatch, fetchAllDispatchRules, fetchProductsWithLabPage } =
    await import('../../src/data/dispatchRules');
const { fetchProductPreciosOptsForProducts, searchAvailableProducts, fetchLastDispatchInfo } =
    await import('../../src/data/recepcion');

beforeEach(() => { vi.clearAllMocks(); espia.limpiar(); });

describe('avisar a la sala que su pedido salió', () => {
    const paradas = [
        { erp_sucursal_id: 3, numeros: ['114', '115'] },
        { erp_sucursal_id: 5 },
    ];

    it('avisa a cada sala, una vez', async () => {
        await avisarSalidaALasSalas(paradas, 'Carlos');
        expect(notifyBranch).toHaveBeenCalledTimes(2);
        expect(notifyBranch.mock.calls.map(c => c[0])).toEqual([25, 2]);
    });

    it('va CON push: la sala empieza a organizar quién recibe', async () => {
        // Antes era campana sola, o sea que sólo lo veía quien ya estaba mirando
        // la pantalla.
        await avisarSalidaALasSalas(paradas, 'Carlos');
        for (const [, aviso] of notifyBranch.mock.calls) expect(aviso.push).toBe(true);
    });

    it('dice a quién esperar', async () => {
        await avisarSalidaALasSalas(paradas, 'Carlos');
        expect(notifyBranch.mock.calls[0][1].body).toContain('Carlos');
    });

    it('sin los números el aviso se DEGRADA, no se calla', async () => {
        // La tarjeta de la pestaña de Pedidos no resuelve los números, y sin
        // ellos el aviso sigue sirviendo.
        await avisarSalidaALasSalas(paradas, 'Carlos');
        expect(notifyBranch.mock.calls[0][1].title).toContain('#114, #115');
        expect(notifyBranch.mock.calls[1][1].title).toBe('Tu pedido va en camino');
    });

    it('sin conductor tampoco se calla', async () => {
        await avisarSalidaALasSalas([{ erp_sucursal_id: 3 }], null);
        expect(notifyBranch.mock.calls[0][1].body).toBe('Salió de bodega.');
    });

    it('una sala que no está en el mapa se saltea, no rompe el resto', async () => {
        await avisarSalidaALasSalas([{ erp_sucursal_id: 99 }, { erp_sucursal_id: 3 }], 'Ana');
        expect(notifyBranch).toHaveBeenCalledTimes(1);
        expect(notifyBranch.mock.calls[0][0]).toBe(25);
    });

    it('NO lanza: un aviso que falla no puede deshacer una ruta que ya salió', async () => {
        // Primero se escribe el hecho, después se avisa.
        fetchBranchIdsForSucursales.mockResolvedValueOnce({ data: null, error: { message: 'x' } });
        await expect(avisarSalidaALasSalas(paradas, 'Ana')).resolves.toBeUndefined();
        expect(notifyBranch).not.toHaveBeenCalled();
    });

    it('sin paradas no hace nada', async () => {
        await avisarSalidaALasSalas([], 'Ana');
        await avisarSalidaALasSalas(null, 'Ana');
        expect(fetchBranchIdsForSucursales).not.toHaveBeenCalled();
    });
});

describe('la distancia entre dos puntos', () => {
    it('el mismo punto son cero metros', () => {
        expect(haversineMeters(13.7, -89.2, 13.7, -89.2)).toBe(0);
    });

    it('un grado de latitud son ~111 km', () => {
        expect(haversineMeters(13, -89, 14, -89) / 1000).toBeCloseTo(111, 0);
    });

    it('es simétrica: ir y volver miden lo mismo', () => {
        const a = haversineMeters(13.7, -89.2, 14.0, -88.9);
        const b = haversineMeters(14.0, -88.9, 13.7, -89.2);
        expect(a).toBeCloseTo(b, 6);
    });

    it('San Salvador a Chalatenango está en el orden de magnitud correcto', () => {
        // ~60 km en línea recta. Un error de factor —radio en km contra metros—
        // daría 60 o 60.000.000.
        const m = haversineMeters(13.6929, -89.2182, 14.0333, -88.9333);
        expect(m).toBeGreaterThan(40_000);
        expect(m).toBeLessThan(80_000);
    });
});

describe('el orden de la ruta', () => {
    const bodega = { lat: 13.70, lng: -89.20 };
    // Tres paradas en línea, a distancias crecientes de bodega.
    const paradas = [
        { erp_sucursal_id: 3, suc_name: 'lejos',  lat: 13.90, lng: -89.20 },
        { erp_sucursal_id: 4, suc_name: 'cerca',  lat: 13.72, lng: -89.20 },
        { erp_sucursal_id: 5, suc_name: 'medio',  lat: 13.80, lng: -89.20 },
    ];

    /** Lo que mide recorrer una lista de paradas saliendo de bodega. */
    const largo = (lista) => lista.reduce((suma, p, i) => {
        const antes = i === 0 ? bodega : lista[i - 1];
        return suma + haversineMeters(antes.lat, antes.lng, p.lat, p.lng);
    }, 0);

    it('devuelve TODAS las paradas: optimizar no es descartar', () => {
        const r = optimizeRoute(paradas, bodega);
        expect(r).toHaveLength(3);
        expect(r.map(s => s.erp_sucursal_id).sort()).toEqual([3, 4, 5]);
    });

    it('con paradas en línea, el orden es de la más cercana a la más lejana', () => {
        expect(optimizeRoute(paradas, bodega).map(s => s.suc_name))
            .toEqual(['cerca', 'medio', 'lejos']);
    });

    it('el orden elegido no es peor que el original', () => {
        // Es la propiedad que importa: si alguna vez lo fuera, el camión llegaría
        // más tarde y nadie lo notaría — no hay error que mirar.
        expect(largo(optimizeRoute(paradas, bodega))).toBeLessThanOrEqual(largo(paradas));
    });

    it('cada parada sale numerada y con su tramo medido', () => {
        // El `orden` es lo que la hoja de despacho imprime: sin él, dos paradas
        // se pueden hacer al revés sin que nada lo desmienta.
        const r = optimizeRoute(paradas, bodega);
        expect(r.map(p => p.orden)).toEqual([1, 2, 3]);
        for (const p of r) {
            expect(p.dist_m).toBeGreaterThan(0);
            expect(Number.isInteger(p.dist_m)).toBe(true);
        }
    });

    it('el total suma los tramos, y cuenta los que faltan como cero', () => {
        const r = optimizeRoute(paradas, bodega);
        expect(totalRoute(r).dist_m).toBe(r.reduce((s, p) => s + p.dist_m, 0));
        expect(totalRoute([{}, {}])).toEqual({ dist_m: 0, dur_min: 0 });
    });

    it('una sola parada no se puede reordenar', () => {
        expect(optimizeRoute([paradas[0]], bodega)).toHaveLength(1);
    });

    it('sin paradas devuelve una lista vacía', () => {
        expect(optimizeRoute([], bodega)).toEqual([]);
    });
});

describe('la línea del recorrido que dibuja el mapa', () => {
    it('un punto se decodifica a sus coordenadas', () => {
        // El formato es el de Google; un signo mal leído pone la ruta en el
        // hemisferio equivocado.
        const [p] = decodePolyline('_p~iF~ps|U');
        expect(p[0]).toBeCloseTo(38.5, 4);
        expect(p[1]).toBeCloseTo(-120.2, 4);
    });

    it('cada punto es relativo al anterior', () => {
        const puntos = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
        expect(puntos).toHaveLength(3);
        expect(puntos[1][0]).toBeCloseTo(40.7, 4);
        expect(puntos[2][0]).toBeCloseTo(43.252, 3);
    });

    it('una cadena vacía no revienta el mapa', () => {
        expect(decodePolyline('')).toEqual([]);
    });
});

describe('las etapas y los motivos de pausa', () => {
    it('el almuerzo se puede usar UNA vez por jornada', () => {
        // Es lo que distingue un descanso de una pausa: sin el tope, «almuerzo»
        // serviría para justificar cualquier parada del día.
        expect(PAUSE_REASONS.find(r => r.key === 'almuerzo').maxUses).toBe(1);
    });

    it('«Otro» exige escribir el motivo', () => {
        // Una pausa sin explicación no se puede revisar después.
        expect(PAUSE_REASONS.find(r => r.key === 'otro').requiresComment).toBe(true);
    });

    it('los demás motivos no tienen tope', () => {
        for (const r of PAUSE_REASONS.filter(x => x.key !== 'almuerzo'))
            expect(r.maxUses).toBeNull();
    });

    it('cada etapa tiene rótulo, color e ícono, y su color existe', () => {
        // Un color sin entrada en la paleta no falla: pinta transparente.
        for (const [clave, cfg] of Object.entries(STAGE_CONFIG)) {
            expect(cfg.label, clave).toBeTruthy();
            expect(cfg.icon, clave).toBeTruthy();
            expect(COLOR_CLS[cfg.color], `${clave} → ${cfg.color}`).toBeTruthy();
        }
    });

    it('ningún rótulo de etapa nombra el sistema de origen', () => {
        for (const cfg of Object.values(STAGE_CONFIG)) {
            expect(cfg.label).not.toMatch(/\bERP\b/i);
            expect(cfg.label.toLowerCase()).not.toMatch(/sincroniz/);
        }
    });

    it('Bodega es la sala neutra, y ninguna otra repite su color', () => {
        // Las píldoras de sala conviven en la misma pantalla: dos del mismo
        // color dejan de distinguirse.
        expect(SUC_VARIANTE[6]).toBe('neutral');
        const colores = Object.values(SUC_VARIANTE);
        expect(new Set(colores).size).toBe(colores.length);
    });
});

describe('las reglas de despacho', () => {
    const base = { offset: 0, pageSize: 50, hiddenLabs: [], sortKey: 'nombre',
                   ascending: true, term: '', ruleFilter: '', ruleIds: [],
                   soloNuevos: false, newIds: [], labId: null };

    it('la presentación ya elegida se sigue ofreciendo aunque se haya desactivado', async () => {
        // La regla configurada puede apuntar a una presentación que desde
        // entonces se marcó `activo=false`: si desapareciera, el editor la
        // perdería de vista y la regla quedaría apuntando a la nada.
        fetchProductPresentacionesForDispatch(900, 12);
        const [expr] = espia.primero('or');
        expect(expr).toContain('activo.eq.true');
        expect(expr).toContain('id_presentacion.eq.12');
    });

    it('sin una elegida, sólo se ofrecen las activas', async () => {
        // Ninguna OTRA inactiva debe aparecer como opción nueva.
        fetchProductPresentacionesForDispatch(900, null);
        expect(espia.uso('or')).toBe(false);
        expect(espia.todos('eq')).toContainEqual(['activo', true]);
    });

    it('las reglas se traen paginadas', async () => {
        await fetchAllDispatchRules();
        expect(espia.tabla()).toBe('dispatch_rules');
        expect(espia.uso('range')).toBe(true);
    });

    it('«con regla», «sólo nuevos» y el laboratorio son TRES filtros que se aplican JUNTOS', () => {
        // «Los nuevos que todavía no tienen regla» es justamente la pregunta
        // para la que existe esta pantalla, y con «nuevo» como un tercer valor
        // de `ruleFilter` era la combinación imposible de pedir.
        fetchProductsWithLabPage({ ...base, ruleFilter: 'sin', ruleIds: [1, 2],
                                   soloNuevos: true, newIds: [7, 8], labId: 3 });
        expect(espia.todos('eq')).toContainEqual(['laboratorio_id', 3]);
        expect(espia.todos('not')).toContainEqual(['id', 'in', '(1,2)']);
        expect(espia.todos('in')).toContainEqual(['id', [7, 8]]);
    });

    it('«con regla» sin ninguna regla NO devuelve todo: devuelve nada', () => {
        // Sin el `in('id', [0])`, un filtro sin candidatos se convertiría en
        // «sin filtro» y la pantalla mostraría el catálogo entero.
        fetchProductsWithLabPage({ ...base, ruleFilter: 'con', ruleIds: [] });
        expect(espia.todos('in')).toContainEqual(['id', [0]]);
    });

    it('el laboratorio pedido MANDA sobre la lista de ocultos', () => {
        // Si alguien lo pide por su nombre, no tiene sentido esconderlo.
        fetchProductsWithLabPage({ ...base, hiddenLabs: [3, 4], labId: 3 });
        expect(espia.uso('not')).toBe(false);
        expect(espia.todos('eq')).toContainEqual(['laboratorio_id', 3]);
    });

    it('el orden es total: al ordenar por otra columna, desempata por nombre', () => {
        // `range()` corta por posición, y `laboratorio_nombre` empata mucho.
        fetchProductsWithLabPage({ ...base, sortKey: 'laboratorio_nombre' });
        expect(espia.todos('order')).toEqual([
            ['laboratorio_nombre', { ascending: true }], ['nombre', { ascending: true }],
        ]);
    });

    it('un término de una sola letra no filtra: son 5.212 productos', () => {
        fetchProductsWithLabPage({ ...base, term: 'a' });
        expect(espia.uso('or')).toBe(false);
        espia.limpiar();
        fetchProductsWithLabPage({ ...base, term: 'am' });
        expect(espia.uso('or')).toBe(true);
    });
});

describe('la recepción en la sala', () => {
    it('las presentaciones de varios productos se traen PAGINADAS', async () => {
        // `product_id` se repite en `product_precios` —una fila por
        // presentación—, así que acotar la entrada no acota la salida: 300
        // productos pueden dar más de 1000 filas.
        await fetchProductPreciosOptsForProducts([1, 2, 3]);
        expect(espia.uso('range')).toBe(true);
        expect(espia.todos('eq')).toContainEqual(['activo', true]);
    });

    it('el buscador de productos EXCLUYE lo que ya está en la lista', async () => {
        // Sin eso, agregar un producto dos veces es un clic, y el conteo de la
        // recepción queda duplicado.
        searchAvailableProducts('amox', [7, 9]);
        expect(espia.todos('not')).toContainEqual(['id', 'in', '(7,9)']);
    });

    it('sin nada que excluir no agrega el filtro', () => {
        searchAvailableProducts('amox', []);
        expect(espia.uso('not')).toBe(false);
    });

    it('el buscador trae pocas opciones: es un desplegable, no una lista', () => {
        searchAvailableProducts('amox', []);
        expect(espia.primero('limit')).toEqual([10]);
        expect(espia.primero('order')).toEqual(['nombre']);
    });

    it('«cómo se despachó la última vez» sólo mira renglones que lo DICEN', () => {
        // Un renglón sin presentación registrada no es «la última vez»: es un
        // renglón viejo, y tomarlo propondría una presentación equivocada.
        fetchLastDispatchInfo(900);
        expect(espia.todos('not')).toContainEqual(['dispatch_tipo', 'is', null]);
        expect(espia.todos('not')).toContainEqual(['dispatch_factor', 'is', null]);
        expect(espia.primero('order')).toEqual(['id', { ascending: false }]);
        expect(espia.primero('limit')).toEqual([1]);
    });
});

import { describe, it, expect } from 'vitest';
import { agruparPorRuta, claveParada, getBranchStage, estadoDeLaSala, puedePrepararse, puedeDespacharse } from '../../src/views/pedidos/tabpedidos/helpers';

// El caso real, tal como estaba en producción el 2026-08-24.
//
// El pedido 137 pidió a DOS salas. Salud 1 se preparó (9:44 a 11:51) y salió en
// la ruta #21. Salud 2 no se empezó siquiera: `iniciado_at` y `finalizado_at` en
// NULL, `total_cajas` NULL y NINGUNA fila en `ruta_pedidos`. Aun así su tarjeta
// se pintaba dentro de la Ruta #21, decía «En ruta 11:51 a.m.», mostraba la cara
// del conductor en el nodo «Entregado» y ofrecía confirmar la llegada de cajas.
//
// Nada de eso venía de un dato malo: la ruta tiene UNA parada en la base. Venía
// de leer por pedido lo que es por sala.
const PEDIDO_137 = '7b7afb2e-975e-4c90-a5c5-12f3270a876c';
const RUTA_21    = { id: 'b5fa8fcf-61dd-448d-8f17-071337e834c9', numero: 21, status: 'en_ruta', conductor_id: 'josue' };

const SALUD_1 = {
    pedido_id: PEDIDO_137, erp_sucursal_id: 1, codigo: '07-240826-2-S1',
    pedido_status: 'enviado',
    iniciado_at:   '2026-08-24T15:44:31Z',
    finalizado_at: '2026-08-24T17:51:12Z',
    enviado_at:    '2026-08-24T17:51:31Z',   // su parada: la ruta #21
};
const SALUD_2 = {
    pedido_id: PEDIDO_137, erp_sucursal_id: 2, codigo: '09-240826-2-S2',
    pedido_status: 'enviado',                // ← el estado es del PEDIDO
    iniciado_at: null, finalizado_at: null,
    enviado_at: null,                        // sin parada propia
};

// La ruta #21 tal como la devuelve la base: una parada, la de Salud 1.
const MAPA = new Map([
    [claveParada(PEDIDO_137, 1), {
        ruta: RUTA_21, driverOnline: true,
        stop: { id: 'stop-1', pedido_id: PEDIDO_137, erp_sucursal_id: 1, orden_entrega: 1, entregado_at: null },
    }],
]);

describe('una ruta agrupa sus paradas, no los pedidos de sus paradas', () => {
    it('la sala sin parada NO entra al grupo de la ruta', () => {
        const grupos = agruparPorRuta([SALUD_1, SALUD_2], MAPA, 'josue');
        const enRuta = grupos.find(g => g.isRuta);
        expect(enRuta.ruta.numero).toBe(21);
        expect(enRuta.rows.map(r => r.codigo)).toEqual(['07-240826-2-S1']);
    });

    it('y queda con el resto, fuera de toda ruta', () => {
        const grupos = agruparPorRuta([SALUD_1, SALUD_2], MAPA, 'josue');
        const sueltas = grupos.find(g => !g.isRuta);
        expect(sueltas.rows.map(r => r.codigo)).toEqual(['09-240826-2-S2']);
    });

    it('el grupo de la ruta tiene tantas filas como entregas anuncia', () => {
        // El encabezado dice «0/1 entregas» leyendo `ruta_pedidos`, y el cuerpo
        // pintaba 2 tarjetas. Que los dos números salgan del mismo lado es la
        // prueba: un grupo con más filas que paradas es el defecto.
        const grupos = agruparPorRuta([SALUD_1, SALUD_2], MAPA, 'josue');
        const enRuta = grupos.find(g => g.isRuta);
        const paradas = [...MAPA.values()].filter(v => v.ruta.id === RUTA_21.id).length;
        expect(enRuta.rows.length).toBe(paradas);
    });

    it('dos salas de un mismo pedido en la misma ruta sí van juntas', () => {
        // El arreglo separa por sala, no rompe el agrupado: cuando las dos
        // tienen parada, las dos entran.
        const mapaCompleto = new Map(MAPA);
        mapaCompleto.set(claveParada(PEDIDO_137, 2), {
            ruta: RUTA_21, driverOnline: true,
            stop: { id: 'stop-2', pedido_id: PEDIDO_137, erp_sucursal_id: 2, orden_entrega: 2, entregado_at: null },
        });
        const grupos = agruparPorRuta([SALUD_1, { ...SALUD_2, enviado_at: '2026-08-24T17:51:31Z' }], mapaCompleto, 'josue');
        expect(grupos.filter(g => g.isRuta)).toHaveLength(1);
        expect(grupos.find(g => g.isRuta).rows).toHaveLength(2);
        expect(grupos.find(g => !g.isRuta)).toBeUndefined();
    });

    it('cada tarjeta encuentra SU parada y no la de la vecina', () => {
        // El nodo «Entregado» de Salud 2 mostraba la cara del conductor porque
        // la búsqueda caía en la parada de Salud 1.
        expect(MAPA.get(claveParada(PEDIDO_137, 1))?.stop.id).toBe('stop-1');
        expect(MAPA.get(claveParada(PEDIDO_137, 2))).toBeUndefined();
    });
});

describe('el estado que pinta una tarjeta es el de su sala', () => {
    it('la sala que no salió no está en tránsito, aunque el pedido sí', () => {
        expect(getBranchStage(SALUD_2)).toBe('sin_iniciar');
        expect(estadoDeLaSala(SALUD_2)).toBe('confirmado');   // «Por despachar»
    });

    it('la sala que salió sí', () => {
        expect(getBranchStage(SALUD_1)).toBe('transito');
        expect(estadoDeLaSala(SALUD_1)).toBe('enviado');      // «En ruta»
    });

    it('una sala lista pero todavía en bodega no viaja con la ruta de su hermana', () => {
        // El otro lado del mismo defecto: preparada y esperando la próxima ruta.
        // Con la regla vieja —`finalizado_at` + pedido «enviado»— aparecía en
        // tránsito sin haberse movido.
        const lista = { ...SALUD_2, finalizado_at: '2026-08-24T18:20:00Z' };
        expect(getBranchStage(lista)).toBe('preparado');
        expect(estadoDeLaSala(lista)).toBe('confirmado');
    });

    it('la diferencia de una sala no marca a las otras', () => {
        const conDif = { ...SALUD_1, pedido_status: 'parcial', diferencias_reportadas_at: '2026-08-24T19:00:00Z' };
        const limpia = { ...SALUD_1, pedido_status: 'parcial' };
        expect(estadoDeLaSala(conDif)).toBe('parcial');
        expect(estadoDeLaSala(limpia)).toBe('enviado');
    });

    it('el ingreso al sistema la cierra', () => {
        expect(estadoDeLaSala({ ...SALUD_1, recibido_erp_at: '2026-08-24T21:00:00Z' })).toBe('completado');
    });

    it('un pedido anulado manda sobre todo', () => {
        expect(estadoDeLaSala({ ...SALUD_1, pedido_status: 'anulado' })).toBe('anulado');
    });
});

// `canIniciar` y `canMarcarEnRuta` (TabPedidos) son `stage === … && estadoSala
// === 'confirmado'`. Antes pedían `pedido_status === 'confirmado'`, y con eso
// Salud 2 quedó SIN el botón «Iniciar»: la primera sala que salía ponía el
// PEDIDO en «enviado» y dejaba a las demás sin forma de empezar a prepararse.
// La base nunca lo impidió — `update_pedido_sucursal_lifecycle` mira la fila de
// la sala y ni consulta el estado del pedido.
describe('la sala que no salió puede prepararse y despacharse', () => {
    // Se importan, NO se reescriben acá: la primera versión de esta prueba
    // copiaba la expresión y pasaba en verde con el defecto puesto.
    const puedeIniciar   = puedePrepararse;
    const puedeCrearRuta = puedeDespacharse;

    it('«Iniciar» aparece aunque el pedido ya vaya en ruta por otra sala', () => {
        expect(puedeIniciar(SALUD_2)).toBe(true);
    });

    it('y «Crear ruta» aparece cuando termina de prepararse', () => {
        const lista = { ...SALUD_2, iniciado_at: '2026-08-24T20:00:00Z', finalizado_at: '2026-08-24T20:40:00Z' };
        expect(puedeCrearRuta(lista)).toBe(true);
    });

    it('pero no se puede iniciar dos veces la que ya salió', () => {
        expect(puedeIniciar(SALUD_1)).toBe(false);
        expect(puedeCrearRuta(SALUD_1)).toBe(false);
    });
});

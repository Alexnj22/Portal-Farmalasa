// Pedidos: las reglas de despacho (qué presentación y cuánto sale de Bodega),
// el armado de una ruta de reparto (paradas, tiempos y lo que se guarda) y la
// validación del MIN·MAX que se ajusta desde el pedido. Núcleo compartido con
// el teléfono: el portal y la app tienen que armar la MISMA ruta y rechazar el
// MISMO MIN·MAX.
import { describe, expect, it } from 'vitest';
import {
    MULTIPLOS, SIN_REGLA, NECESIDAD_EJEMPLO, calcularDespacho, valoresDeRegla, payloadDeRegla,
    presentacionesOfrecidas, rotuloDeRegla,
} from '@nucleo/utils/reglasDeDespacho';
import {
    MINUTOS_POR_PARADA, reenviosParaRuta, pedidosParaRuta, nombresDeSalas, paradasDeSalas, juntarParadas,
    lineaDeTiempo, paradasParaGuardar, visitasDeRuta, minutosTexto,
} from '@nucleo/utils/armarRutaDeReparto';
import { validarMinMax, mensajeDeMinMax } from '@nucleo/utils/minmaxDesdePedido';

describe('reglasDeDespacho', () => {
    it('sin etiqueta redondea al múltiplo en UNIDADES', () => {
        expect(NECESIDAD_EJEMPLO).toBe(7);
        expect(calcularDespacho(5, '')).toEqual({ porEtiqueta: false, cantidad: 10 });
        expect(calcularDespacho(1, '')).toEqual({ porEtiqueta: false, cantidad: 7 });
        expect(calcularDespacho(7, null)).toEqual({ porEtiqueta: false, cantidad: 7 });
    });

    it('con etiqueta y múltiplo > 1 se cuentan CAJAS, no unidades', () => {
        expect(calcularDespacho(5, 'CAJA')).toEqual({ porEtiqueta: true, cantidad: 2 });
        expect(calcularDespacho(10, 'BOLSA', 30)).toEqual({ porEtiqueta: true, cantidad: 3 });
        // múltiplo 1 con etiqueta: la etiqueta no cambia nada
        expect(calcularDespacho(1, 'CAJA')).toEqual({ porEtiqueta: false, cantidad: 7 });
    });

    it('un múltiplo inválido cuenta como 1', () => {
        expect(calcularDespacho(0, '')).toEqual({ porEtiqueta: false, cantidad: 7 });
        expect(calcularDespacho(-3, 'CAJA')).toEqual({ porEtiqueta: false, cantidad: 7 });
        expect(MULTIPLOS).toContain(1);
    });

    it('valoresDeRegla: sin regla, los del editor vacío; con regla, el múltiplo como texto', () => {
        expect(valoresDeRegla(null)).toEqual(SIN_REGLA);
        expect(valoresDeRegla({ dispatch_id_presentacion: 9, dispatch_multiplo: 5, dispatch_label: 'CAJA', caja_especial: true }))
            .toEqual({ dispatch_id_presentacion: 9, dispatch_multiplo: '5', notes: '', dispatch_label: 'CAJA', caja_especial: true });
    });

    it('payloadDeRegla limpia vacíos, numera el múltiplo y apaga lo viejo', () => {
        const p = payloadDeRegla('P1', { dispatch_id_presentacion: 9, dispatch_multiplo: 'abc', dispatch_label: '', notes: '' });
        expect(p).toMatchObject({
            erp_product_id: 'P1', dispatch_id_presentacion: 9, dispatch_multiplo: 1, dispatch_label: null,
            caja_especial: false, solo_cajas: false, multiplo: null, blister: null, multiplo_unidades: null, notes: null,
        });
        expect(Number.isNaN(Date.parse(p.updated_at))).toBe(false);
        // ida y vuelta: lo que el editor muestra de una regla vuelve a guardarse igual
        const regla = { dispatch_id_presentacion: 3, dispatch_multiplo: 25, dispatch_label: 'ESTUCHE', notes: 'frágil', caja_especial: true };
        expect(payloadDeRegla('P2', valoresDeRegla(regla))).toMatchObject(regla);
    });

    it('presentacionesOfrecidas: una por factor, de mayor a menor, conservando la vigente', () => {
        const pres = [
            { id_presentacion: 1, factor: 1, tipo: 'UND' },
            { id_presentacion: 2, factor: 10, tipo: 'BLISTER' },
            { id_presentacion: 3, factor: 10, tipo: 'SOBRE' },
            { id_presentacion: 4, factor: 100, tipo: 'CAJA' },
            { id_presentacion: 2, factor: 10, tipo: 'BLISTER' },   // repetida
        ];
        expect(presentacionesOfrecidas(pres).map(p => p.id_presentacion)).toEqual([4, 2, 1]);
        // si la regla vigente es la SOBRE (factor 10), es ésa la que se ofrece
        expect(presentacionesOfrecidas(pres, 3).map(p => p.id_presentacion)).toEqual([4, 3, 1]);
        expect(presentacionesOfrecidas()).toEqual([]);
    });

    it('rotuloDeRegla lee las reglas nuevas y las viejas', () => {
        expect(rotuloDeRegla(null)).toBeNull();
        expect(rotuloDeRegla({ dispatch_id_presentacion: 4, dispatch_label: 'CAJA', dispatch_multiplo: 5 })).toBe('CAJA ×5');
        expect(rotuloDeRegla({ dispatch_id_presentacion: 4, presentaciones: { tipo: 'BLISTER' } })).toBe('BLISTER');
        expect(rotuloDeRegla({ dispatch_id_presentacion: 4 })).toBe('–');
        expect(rotuloDeRegla({ multiplo: 2 })).toBe('×2 cajas');
        expect(rotuloDeRegla({ blister: 3 })).toBe('×3 blíst.');
        expect(rotuloDeRegla({ multiplo_unidades: 12 })).toBe('×12u');
        expect(rotuloDeRegla({})).toBe('Solo cajas');
    });
});

describe('armarRutaDeReparto', () => {
    const nombres = { 2: 'Salud 2', 5: 'Salud 5' };

    it('los reenvíos van marcados, cuentan cajas y especiales, y caen a «Suc. N» sin nombre', () => {
        const [r, s] = reenviosParaRuta([
            { erp_sucursal_id: 2, cajas: [1, 2], especiales: [9], electrolits: 1, reenvio_ciclo: 3 },
            { erp_sucursal_id: 7 },
        ], nombres);
        expect(r).toMatchObject({ esReenvio: true, suc_name: 'Salud 2', total_cajas: 3, cajas_electrolit: 1, cajas_especiales: [], reenvio_ciclo: 3 });
        expect(s).toMatchObject({ suc_name: 'Suc. 7', total_cajas: 0, cajas_electrolit: 0 });
    });

    it('pedidosParaRuta une sala y pedido, y descarta las salas de pedidos que ya no están', () => {
        const items = pedidosParaRuta(
            [{ id: 10, numero: 97 }],
            [{ pedido_id: 10, erp_sucursal_id: 2, total_cajas: 4 }, { pedido_id: 99, erp_sucursal_id: 5 }],
            nombres,
        );
        expect(items).toEqual([{
            key: '10__2', pedido_id: 10, numero: 97, erp_sucursal_id: 2, suc_name: 'Salud 2',
            total_cajas: 4, cajas_electrolit: 0, cajas_especiales: [],
        }]);
    });

    it('nombresDeSalas toma el nombre de la sucursal o el respaldo', () => {
        expect(nombresDeSalas([{ erp_sucursal_id: 2, branch: { name: 'Salud 2' } }, { erp_sucursal_id: 8 }]))
            .toEqual({ 2: 'Salud 2', 8: 'Suc. 8' });
    });

    it('paradasDeSalas junta los pedidos de una misma sala y aparta las que no tienen ubicación', () => {
        const { conUbicacion, sinUbicacion } = paradasDeSalas([
            { erp_sucursal_id: 2, suc_name: 'Salud 2', pedido_id: 10 },
            { erp_sucursal_id: 2, suc_name: 'Salud 2', pedido_id: 11 },
            { erp_sucursal_id: 5, suc_name: 'Salud 5', pedido_id: 10 },
        ], { 2: { lat: 14.03, lng: -88.93 } });
        expect(conUbicacion).toHaveLength(1);
        expect(conUbicacion[0].items.map(i => i.pedido_id)).toEqual([10, 11]);
        expect(sinUbicacion.map(s => s.erp_sucursal_id)).toEqual([5]);
    });

    it('juntarParadas manda al final las sin ubicación, sin tramo medido, con identificador único', () => {
        const r = juntarParadas([{ erp_sucursal_id: 2, orden: 1, dist_m: 900, dur_min: 4 }], [{ erp_sucursal_id: 5 }], 123);
        expect(r[1]).toMatchObject({ erp_sucursal_id: 5, orden: 2, dist_m: null, dur_min: null, _uid: 'stop-1-123' });
        expect(new Set(r.map(s => s._uid)).size).toBe(2);
    });

    it('lineaDeTiempo suma cajas por parada y acumula el manejo', () => {
        const t = lineaDeTiempo([
            { dur_min: 10, items: [{ total_cajas: 3, cajas_electrolit: 1, cajas_especiales: ['a'] }, { total_cajas: 2 }] },
            { dur_min: null, items: [] },
            { dur_min: 7 },
        ]);
        expect(t.map(x => [x.cajas, x.electrolit, x.especiales, x.manejo, x.acumulado]))
            .toEqual([[5, 1, 1, 10, 10], [0, 0, 0, 0, 10], [0, 0, 0, 7, 17]]);
        expect(t.every(x => x.descarga === MINUTOS_POR_PARADA)).toBe(true);
    });

    it('lo que se guarda: un renglón por pedido de cada parada real; los encargos van a visitas', () => {
        const paradas = [
            { orden: 1, dist_m: 500, dur_min: 3, items: [{ pedido_id: 10, erp_sucursal_id: 2, reenvio_ciclo: 2 }, { pedido_id: 11, erp_sucursal_id: 2 }] },
            { orden: 2, isEncargo: true, erp_sucursal_id: 5, suc_name: 'Salud 5', items: [] },
        ];
        expect(paradasParaGuardar(paradas)).toEqual([
            { pedido_id: 10, erp_sucursal_id: 2, orden_entrega: 1, dist_m: 500, dur_min: 3, reenvio_ciclo: 2 },
            { pedido_id: 11, erp_sucursal_id: 2, orden_entrega: 1, dist_m: 500, dur_min: 3, reenvio_ciclo: null },
        ]);
        expect(visitasDeRuta(paradas)).toEqual([{ erp_sucursal_id: 5, suc_name: 'Salud 5', orden: 2, dist_m: null, dur_min: null }]);
    });

    it('minutosTexto: nada para cero, minutos, u horas y minutos', () => {
        expect(minutosTexto(0)).toBeNull();
        expect(minutosTexto(null)).toBeNull();
        expect(minutosTexto(45)).toBe('45 min');
        expect(minutosTexto(60)).toBe('1h 0min');
        expect(minutosTexto(125)).toBe('2h 5min');
    });
});

describe('minmaxDesdePedido', () => {
    it('acepta los pares que permite el CHECK de la base', () => {
        expect(validarMinMax({ min: '0', max: '0' })).toBeNull();
        expect(validarMinMax({ min: '0', max: '1' })).toBeNull();
        expect(validarMinMax({ min: 3, max: 6 })).toBeNull();
    });

    it('rechaza cada caso con su motivo en palabras', () => {
        expect(validarMinMax({ min: '', max: '3' })).toBe('MIN inválido');
        expect(validarMinMax({ min: '-1', max: '3' })).toBe('MIN inválido');
        expect(validarMinMax({ min: '1', max: 'x' })).toBe('MAX inválido');
        expect(validarMinMax({ min: '0', max: '2' })).toBe('Con MIN=0, MAX debe ser 0 o 1');
        expect(validarMinMax({ min: '3', max: '3' })).toBe('MAX debe ser mayor que MIN');
        expect(validarMinMax({ min: '4', max: '2' })).toBe('MAX debe ser mayor que MIN');
    });

    it('traduce el «check constraint» de la base y deja pasar otros mensajes', () => {
        expect(mensajeDeMinMax({ message: 'new row violates CHECK CONSTRAINT "chk_min_lt_max"' })).toMatch(/^Valor fuera del rango/);
        expect(mensajeDeMinMax({ message: 'sin permiso' })).toBe('sin permiso');
        expect(mensajeDeMinMax(null)).toBe('No se pudo guardar.');
    });
});

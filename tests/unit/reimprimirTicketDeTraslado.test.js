import { describe, it, expect } from 'vitest';
import { datosDelTicketGuardado } from '../../src/utils/imprimirTraslado';
import { construirTicketDeTraslado } from '../../src/utils/trasladoTicket';

/**
 * Reimprimir tiene que sacar el MISMO papel, y ahí está todo el riesgo.
 *
 * El ticket no se guarda en ninguna parte: se vuelve a armar desde
 * `metadata.erp_traslado`. Un mapeo que tome el campo equivocado no falla —
 * saca un papel plausible que dice otra cosa, pegado a una bolsa real. Por eso
 * el `metadata` de estas pruebas es una copia de una fila de PRODUCCIÓN
 * (traslado 33092, Bodega → Salud 3, medido el 2026-08-24) y no un invento.
 */

const META_REAL = {
    items: [{
        lotes: [{ lote: '24462', vence: '2029-01-01', unidades: 2 }],
        factor: 1,
        cantidad: 2,
        descripcion: 'COLPOSAN CREMA VAGINAL 50 GR',
        erp_product_id: 2582,
        presentacion_tipo: 'TUBO',
    }],
    reason: 'PARA VENTA',
    branch_id: 27,
    branch_name: 'Salud 3',
    erp_traslado: {
        at: '2026-08-24T20:17:17.063Z',
        by: 'abe9b2a8-5328-4307-a00d-84ac4037f76f',
        total: 32.319,
        lineas: 1,
        by_name: 'Josue Guevara',
        by_sala: 'BO',
        detalle: [{
            cantidad: 2,
            descripcion: 'COLPOSAN CREMA VAGINAL 50 GR',
            numero_lote: '24462',
            erp_product_id: 2582,
        }],
        id_traslado: '33092',
    },
    origen_branch_id: 30,
    origen_branch_name: 'Bodega',
};

describe('el ticket que se vuelve a armar', () => {
    it('sale con el número, el origen, el destino y quién despachó', () => {
        const d = datosDelTicketGuardado(META_REAL, { pide: 'Amadeo Clemente' });

        expect(d.aplicado.id_traslado).toBe('33092');
        expect(d.aplicado.by_name).toBe('Josue Guevara');
        expect(d.aplicado.at).toBe('2026-08-24T20:17:17.063Z');
        expect(d.origen).toBe('Bodega');
        expect(d.destino).toBe('Salud 3');
        expect(d.pide).toBe('Amadeo Clemente');
    });

    it('lista lo que VIAJÓ, no lo que se pidió', () => {
        // La trampa: un despacho puede salir recortado. Si el papel se armara
        // desde `items` diría más de lo que hay en la bolsa, y quien la abre le
        // cree al papel — la diferencia se reportaría como faltante.
        const recortado = {
            ...META_REAL,
            items: [
                ...META_REAL.items,
                { cantidad: 9, descripcion: 'ALGO QUE NO SALIO' },
            ],
        };
        const d = datosDelTicketGuardado(recortado, {});

        expect(d.items).toEqual([{ nombre: 'COLPOSAN CREMA VAGINAL 50 GR', cantidad: 2 }]);
    });

    it('cae a lo pedido sólo cuando la fila vieja no trae detalle', () => {
        const sinDetalle = {
            ...META_REAL,
            erp_traslado: { ...META_REAL.erp_traslado, detalle: undefined },
        };
        const d = datosDelTicketGuardado(sinDetalle, {});

        expect(d.items).toEqual([{ nombre: 'COLPOSAN CREMA VAGINAL 50 GR', cantidad: 2 }]);
    });

    it('sin número devuelve null — ese papel no se puede rehacer', () => {
        // Sin `id_traslado` no hay código de barras, y un ticket sin barras no
        // se puede confirmar escaneando: no es el mismo papel. El original ya
        // avisaba «SIN NUMERO» y ese traslado se confirma a mano.
        expect(datosDelTicketGuardado({ ...META_REAL, erp_traslado: {} }, {})).toBeNull();
        expect(datosDelTicketGuardado({}, {})).toBeNull();
        expect(datosDelTicketGuardado(null, {})).toBeNull();
    });

    it('el papel que sale es el mismo que el del despacho', () => {
        // La comprobación de punta a punta: se arma el ticket como lo armó el
        // despacho y como lo arma la reimpresión, y se comparan. Es lo único
        // que prueba que el mapeo no perdió un campo por el camino.
        const alDespachar = construirTicketDeTraslado({
            familia: 'solicitud',
            aplicado: {
                id_traslado: '33092', by_name: 'Josue Guevara',
                por_respaldo: false, at: '2026-08-24T20:17:17.063Z',
            },
            origen: 'Bodega',
            destino: 'Salud 3',
            pide: 'Amadeo Clemente',
            items: [{ nombre: 'COLPOSAN CREMA VAGINAL 50 GR', cantidad: 2 }],
        });
        const alReimprimir = construirTicketDeTraslado(
            datosDelTicketGuardado(META_REAL, { pide: 'Amadeo Clemente' }),
        );

        expect(alReimprimir).toEqual(alDespachar);
    });

    it('un envío se rearma como ENVIO y conserva su motivo', () => {
        const envio = { ...META_REAL, motivo: 'Baja rotación' };
        const d = datosDelTicketGuardado(envio, { familia: 'envio' });
        const papel = construirTicketDeTraslado(d);

        expect(papel.encabezado.titulo).toBe('ENVIO');
        expect(papel.bloques.some(b => b.texto?.includes('Baja rotacion'))).toBe(true);
    });
});

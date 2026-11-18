import { describe, expect, it } from 'vitest';
import {
    armarFinalizado, armarGuardado, clienteDePreventa, leerCajaAbierta, leerRenglonesDeLista, motivoParaNoCobrar, totalesDeCobro,
} from '@nucleo/utils/cobroDeCaja.js';

// Forma de la `lista` de `cargar_data` (Salud 4, 2026-11-17), con comillas mezcladas
// como las manda la caja. Los valores son de una preventa real de $1.45.
const fila = (id, pres, lote, cant, precio, sub, clave = 'precio2', extra = '') => `<tr class='row100 head' id='1'${extra}>
  <td class='cell100 column10 text-success'>\n            ${id}\n         </td><td>PRODUCTO</td>
  <input type='hidden' id='unidades' name='unidades' value='1'><input type='hidden' id='exento' name='exento' value='0'>
  <input type="text" class="form-control decimal2 can" id="cant" value="${cant}">
  <select class="form-control lote-select select2"><option data-stock='5' value='${lote}' selected>GENERICO</option></select>
  <select class="sel form-control"><option value="${pres}" selected>UNIDAD</option><option value="1">CAJA</option></select>
  <select class="sel_r form-control"><option title="precio" data-key-precio="precio" value="0.55">0.55</option><option title="${clave}" data-key-precio="${clave}" selected="" value="${precio}">${precio}</option></select>
  <input type='hidden' id='precio_venta' value='${precio}'><input type='hidden' id='id_promo' value='-1'>
  <input type='hidden' id='descuento_promo' value='0'><input type='hidden' id='descuento_tipo' value='-1'>
  <input type='hidden' id='subtotal_fin' value='${sub}'>
</tr>`;
const lista = fila(1418, 1708, 4651, 2, '0.45', '0.9') + fila(1099, 1307, 5412, 1, '0.1', '0.1') + fila(1608, 8362, 23020, 1, '0.45', '0.45');
const caja = { fecha: '2026-11-17', fecha_fact: '17-11-2026', id_apertura: '3001', turno: '1', caja: '5' };
const cabecera = { id_cliente: '13810', tipo_documento: 'COF', credito: '0', codvende: '309', id_empleado: '59', datos_extras: '', id_medico: '0', id_factura: '415145', numero_doc: '0000074_REF' };

describe('cobro de una preventa en la caja', () => {
    it('lee cada producto como lo lee la pantalla (id con sus espacios)', () => {
        const r = leerRenglonesDeLista(lista);
        expect(r).toHaveLength(3);
        expect(r[0]).toMatchObject({ id: '\n            1418\n         ', id_detalle: '', precio: '0.45', cantidad: 2, unidades: '1', subtotal: '0.9',
            id_presentacion: '1708', exento: '0', id_lote: 4651, precio_seleccionado: 'precio2', id_promo: '-1', descuento_promo: '0', descuento_tipo: '-1', invalida: false });
    });

    it('suma como setTotals para consumidor final', () => {
        expect(totalesDeCobro(leerRenglonesDeLista(lista))).toEqual({ gravado: 1.45, exento: 0, total: 1.45, descuento: 0, items: 3 });
    });

    it('arma el guardado con la apertura y sin el campo interno', () => {
        const g = armarGuardado({ renglones: leerRenglonesDeLista(lista), cabecera, caja });
        expect(g).toMatchObject({ process: 'insert', cuantos: '3', total: '1.45', iva: '0.00', subtotal: '1.45', id_factura: '415145',
            id_apertura: '3001', turno: '1', caja: '5', credito: '0', codvende: '309', medico: '', aplica_farmalasa: '1', tipo_impresion: 'COF' });
        expect(g.json_arr).not.toContain('invalida');
        expect(JSON.parse(g.json_arr)).toHaveLength(3);
    });

    it('finaliza como imprimev: consumidor final con el cliente, ticket con su número', () => {
        const guardado = { id_factura: '415145', ultimo: '81023', nombre: 'YNES ANTONIO ARDON', direccion: 'SAN SALVADOR' };
        expect(armarFinalizado({ cabecera, guardado, caja, efectivo: 5 })).toEqual({
            process: 'imprimir_fact', numero_doc: '', tipo_impresion: 'COF', num_doc_fact: '415145', numero_factura_consumidor: '',
            fecha_fact: '17-11-2026', direccion: 'SAN SALVADOR', nombreape: 'YNES ANTONIO ARDON', id_cliente: '13810', efectivo: '5',
        });
        expect(armarFinalizado({ cabecera: { ...cabecera, tipo_documento: 'TIK' }, guardado, caja, efectivo: 5 })).toMatchObject({
            numero_doc: '81023', numero_factura_consumidor: '', nombreape: '', direccion: '', tipo_impresion: 'TIK',
        });
    });

    it('no cobra lo que no está medido', () => {
        const renglones = leerRenglonesDeLista(lista);
        expect(motivoParaNoCobrar({ renglones, tipo_documento: 'COF', cliente_retiene: '', credito: '0' })).toBeNull();
        expect(motivoParaNoCobrar({ renglones, tipo_documento: 'CCF', cliente_retiene: '', credito: '0' })).toMatch(/crédito fiscal/);
        expect(motivoParaNoCobrar({ renglones, tipo_documento: 'COF', cliente_retiene: '1', credito: '0' })).toMatch(/retiene/);
        expect(motivoParaNoCobrar({ renglones, tipo_documento: 'COF', cliente_retiene: '0', credito: '2' })).toMatch(/contado/);
        expect(motivoParaNoCobrar({ renglones: leerRenglonesDeLista(fila(1, 2, 3, 0, '0.45', '0')), tipo_documento: 'COF', credito: '0' })).toMatch(/sin cantidad/);
    });

    it('lee la caja abierta y el cliente elegido', () => {
        const pag = `<input type="hidden" id="fecha" value="2026-11-17"><input type='hidden' name='id_apertura' id='id_apertura' value='3001'>
          <input type="hidden" id="turno" value="1"><input type="hidden" id="caja" value="5"><input type="text" id="fecha_fact" value="17-11-2026">`;
        expect(leerCajaAbierta(pag)).toEqual(caja);
        expect(leerCajaAbierta('<input id="fecha" value="2026-11-17">')).toBeNull();
        expect(clienteDePreventa("<option value='-1'>VARIOS</option><option value='13810' selected>YNES</option>")).toBe('13810');
    });
});

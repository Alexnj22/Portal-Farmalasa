import { describe, expect, it } from 'vitest';
import {
    armarFinalizado, armarGuardado, clienteDePreventa, datosExtrasDelPago, problemaDelPago, recalcularRenglones, leerCajaAbierta, leerRenglonesDeLista, motivoParaNoCobrar, totalesDeCobro,
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
        expect(totalesDeCobro(leerRenglonesDeLista(lista))).toEqual({
            gravado: 1.45, exento: 0, iva: 0, gravado_iva: 1.45, retencion: 0, percepcion: 0, total: 1.45, descuento: 0, items: 3, mixto: false,
        });
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
        expect(motivoParaNoCobrar({ renglones, tipo_documento: 'COF' })).toBeNull();
        expect(motivoParaNoCobrar({ renglones, tipo_documento: 'CCF' })).toBeNull();
        expect(motivoParaNoCobrar({ renglones, tipo_documento: '' })).toMatch(/documento/);
        expect(motivoParaNoCobrar({ renglones: leerRenglonesDeLista(fila(1, 2, 3, 0, '0.45', '0')), tipo_documento: 'COF' })).toMatch(/sin cantidad/);
    });

    it('pide a cada forma de pago lo suyo y lo escribe ordenado para la caja', () => {
        const base = { total: 10, efectivo: 10 };
        expect(problemaDelPago({ ...base, pago: 'contado' })).toBeNull();
        expect(problemaDelPago({ ...base, pago: 'contado', efectivo: 9.99 })).toMatch(/no alcanza/);
        expect(problemaDelPago({ ...base, pago: 'tarjeta', detalle: { terminal: '60348001' } })).toMatch(/boleta/);
        expect(problemaDelPago({ ...base, pago: 'tarjeta', detalle: { terminal: '60348001', boleta: '000956' } })).toBeNull();
        expect(problemaDelPago({ ...base, pago: 'transferencia', detalle: { banco: 'Agricola' } })).toMatch(/referencia/);
        expect(problemaDelPago({ ...base, pago: 'credito', clienteGenerico: true })).toMatch(/clientes varios/);
        expect(problemaDelPago({ ...base, pago: 'bitcoin', detalle: { referencia: 'abc' } })).toBeNull();
        expect(problemaDelPago({ ...base, pago: 'otro' })).toMatch(/forma de pago/);
        expect(datosExtrasDelPago('tarjeta', { terminal: '60348001', boleta: ' 000956 ' })).toBe('TARJETA POS 60348001 BOLETA 000956');
        expect(datosExtrasDelPago('contado')).toBe('');
    });

    it('lee la caja abierta y el cliente elegido', () => {
        const pag = `<input type="hidden" id="fecha" value="2026-11-17"><input type='hidden' name='id_apertura' id='id_apertura' value='3001'>
          <input type="hidden" id="turno" value="1"><input type="hidden" id="caja" value="5"><input type="text" id="fecha_fact" value="17-11-2026">`;
        expect(leerCajaAbierta(pag)).toEqual({ ...caja, iva: '0.13', monto_retencion: '100' });
        expect(leerCajaAbierta(`${pag}<input type='hidden' id='porc_iva' value='0.13'><input type='hidden' id='monto_retencion1' value='250'>`).monto_retencion).toBe('250');
        expect(leerCajaAbierta('<input id="fecha" value="2026-11-17">')).toBeNull();
        expect(clienteDePreventa("<option value='-1'>VARIOS</option><option value='13810' selected>YNES</option>")).toBe('13810');
    });
});

import { codificarComoLaCaja } from '@plataforma/impresoraDeLaCaja.js';

describe('el ticket oficial de la caja', () => {
    it('codifica el cuerpo como jQuery.param, que es lo que lee el programa de impresión', () => {
        expect(codificarComoLaCaja({ a: 'x y', b: [1, 2], c: { d: 'é' }, e: null, f: [{ g: 1 }] }))
            .toBe('a=x+y&b%5B%5D=1&b%5B%5D=2&c%5Bd%5D=%C3%A9&e=&f%5B0%5D%5Bg%5D=1');
    });
});

// Una fila con lo que la pantalla usa para recalcular (precio sin IVA y promoción).
const filaCalc = (id, cant, precio, extra = '') => fila(id, 1, 1, cant, precio, '0', 'precio2')
    .replace("<input type='hidden' id='subtotal_fin'", `<input type='hidden' id='precio_sin_iva' value='${precio / 1.13}'>${extra}<input type='hidden' id='subtotal_fin'`);

describe('impuestos como la pantalla de la caja', () => {
    it('crédito fiscal: la fila va sin IVA, como la CCF 409728 (2 × $3.00 = $5.31)', () => {
        const r = recalcularRenglones(leerRenglonesDeLista(filaCalc(3641, 2, 3)), 'CCF');
        expect(r[0].subtotal).toBe('5.3097');
        expect(JSON.stringify(r[0])).not.toContain('precio_sin_iva');
        expect(totalesDeCobro(r, { tipo: 'CCF' })).toMatchObject({ gravado: 5.31, iva: 0.69, total: 6, retencion: 0 });
    });

    it('consumidor final: cantidad × precio, con la promoción en %', () => {
        const conPromo = filaCalc(1, 2, 3, "<input type='hidden' id='descuento_monto' value='10'>").replace("id='descuento_tipo' value='-1'", "id='descuento_tipo' value='%'");
        const r = recalcularRenglones(leerRenglonesDeLista(conPromo), 'COF');
        expect(r[0]).toMatchObject({ subtotal: '5.4', descuento_promo: '0.6' });
    });

    it('retención del cliente que retiene, al centavo de facturas reales', () => {
        const g = (monto) => [{ id: '1', subtotal: String(monto), exento: '0' }];
        // CCF 410964: IVA 44.89, retención 3.45, total 386.73.
        expect(totalesDeCobro(g(345.29), { tipo: 'CCF', retiene: '1', porc_retencion: '0.01' })).toMatchObject({ iva: 44.89, retencion: 3.45, total: 386.73 });
        // COF 414169: retención 1.66, total 186.14.
        expect(totalesDeCobro(g(187.80), { tipo: 'COF', retiene: '1', porc_retencion: '0.01' })).toMatchObject({ iva: 0, retencion: 1.66, total: 186.14 });
        // Menos de $100 no retiene; «retiene 10» tampoco (la caja pone su porcentaje en 0).
        expect(totalesDeCobro(g(99.99), { tipo: 'CCF', retiene: '1', porc_retencion: '0.01' }).retencion).toBe(0);
        expect(totalesDeCobro(g(500), { tipo: 'CCF', retiene: '10', porc_retencion: '0.01' }).retencion).toBe(0);
    });

    it('no cobra exentos y gravados juntos (la pantalla los suma mal)', () => {
        const t = totalesDeCobro([{ id: '1', subtotal: '1', exento: '0' }, { id: '2', subtotal: '2', exento: '1' }]);
        expect(motivoParaNoCobrar({ renglones: [{ invalida: false }], tipo_documento: 'COF', totales: t })).toMatch(/exentos y gravados/);
    });
});

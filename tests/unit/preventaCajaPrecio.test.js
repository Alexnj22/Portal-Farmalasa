// Auditoría de la preventa (2026-11-16): lo que ve quien vende es lo que
// cobra la caja. Una caja de mentira contesta como la de verdad.
import { describe, it, expect } from 'vitest';
import { enviarPreventaALaCaja } from '../../supabase/functions/_shared/preventaCaja.ts';

const tr = (precios, { stock = 50, regulado = false, lotes = '' } = {}) =>
    `<td id='cant_stock'>${stock}</td><input id='exento' name='exento' value='0'>`
    + `<input id='unidades' name='unidades' value='1'>${regulado ? "<x data-regulado='1'>" : ''}${lotes}`
    + `<select class="sel form-control"><option selected value="11">UNIDAD</option></select>`
    + `<select class="sel_r">${precios.map((v, i) => `<option data-key-precio="precio${i || ''}" value="${v}">${v}</option>`).join('')}</select>`;

function caja({ precios, insert = () => JSON.stringify({ typeinfo: 'Success', referencia: '77' }), lista = [], fila = {} }) {
    const enviados = [];
    let refs = [...lista];
    return {
        enviados,
        async get() { return '<input id="fecha" value="2026-11-16">'; },
        async post(_p, d) {
            enviados.push(d);
            if (d.process === 'consultar_stock') return JSON.stringify({ tr: tr(precios, fila) });
            if (d.process === 'get_referencias') {
                return JSON.stringify({ success: true, options: refs.map((r) => `<option value='${r.id}'>${r.ref}|CLIENTE|$${r.total}</option>`).join('') });
            }
            if (d.process === 'insert_preventa') {
                // La venta queda en caja aunque la respuesta se pierda.
                refs = [...refs, { id: '900', ref: '77', total: d.total }];
                return insert(d);
            }
            if (d.process === 'cargar_data') return JSON.stringify({ id_factura: d.n_ref, codvende: '123', lista: '5' });
            return '{}';
        },
    };
}
const venta = (r) => ({
    codigo: 'V-1', documento: 'consumidor_final', vendedor: '123', nota: 'PREVENTA V-1', total: 0,
    cliente: { id: '1', generico: false, motivo: null },
    renglones: [{ reserva_id: 0, producto_id: 5, nombre: 'PRODUCTO', cantidad: 1, factor: 1, lista_precio: 'vip', subtotal: 0, ...r }],
});

describe('enviarPreventaALaCaja: el precio', () => {
    it('caja no tiene el precio de la venta: NO se manda', async () => {
        const http = caja({ precios: ['32.27', '29.70', '28.40'] });
        await expect(enviarPreventaALaCaja(http, venta({ precio: 27.15, precio_normal: 27.15 })))
            .rejects.toThrow(/en caja está a \$32\.27 y la venta dice \$27\.15/);
        expect(http.enviados.some((d) => d.process === 'insert_preventa')).toBe(false);
    });
    it('una oferta de reserva (bajo el normal) sí va, con aviso', async () => {
        const http = caja({ precios: ['10.00', '9.50'] });
        const r = await enviarPreventaALaCaja(http, venta({ precio: 8.0, precio_normal: 10.0 }));
        expect(r.avisos.join(' ')).toMatch(/la reserva es a \$8\.00/);
    });
    it('lista con 4 decimales: precio y subtotal en los mismos centavos que vio quien vende', async () => {
        const http = caja({ precios: ['0.1239'] });
        const r = await enviarPreventaALaCaja(http, venta({ precio: 0.12, precio_normal: 0.12, cantidad: 10 }));
        expect(r.renglones_caja[0]).toMatchObject({ precio: '0.12', subtotal: '1.20' });
        expect(r.total_caja).toBe(1.2);
    });
});

describe('enviarPreventaALaCaja: respuesta perdida', () => {
    it('la caja no contesta pero la venta llegó: se reconoce y no se manda dos veces', async () => {
        const http = caja({ precios: ['4.00'], insert: () => { throw new Error('timeout'); }, lista: [{ id: '10', ref: '5', total: 4 }] });
        const r = await enviarPreventaALaCaja(http, venta({ precio: 4, precio_normal: 4 }));
        expect(r.externo_id).toBe('900');
        expect(r.avisos.join(' ')).toMatch(/sí llegó/);
    });
    it('no contesta y no está: lo dice sin dar la venta por perdida', async () => {
        const http = caja({ precios: ['4.00'], insert: () => 'html roto' });
        http.post = ((orig) => async (p, d) => (d.process === 'get_referencias' ? JSON.stringify({ success: true, options: '' }) : orig(p, d)))(http.post);
        await expect(enviarPreventaALaCaja(http, venta({ precio: 4, precio_normal: 4 })))
            .rejects.toThrow(/Revisa en caja si llegó/);
    });
});

describe('enviarPreventaALaCaja: caja armada de varios lotes', () => {
    it('$10.00 ÷ 3 unidades de tres lotes suma $10.00, no $9.99', async () => {
        const lotes = ['A', 'B', 'C'].map((n, i) => `<option data-stock='1' data-vencimiento='2027-0${i + 1}-01' value='${i + 1}' >${n}</option>`).join('');
        const http = caja({ precios: ['10.00'], fila: { stock: 3, regulado: true, lotes } });
        // La presentación de 3 unidades y la de 1.
        const orig = http.post;
        http.post = async (p, d) => {
            if (d.process === 'consultar_stock') {
                return JSON.stringify({ tr: tr(['10.00'], { stock: 3, regulado: true, lotes })
                    .replace('<option selected value="11">UNIDAD</option>', '<option selected value="11">CAJA X 3</option><option value="12">UNIDAD</option>')
                    .replace("name='unidades' value='1'", "name='unidades' value='3'") });
            }
            if (d.process === 'getpresentacion') {
                return JSON.stringify(d.id_presentacion === '12' ? { unidad: 1, select_rank: '' } : { unidad: 3, select_rank: '<select class="sel_r"><option data-key-precio="precio" value="10.00">x</option></select>' });
            }
            return orig(p, d);
        };
        const r = await enviarPreventaALaCaja(http, venta({ precio: 10, precio_normal: 10, factor: 3 }));
        const suma = r.renglones_caja.reduce((t, x) => t + Number(x.subtotal), 0);
        expect(Math.round(suma * 100) / 100).toBe(10);
        expect(r.total_caja).toBe(10);
    });
});

import { leerReferenciasDePagina } from '../../supabase/functions/_shared/preventaCaja.ts';

describe('la lista de preventas desde la página de la caja', () => {
    it('lee el select aunque el nombre traiga una Ñ mal codificada', () => {
        const html = `<select class="form-control select_r" name="n_ref" id="n_ref">
            <option value="0">Seleccione</option><option value='414765'>1|FRANCISCO NOE LEMUS UMA�A|$30.00</option>                  </select>`;
        expect(leerReferenciasDePagina(html)).toEqual([{ id: '414765', referencia: '1', cliente: 'FRANCISCO NOE LEMUS UMA�A', total: 30 }]);
    });
    it('sin el select no inventa una lista vacía', () => {
        expect(leerReferenciasDePagina('<html></html>')).toBeNull();
    });
});

// @vitest-environment node
// La imprenta del pedido del teléfono (`apps/mobile/motor/motor-pedido.html`)
// tiene que dar las MISMAS hojas que el portal: de eso depende qué producto va
// en qué caja al finalizar. Dos comprobaciones:
//   1. el archivo empaquetado está al día con el código (`pedidoPdfDoc.js`);
//   2. corriendo el archivo TAL CUAL se envía, las hojas de un pedido largo
//      son idénticas a las del camino del portal (misma definición + pdfmake).
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { armarMotor, SALIDA } from '../../scripts/motor-pedido.mjs';
import { prepararHojasExactas } from '@nucleo/utils/pedidoPdfDoc';

const require = createRequire(import.meta.url);
const LOGO = `data:image/png;base64,${fs.readFileSync(path.resolve('public/Logo512.png')).toString('base64')}`;

// Un pedido largo y variado: varios laboratorios, renglones con 1-3 lotes,
// algunos «Bajo receta» (la fila crece) y uno sin existencia (no va al papel).
function pedidoDeEjemplo() {
    const items = [];
    for (let i = 0; i < 140; i++) {
        const lotes = Array.from({ length: (i % 3) + 1 }, (_, k) => ({
            lote: `L${i}-${k}`, fecha_vencimiento: `2027-${String((k % 12) + 1).padStart(2, '0')}-01`, cantidad: 2,
        }));
        items.push({
            id: `it-${i}`,
            cantidad_asignada: 6,
            factor: 1,
            sin_stock: i === 7,
            lotes_asignados: lotes,
            products: {
                nombre: `PRODUCTO ${String(i).padStart(3, '0')} ${'X'.repeat(i % 25)}`,
                es_antibiotico: i % 5 === 0,
                laboratorios: { nombre: `LAB ${String.fromCharCode(65 + (i % 9))}` },
            },
            presentaciones: { tipo: i % 2 ? 'CAJA' : 'BLISTER' },
        });
    }
    return items;
}

let motor;
beforeAll(() => {
    // El archivo que se envía, ejecutado como lo haría el WebView.
    const html = fs.readFileSync(SALIDA, 'utf8');
    const js = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
    const ventana = { ReactNativeWebView: { postMessage() {} } };
    const previa = globalThis.window;
    globalThis.window = ventana;
    try { new Function('window', js)(ventana); } finally { globalThis.window = previa; }
    motor = ventana.motorPedido;
});

describe('imprenta del pedido en el teléfono', () => {
    it('el archivo empaquetado está al día con pedidoPdfDoc', async () => {
        const nuevo = await armarMotor();
        expect(fs.readFileSync(SALIDA, 'utf8') === nuevo,
            'motor-pedido.html está viejo: corre `node scripts/motor-pedido.mjs`').toBe(true);
    }, 60_000);

    it('da las mismas hojas que el camino del portal', async () => {
        const items = pedidoDeEjemplo();
        const addrMap = { 1: 'Calle Morazán, Chalatenango' };

        const delTelefono = await motor.hojas({ sucId: 1, items, addrMap });

        const pm = require('pdfmake/build/pdfmake.js');
        const pdfMake = pm.default || pm;
        const vfs = require('pdfmake/build/vfs_fonts.js');
        pdfMake.addVirtualFileSystem(vfs.default || vfs);
        const captura = prepararHojasExactas(1, items, LOGO, addrMap);
        await pdfMake.createPdf(captura.docDef).getBuffer();
        const delPortal = captura.grupos();

        expect(delPortal.length).toBeGreaterThan(3);          // de verdad son varias hojas
        expect(delTelefono).toEqual(delPortal);
        // Ningún producto queda fuera ni repetido entre hojas.
        const ids = delTelefono.flatMap(g => g.ids);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids.length).toBe(items.filter(i => !i.sin_stock).length);
    }, 60_000);

    it('arma el PDF en base64', async () => {
        const b64 = await motor.pdf({ sections: [{ sucId: 1, nombre: 'Salud 1', codigo: 'X', rows: [], especiales: [], sinCount: 0, revCount: 0 }], title: 'X', meta: {}, addrMap: {} });
        expect(Buffer.from(b64, 'base64').subarray(0, 4).toString()).toBe('%PDF');
    }, 60_000);
});

import { describe, it, expect } from 'vitest';
import {
    buscarTrasladoHuerfano,
    direccionesPorSucursal,
} from '../../supabase/functions/_shared/erp-traslado.ts';
import { presupuestoDelWorker } from '../../supabase/functions/_shared/relojDelWorker.ts';
import real from './fixtures/traslado-huerfano-2026-11-04.json';

// El caso real: pedido 239, Salud 1. La corrida murió a las 16:02:15 con la
// LEVOFLOXACINA tomada; el sistema SÍ creó su traslado (60385) y el portal no
// alcanzó a anotarlo. El último anotado antes de tomarla fue el 60384.
//
// Las páginas son `ver_traslado.php` reales capturadas el 2026-11-05 — la
// 60386 va a otra sala, y `inexistente` es lo que el sistema contesta a un
// número que no existe (la tabla sin filas).

/** Simula la consulta a la base: devuelve cuáles de los pedidos ya tienen dueño. */
const usados = (lista) => async (ids) => new Set(ids.filter((i) => lista.includes(i)));

const dirSalud1 = direccionesPorSucursal(real.select).get('1');
const LEVO = 'LEVOFLOXACINA 500MG X 60 TAB. ECOMED';

/** Lee del fixture; un número que no está devuelve la página vacía real. */
const lector = (paginas = real.paginas) => async (id) => paginas[id] ?? real.paginas.inexistente;

describe('buscarTrasladoHuerfano', () => {
    it('la dirección de Salud 1 sale del select real', () => {
        expect(dirSalud1).toBeTruthy();
    });

    it('encuentra el 60385 — el caso del 2026-11-04', async () => {
        const r = await buscarTrasladoHuerfano({
            desde: 60384, producto: LEVO, dirDestino: dirSalud1,
            yaUsados: usados(['60387', '60388', '60389', '60390', '60391', '60392', '60393', '60394']),
            leer: lector(),
        });
        expect(r).toMatchObject({ estado: 'encontrado', id: '60385' });
    });

    it('un traslado que ya tiene dueño en el portal no es candidato', async () => {
        const r = await buscarTrasladoHuerfano({
            desde: 60384, producto: LEVO, dirDestino: dirSalud1,
            yaUsados: usados(['60385']), leer: lector(),
        });
        expect(r.estado).toBe('no_salio');
    });

    it('el mismo producto a OTRA sala no cuenta', async () => {
        const otra = direccionesPorSucursal(real.select).get('2');
        const r = await buscarTrasladoHuerfano({
            desde: 60384, producto: LEVO, dirDestino: otra,
            yaUsados: usados([]), leer: lector(),
        });
        expect(r.estado).toBe('no_salio');
    });

    it('si no está y se vieron traslados de verdad: no salió', async () => {
        const r = await buscarTrasladoHuerfano({
            desde: 60384, producto: 'PRODUCTO QUE NADIE DESPACHO', dirDestino: dirSalud1,
            yaUsados: usados([]), leer: lector(),
        });
        expect(r.estado).toBe('no_salio');
    });

    it('una página que no se pudo leer NO se toma como «no existe»', async () => {
        const leer = async (id) => {
            if (id === 60385) throw new Error('La sesión del ERP caducó (devolvió el login).');
            return lector()(id);
        };
        const r = await buscarTrasladoHuerfano({
            desde: 60384, producto: LEVO, dirDestino: dirSalud1, yaUsados: usados([]), leer,
        });
        expect(r.estado).toBe('no_se_sabe');
    });

    it('si no se puede preguntar quién ya tiene dueño, no se decide', async () => {
        const r = await buscarTrasladoHuerfano({
            desde: 60384, producto: LEVO, dirDestino: dirSalud1,
            yaUsados: async () => { throw new Error('sin conexión'); }, leer: lector(),
        });
        expect(r.estado).toBe('no_se_sabe');
    });

    it('una página que no es la del traslado (sin tabla) tampoco', async () => {
        const leer = async (id) => (id === 60385 ? '<html>login</html>' : lector()(id));
        const r = await buscarTrasladoHuerfano({
            desde: 60384, producto: LEVO, dirDestino: dirSalud1, yaUsados: usados([]), leer,
        });
        expect(r.estado).toBe('no_se_sabe');
    });

    it('sin ningún traslado en el tramo no hay prueba de que la sesión leyera', async () => {
        const r = await buscarTrasladoHuerfano({
            desde: 70000, producto: LEVO, dirDestino: dirSalud1, yaUsados: usados([]), leer: lector(),
        });
        expect(r.estado).toBe('no_se_sabe');
    });

    it('envío con varios productos: tienen que estar todos en el mismo traslado', async () => {
        const leer = async (id) => {
            if (id !== 60385) return lector()(id);
            // El 60385 real con un segundo renglón: VITADAK 5 INFANTIL.
            return real.paginas[60385].replace('</tbody>', '<tr><td>VITADAK 5 INFANTIL</td><td>UNIDAD</td><td>1</td><td>3</td></tr></tbody>');
        };
        const ambos = await buscarTrasladoHuerfano({
            desde: 60384, producto: [LEVO, 'VITADAK 5 INFANTIL'], dirDestino: dirSalud1, yaUsados: usados([]), leer,
        });
        expect(ambos).toMatchObject({ estado: 'encontrado', id: '60385' });
        const falta = await buscarTrasladoHuerfano({
            desde: 60384, producto: [LEVO, 'AERO OM GOTAS FRESA X 60 ML'], dirDestino: dirSalud1, yaUsados: usados([]), leer: lector(),
        });
        expect(falta.estado).toBe('no_salio');
    });

    it('dos que coinciden: no se elige', async () => {
        const paginas = { ...real.paginas, 60386: real.paginas[60385] };
        const r = await buscarTrasladoHuerfano({
            desde: 60384, producto: LEVO, dirDestino: dirSalud1, yaUsados: usados([]), leer: lector(paginas),
        });
        expect(r).toMatchObject({ estado: 'no_se_sabe', candidatos: ['60385', '60386'] });
    });
});

describe('presupuestoDelWorker', () => {
    const MARGEN = 120_000;

    it('el caso real: worker del simulacro reusado 174 s después', () => {
        const nacio = Date.parse('2026-11-04T15:55:35.500Z');
        const arranque = Date.parse('2026-11-04T15:58:29.000Z');
        const r = presupuestoDelWorker(arranque, 240_000, MARGEN, nacio);
        expect(r.recortado).toBe(true);
        // 400 − 120 − 173.5 = 106.5 s: corta casi dos minutos antes de que lo maten.
        expect(r.ms).toBe(106_500);
    });

    it('worker recién nacido: manda el presupuesto del pedido', () => {
        const t = 1_000_000;
        expect(presupuestoDelWorker(t, 240_000, MARGEN, t)).toEqual({ ms: 240_000, recortado: false });
        expect(presupuestoDelWorker(t, 110_000, MARGEN, t)).toEqual({ ms: 110_000, recortado: false });
    });

    it('worker al borde: cero, nunca negativo', () => {
        const t = 1_000_000;
        expect(presupuestoDelWorker(t + 390_000, 240_000, MARGEN, t).ms).toBe(0);
    });
});

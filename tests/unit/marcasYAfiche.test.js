import { describe, it, expect } from 'vitest';
import { aRelativo, aPixeles, empezarMarca, moverMarca, terminarMarca, marcadosDelArchivo, caminoDeTrazo, anclaDeMarca } from '@nucleo/utils/marcasDeDiseno';
import { svgDeMatriz, htmlDelAfiche, armarAfiche } from '@nucleo/utils/aficheQr';
import { matrizQr as matrizWeb } from '../../src/plataforma/codigoQr';
import { matrizQr as matrizApp } from '../../apps/mobile/plataforma/codigoQr';

describe('marcas sobre el diseño: teléfono y PC caen en el mismo sitio', () => {
    it('un toque en el teléfono y uno en el monitor sobre el mismo punto dan la misma marca', () => {
        // Teléfono: imagen de 343 × 686 pt; PC: la misma imagen a 900 × 1800 px.
        const telefono = aRelativo(85.75, 514.5, 343, 686);
        const pc = aRelativo(225, 1350, 900, 1800);
        expect(telefono).toEqual([0.25, 0.75]);
        expect(pc).toEqual(telefono);
        // Y se dibuja en el mismo lugar relativo en las dos cajas.
        expect(aPixeles(...telefono, 343, 686)).toEqual([85.75, 514.5]);
        expect(aPixeles(...pc, 900, 1800)).toEqual([225, 1350]);
    });
    it('el trazo del portal (caja 100 × 100·proporción) y el de la app (píxeles) son el mismo dibujo escalado', () => {
        const puntos = [[0.1, 0.2], [0.5, 0.5]];
        expect(caminoDeTrazo(puntos, 100, 200)).toBe('M10,40 L50,100');
        expect(caminoDeTrazo(puntos, 343, 686)).toBe('M34.300000000000004,137.20000000000002 L171.5,343');
    });
    it('fuera de la imagen se acota a 0–1', () => {
        expect(aRelativo(-10, 900, 100, 100)).toEqual([0, 1]);
    });
    it('recuadro: se arma desde el origen en cualquier dirección; sin área no se guarda', () => {
        let m = empezarMarca('recuadro', 0.6, 0.6);
        m = moverMarca(m, [0.6, 0.6], 0.2, 0.3);
        expect(m).toEqual({ tipo: 'recuadro', x: 0.2, y: 0.3, w: 0.39999999999999997, h: 0.3 });
        expect(terminarMarca({ tipo: 'recuadro', x: 0.1, y: 0.1, w: 0.005, h: 0.2 })).toBeNull();
    });
    it('trazo: menos de tres puntos es un toque; si no, uno de cada tres más el último, a milésimas', () => {
        expect(terminarMarca({ tipo: 'trazo', puntos: [[0, 0], [1, 1]] })).toBeNull();
        const t = terminarMarca({ tipo: 'trazo', puntos: [[0.11111, 0], [0.2, 0], [0.3, 0], [0.4, 0], [0.55555, 0]] });
        expect(t.puntos).toEqual([[0.111, 0], [0.4, 0], [0.556, 0]]);
        expect(anclaDeMarca(t)).toEqual([0.111, 0]);
    });
    it('numera sólo los comentarios con marca de ESE diseño, en orden', () => {
        const cs = [{ id: 1, archivo_id: 'a', marca: { tipo: 'punto', x: 0, y: 0 } }, { id: 2, archivo_id: 'a' },
            { id: 3, archivo_id: 'b', marca: { tipo: 'punto', x: 0, y: 0 } }, { id: 4, archivo_id: 'a', marca: { tipo: 'punto', x: 1, y: 1 } }];
        expect(marcadosDelArchivo(cs, 'a').map((c) => [c.id, c.numero])).toEqual([[1, 1], [4, 2]]);
    });
});

describe('afiche con QR: el mismo código en la web y en el teléfono', () => {
    const enlace = 'https://portal.farmasalud.lat/encuesta/abc123def456';
    it('los dos adaptadores dan la misma matriz', async () => {
        const w = await matrizWeb(enlace);
        const a = await matrizApp(enlace);
        expect(a.ancho).toBe(w.ancho);
        for (let y = 0; y < w.ancho; y += 1) for (let x = 0; x < w.ancho; x += 1) expect(a.oscuro(x, y)).toBe(w.oscuro(x, y));
    });
    it('el SVG escala sin recortarse y deja la zona tranquila en blanco', async () => {
        const m = await matrizWeb(enlace);
        const svg = svgDeMatriz(m);
        expect(svg).toContain(`viewBox="0 0 ${m.ancho} ${m.ancho}"`);
        expect(svg).toContain('crispEdges');
        expect(m.oscuro(0, 0)).toBe(false);
        expect(m.oscuro(4, 4)).toBe(true); // la esquina del primer patrón de posición
    });
    it('el afiche lleva título, encuesta, sucursal, el QR y el premio si hay puntos; escapa el HTML', async () => {
        const html = await armarAfiche({ encuesta: { nombre: 'Atención <octubre>', incentivo_tipo: 'puntos', incentivo_puntos: 50 }, sucursal: 'Salud 1', enlace });
        expect(html).toContain('¿Cómo te atendimos?');
        expect(html).toContain('Atención &lt;octubre&gt; · Salud 1');
        expect(html).toContain('<svg');
        expect(html).toContain('gana <b>50 puntos</b>');
        expect(html).not.toContain('<script');
        expect(htmlDelAfiche({ encuesta: { nombre: 'X' }, sucursal: 'S', qrSvg: '' })).not.toContain('premio">');
    });
});

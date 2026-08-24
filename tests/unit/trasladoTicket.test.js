import { describe, it, expect } from 'vitest';
import { seccionesParaElPrograma, COLUMNAS_TICKET } from '../../src/utils/ticketPrint';
import {
    construirTicketDeTraslado, salaQueDespacha, SIMBOLOGIA_DEL_TRASLADO, FAMILIAS,
} from '../../src/utils/trasladoTicket';

// El ancla es un traslado REAL: el 32274 del 2026-08-23, Salud 2 -> Salud 1,
// «PIDE HELEN HUEZO (S1) ENV KAREN FIGUEROA (S2)», un renglón de FOSFOCIL. Se
// eligió uno de verdad y no uno inventado porque la forma del `aplicado` —qué
// claves trae, cuáles faltan en el caso normal— es lo que la prueba tiene que
// reproducir, y eso no se adivina leyendo el tipo.
const APLICADO = {
    at: '2026-08-23T22:35:57.478Z',
    by: 'c5d44572-3ff3-4deb-9563-538fd2454877',
    by_name: 'Karen Figueroa',
    by_sala: 'S2',
    id_traslado: '32274',
    numero_vale: '6a8b75caca19d',
    erp_sucursal_origen: 2,
    erp_sucursal_destino: 1,
    lineas: 1,
};

const base = (extra = {}) => construirTicketDeTraslado({
    familia: 'solicitud',
    aplicado: APLICADO,
    origen: 'Salud 2',
    destino: 'Salud 1',
    pide: 'Helen Huezo',
    items: [{ nombre: 'FOSFOCIL 500 X 12 CAPS', cantidad: 1 }],
    ...extra,
});

// Los códigos de impresora ocupan CERO columnas de papel: hay que sacarlos
// enteros antes de medir un renglón. Es la misma limpieza que hace
// `ticketPrint.test.js`, por el mismo motivo.
const sinCodigos = (s) => s
    .replace(/\x1b[@REa!][\s\S]/g, '')
    .replace(/\x1d[hwHV][\s\S]/g, '')
    .replace(/\x1dk[\s\S]*?(?=\n|$)/g, '');
const renglones = (t) => {
    const s = seccionesParaElPrograma(t);
    return (s.encabezado + s.cuerpo + s.pie).split('\n').map(sinCodigos);
};

describe('el ticket de traslado', () => {
    it('pone el número del traslado en el código de barras, y también escrito', () => {
        const t = base();
        expect(t.codigos).toEqual([
            { valor: '32274', simbologia: SIMBOLOGIA_DEL_TRASLADO, leyenda: '32274' },
        ]);
    });

    it('distingue la solicitud del envío en el encabezado', () => {
        expect(base().encabezado.titulo).toBe(FAMILIAS.solicitud);
        expect(base({ familia: 'envio', pide: '' }).encabezado.titulo).toBe(FAMILIAS.envio);
    });

    // Un envío no lo pidió nadie: ése es su significado. El renglón «Pide:» con
    // la nada al lado se leería como un dato que se perdió.
    it('no imprime «Pide» cuando nadie pidió', () => {
        const rotulos = base({ familia: 'envio', pide: '' }).datos.map(([r]) => r);
        expect(rotulos).not.toContain('Pide');
        expect(base().datos.map(([r]) => r)).toContain('Pide');
    });

    // El caso que se ve sólo con el papel en la mano: sin número no hay barras, y
    // un ticket mudo se lee como una impresora que falló.
    it('sin número no dibuja barras, y lo dice', () => {
        const t = base({ aplicado: { ...APLICADO, id_traslado: null } });
        expect(t.codigos).toEqual([]);
        expect(t.bloques.some(b => /SIN NUMERO/.test(b.texto))).toBe(true);
    });

    it('nombra la sala de respaldo cuando despachó otra', () => {
        const t = base({ aplicado: { ...APLICADO, por_respaldo: true }, origen: 'Salud 3' });
        expect(t.bloques.some(b => /Salud 3/.test(b.texto) && /cerrada/.test(b.texto))).toBe(true);
    });

    // El rollo es ASCII: «NUÑEZ» salió `NUÆEZ` la primera vez que se imprimió de
    // verdad, y los nombres de producto vienen de la base sin que nadie los
    // escribiera pensando en papel térmico.
    //
    // La prueba mete acentos en TODOS los campos de texto, no en dos: la primera
    // versión sólo ensuciaba `pide` y el nombre del producto —los dos pasan por
    // `recortar`, que ya pliega— así que daba verde con el plegado del título
    // desarmado. Un detector que no puede fallar no está midiendo nada.
    it('no deja pasar una tilde ni una eñe al rollo, venga del campo que venga', () => {
        const t = base({
            origen:  'Salud Ñ',
            destino: 'Bodegá',
            pide:    'Ana Núñez',
            motivo:  'Próximo a vencer',
            aplicado: { ...APLICADO, by_name: 'José Martínez', por_respaldo: true },
            items: [{ nombre: 'ACEITE GOMENOLADO MORAZÁN X 15 ML', cantidad: 2 }],
        });
        const todo = JSON.stringify(t);
        expect(todo).not.toMatch(/[^\x20-\x7E]/);
        expect(todo).toContain('Ana Nunez');
        expect(todo).toContain('Jose Martinez');
        expect(todo).toContain('Proximo a vencer');
        expect(t.titulo).toBe('Salud N -> Bodega - 32274');
    });

    // Ningún renglón puede pasarse del ancho del rollo: la impresora parte donde
    // se le acaba el papel, a mitad de palabra, y eso sólo se ve en la sala.
    it('ningún renglón se pasa de las 54 columnas', () => {
        const t = base({
            pide: 'Maria Fernanda de los Angeles Villalobos',
            items: [{ nombre: 'UN PRODUCTO CON UN NOMBRE ABSURDAMENTE LARGO QUE NO ENTRA', cantidad: 12 }],
        });
        for (const r of renglones(t)) {
            expect(r.length).toBeLessThanOrEqual(COLUMNAS_TICKET.chica);
        }
    });


    // El recorte a 30 se comía la PRESENTACIÓN, que es lo único que distingue dos
    // productos del mismo nombre. Medido sobre 365 renglones reales de 90 días:
    // máximo 49 caracteres, y 105 (el 29%) pasaban de 30. Los dos nombres de acá
    // son reales: 33 y 45 caracteres.
    it('no se come la presentacion de un nombre largo', () => {
        const t = base({ items: [
            { nombre: 'ACEITE GOMENOLADO MORAZAN X 15 ML', cantidad: 2 },
            { nombre: 'DIENTE DE LEON 350MG X 30 CAPS. PHARMA NATURA', cantidad: 1 },
        ] });
        expect(t.items.filas[0][0]).toBe('ACEITE GOMENOLADO MORAZAN X 15 ML');
        expect(t.items.filas[1][0]).toBe('DIENTE DE LEON 350MG X 30 CAPS. PHARMA NATURA');
    });

    // El papel interno no lleva encabezado de empresa: son cuatro renglones que
    // no le sirven a nadie y el rollo los paga igual.
    it('no imprime el encabezado de la empresa', () => {
        expect(base().encabezado.lineas ?? []).toEqual([]);
    });

    // El título nombra el trabajo en la cola de la sala: sin el número, dos
    // bolsas del mismo par de salas se ven idénticas en la lista.
    it('el título lleva el par de salas y el número', () => {
        expect(base().titulo).toBe('Salud 2 -> Salud 1 - 32274');
    });
});

describe('de qué sala sale la bolsa', () => {
    it('en el caso normal, la sala del producto', () => {
        expect(salaQueDespacha({ aplicado: APLICADO, origen: 'Salud 2', respaldo: 'Salud 3' }))
            .toBe('Salud 2');
    });

    // Medido el 2026-08-24: 53 de los 191 traslados que salen de Bodega los
    // despacha su respaldo. El ticket tiene que decir dónde está la bolsa, y el
    // trabajo de impresión tiene que ir a la caja de ESA sala.
    it('con respaldo, la sala que realmente la tiene', () => {
        expect(salaQueDespacha({
            aplicado: { ...APLICADO, por_respaldo: true }, origen: 'Bodega', respaldo: 'Salud 3',
        })).toBe('Salud 3');
    });

    // Falla segura: si no se sabe quién cubrió, se dice el origen registrado en
    // vez de inventar una sala.
    it('sin saber quién cubrió, cae al origen registrado', () => {
        expect(salaQueDespacha({ aplicado: { ...APLICADO, por_respaldo: true }, origen: 'Bodega' }))
            .toBe('Bodega');
    });
});

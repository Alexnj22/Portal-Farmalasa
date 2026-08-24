// El mes impreso de las bitácoras.
//
// Existe porque el RTS 6.1.14 dice que la documentación debe estar disponible
// dentro del establecimiento, **preferiblemente de manera física**. Que la
// respuesta a «muéstreme la bitácora» sea «déjeme prender la computadora» es lo
// que este documento evita.
//
// Se prueba porque su regla central es lo que un papel NO suele hacer:
//
//   > **El hueco se imprime.** Cada día que tocaba sale con su casilla, y la que
//   > nadie llenó sale vacía y marcada. Un papel que sólo lista lo anotado no se
//   > puede auditar: no distingue «no había que leer» de «nadie leyó», y esa
//   > distinción ES toda la bitácora.
//
// Se mide sobre el HTML que escribe, capturado con una ventana falsa.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { imprimirMesDeBitacoras } from '../../src/utils/bitacoraPrint';

/** Abre el mes y devuelve el HTML que se habría impreso. */
function imprimir(mes) {
    let html = '';
    const win = {
        document: { write: (h) => { html += h; }, close: () => {} },
        focus: () => {}, print: () => {},
    };
    vi.stubGlobal('open', vi.fn(() => win));
    imprimirMesDeBitacoras(mes);
    return html;
}

const MES_BASE = {
    sucursal: 'Salud 4', periodo: '2026-08',
    areas: [], libro: [],
};

// Con reloj falso, el `setTimeout(() => win.print(), 400)` no llega a
// dispararse — que es lo que se quiere: acá se mide el HTML, no la impresión.
beforeEach(() => { vi.useFakeTimers(); vi.unstubAllGlobals(); });
afterEach(() => vi.useRealTimers());

describe('el hueco se imprime', () => {
    const conUnaFalta = {
        ...MES_BASE,
        areas: [{
            nombre: 'Refrigerador', temp_min: 2, temp_max: 8, mide_humedad: false,
            franjas: [{ clave: 'am', label: 'Mañana', desde: '08:00:00', hasta: '10:00:00' },
                      { clave: 'pm', label: 'Tarde',  desde: '16:00:00', hasta: '18:00:00' }],
            dias: [
                { dia: '2026-08-01', lecturas: [{ franja: 'am', temperatura: 5, por: 'Ana Pena', hora: '08:12' }] },
                { dia: '2026-08-02', lecturas: [] },
            ],
        }],
    };

    it('el día que nadie anotó sale con su casilla, marcada', () => {
        const html = imprimir(conUnaFalta);
        expect(html).toContain('class="falta"');
        // Dos franjas × dos días = 4 casillas; una anotada y tres vacías.
        expect(html.match(/class="falta"/g)).toHaveLength(3);
    });

    it('el día anotado lleva quién y a qué hora', () => {
        // ALCOA pide que el registro sea «atribuible».
        const html = imprimir(conUnaFalta);
        expect(html).toContain('Ana Pena');
        expect(html).toContain('08:12');
    });

    it('la leyenda explica qué significa cada marca', () => {
        // Sin la leyenda, un guión en una casilla no dice si faltó la lectura o
        // si ese día no tocaba.
        expect(imprimir(conUnaFalta)).toContain('sin anotar');
    });
});

describe('lo fuera de rango no se esconde: va con su acción', () => {
    const conDesvio = {
        ...MES_BASE,
        areas: [{
            nombre: 'Refrigerador', temp_min: 2, temp_max: 8,
            franjas: [{ clave: 'am', label: 'Mañana', desde: '08:00:00', hasta: '10:00:00' }],
            dias: [{ dia: '2026-08-03', lecturas: [{
                franja: 'am', label: 'Mañana', temperatura: 11, fuera_de_rango: true,
                accion: 'se llamó al técnico', por: 'Ana', hora: '08:05',
            }] }],
        }],
    };

    it('la desviación aparece al pie con la acción correctiva', () => {
        // El ítem 5.6.5 pide investigar y dejar constancia, y en la celda no
        // cabe.
        const html = imprimir(conDesvio);
        expect(html).toContain('Desviaciones y acción correctiva');
        expect(html).toContain('se llamó al técnico');
    });

    it('una desviación sin acción escrita lo DICE, no la omite', () => {
        const sinAccion = structuredClone(conDesvio);
        delete sinAccion.areas[0].dias[0].lecturas[0].accion;
        expect(imprimir(sinAccion)).toContain('sin acción anotada');
    });

    it('la celda queda marcada como fuera de rango', () => {
        expect(imprimir(conDesvio)).toContain('fuera');
    });
});

describe('qué secciones salen y cuáles no', () => {
    it('un área de sólo limpieza NO saca una tabla de temperatura', () => {
        // Vitrinas y servicio sanitario no tienen franjas: su tabla saldría con
        // la columna «Día» sola.
        const html = imprimir({
            ...MES_BASE,
            areas: [{ nombre: 'Vitrinas', franjas: [],
                      limpiezas: [{ clave: 'am', label: 'Mañana' }],
                      dias: [{ dia: '2026-08-01', limpiezas: [{ turno: 'am', hecha: true, por: 'Ana' }] }] }],
        });
        // La PORTADA siempre lleva los dos resúmenes —cumplimiento de lectura y
        // de limpieza—, así que lo que se comprueba es la tabla de DETALLE: el
        // área sale bajo «Limpieza y orden» y no tiene encabezado propio de
        // temperatura (que es el que llevaría su rango en °C).
        expect(html).toContain('Limpieza y orden — Vitrinas');
        expect(html).not.toContain('<h3>Vitrinas ·');
        expect(html).not.toContain('sin rango');
    });

    it('el libro de receta sale SIEMPRE, aunque esté vacío', () => {
        // Es el que el inspector pide primero. Que no salga porque no hubo
        // renglones se lee como que no se lleva.
        const html = imprimir(MES_BASE);
        expect(html).toContain('Libro de dispensación bajo receta');
        expect(html).toContain('Sin renglones en el período');
    });

    it('el libro trae lo que exige el ítem 3.5 de la Guía de BPAD', () => {
        const html = imprimir({
            ...MES_BASE,
            libro: [{ folio: 1, fecha: '2026-08-04', producto: 'AMOXICILINA 500',
                      laboratorio: 'Lab X', cantidad: 12, lote: 'L5M5137', vence: '2027-01-31',
                      paciente: 'Juan Perez', medico: 'Dra. Sol', numero_junta: 'JVPM-123',
                      receta: 'R-88', documento: 'DUI 000', vendedor: 'Ana' }],
        });
        for (const dato of ['AMOXICILINA 500', 'Lab X', 'L5M5137', 'Juan Perez',
                            'Dra. Sol', 'JVPM-123', 'Ana'])
            expect(html).toContain(dato);
    });

    it('una fila anulada dice ANULADA y su motivo, no desaparece', () => {
        // Es un libro foliado: un folio que se borra deja un salto que nadie
        // puede explicar.
        const html = imprimir({
            ...MES_BASE,
            libro: [{ folio: 7, fecha: '2026-08-04', producto: 'X', cantidad: 1,
                      estado: 'anulada', motivo_anulacion: 'se anuló la venta' }],
        });
        expect(html).toContain('ANULADA');
        expect(html).toContain('se anuló la venta');
    });
});

describe('el papel no tiene tema, y el HTML se escapa', () => {
    it('un nombre con `<` no rompe el documento', () => {
        const html = imprimir({ ...MES_BASE, sucursal: 'Salud <4>' });
        expect(html).toContain('Salud &lt;4&gt;');
        expect(html).not.toContain('Salud <4>');
    });

    it('sin mes no abre ninguna ventana', () => {
        const abrir = vi.fn();
        vi.stubGlobal('open', abrir);
        imprimirMesDeBitacoras(null);
        expect(abrir).not.toHaveBeenCalled();
    });

    it('si el navegador bloquea la ventana, no revienta', () => {
        vi.stubGlobal('open', vi.fn(() => null));
        expect(() => imprimirMesDeBitacoras(MES_BASE)).not.toThrow();
    });
});

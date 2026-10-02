import { describe, it, expect } from 'vitest';
import {
    cumpleCondicion, recorrido, preguntasEnOrden, primeraSinContestar, quitarPregunta, cambiarTipo,
    muestraSugerida, metaTotal, telefonoValido, textoDeValor, tablaDeRespuestas, lecturaNps, categoriasDe,
    nuevaOpcion, idNuevo, operadoresPara,
} from '@nucleo/utils/encuestasClientes';

// El cuestionario de la plantilla «Calidad de la atención», recortado: tiene
// una pregunta condicionada a un sí/no y otra a un NPS, que son los dos casos
// que la base (`encuesta_cliente_cumple` / `encuesta_cliente_limpiar`) tiene
// que decidir EXACTAMENTE igual que el navegador.
const CUESTIONARIO = {
    secciones: [
        { id: 's1', titulo: 'Visita', preguntas: [
            { id: 'encontro', tipo: 'si_no', texto: '¿Encontraste todo?', obligatoria: true },
            { id: 'falto', tipo: 'texto', texto: '¿Qué faltó?', obligatoria: true,
              condicion: { pregunta: 'encontro', operador: '=', valor: false } },
            { id: 'espera', tipo: 'unica', texto: 'Espera', obligatoria: true,
              opciones: [{ id: 'a', texto: 'Poco' }, { id: 'b', texto: 'Mucho' }] },
        ] },
        { id: 's2', titulo: 'Cierre', preguntas: [
            { id: 'nps', tipo: 'nps', texto: '¿Nos recomiendas?', obligatoria: true },
            { id: 'mejorar', tipo: 'texto', texto: '¿Qué mejorar?', obligatoria: false,
              condicion: { pregunta: 'nps', operador: '<=', valor: 6 } },
            { id: 'atributos', tipo: 'multiple', texto: 'Palabras', obligatoria: false,
              opciones: [{ id: 'a', texto: 'Confianza' }, { id: 'b', texto: 'Precio' }] },
        ] },
    ],
};

describe('cumpleCondicion — la verdad de JavaScript, igual que la base', () => {
    it('sin condición siempre se muestra', () => {
        expect(cumpleCondicion(null, {})).toBe(true);
        expect(cumpleCondicion({}, {})).toBe(true);
    });
    it('ausente, null y cadena vacía no cumplen nada', () => {
        const c = { pregunta: 'nps', operador: '<=', valor: 6 };
        expect(cumpleCondicion(c, {})).toBe(false);
        expect(cumpleCondicion(c, { nps: null })).toBe(false);
        expect(cumpleCondicion(c, { nps: '' })).toBe(false);
    });
    it('compara números con <=, >= e =', () => {
        expect(cumpleCondicion({ pregunta: 'n', operador: '<=', valor: 6 }, { n: 6 })).toBe(true);
        expect(cumpleCondicion({ pregunta: 'n', operador: '<=', valor: 6 }, { n: 7 })).toBe(false);
        expect(cumpleCondicion({ pregunta: 'n', operador: '>=', valor: 9 }, { n: 9 })).toBe(true);
        expect(cumpleCondicion({ pregunta: 'n', operador: '=', valor: 3 }, { n: 3 })).toBe(true);
    });
    it('un sí/no se compara como booleano: `false` cumple «= No»', () => {
        const c = { pregunta: 's', operador: '=', valor: false };
        expect(cumpleCondicion(c, { s: false })).toBe(true);
        expect(cumpleCondicion(c, { s: true })).toBe(false);
    });
    it('«incluye» sirve para única y múltiple', () => {
        const c = { pregunta: 'o', operador: 'incluye', valor: 'b' };
        expect(cumpleCondicion(c, { o: 'b' })).toBe(true);
        expect(cumpleCondicion(c, { o: ['a', 'b'] })).toBe(true);
        expect(cumpleCondicion(c, { o: ['a'] })).toBe(false);
    });
});

describe('recorrido — qué ve el cliente y qué se manda', () => {
    it('la pregunta condicionada aparece sólo con la respuesta que la abre', () => {
        expect(recorrido(CUESTIONARIO, { encontro: true }).visibles.map((p) => p.id)).not.toContain('falto');
        expect(recorrido(CUESTIONARIO, { encontro: false }).visibles.map((p) => p.id)).toContain('falto');
    });
    it('lo que quedó escondido no viaja, aunque se haya contestado antes', () => {
        const { limpias } = recorrido(CUESTIONARIO, { encontro: true, falto: 'jarabe', nps: 9, mejorar: 'nada' });
        expect(limpias).toEqual({ encontro: true, nps: 9 });
    });
    it('una respuesta escondida no puede abrir otra pregunta (se evalúa contra lo visible)', () => {
        const encadenado = { secciones: [{ id: 's', preguntas: [
            { id: 'a', tipo: 'si_no', texto: 'A' },
            { id: 'b', tipo: 'si_no', texto: 'B', condicion: { pregunta: 'a', operador: '=', valor: true } },
            { id: 'c', tipo: 'texto', texto: 'C', condicion: { pregunta: 'b', operador: '=', valor: true } },
        ] }] };
        // `b` quedó contestada en true, pero `a` la esconde: `c` no se muestra.
        expect(recorrido(encadenado, { a: false, b: true }).visibles.map((p) => p.id)).toEqual(['a']);
    });
    it('recorta los textos y descarta vacíos (cadena en blanco, arreglo vacío)', () => {
        const { limpias } = recorrido(CUESTIONARIO, { encontro: false, falto: '  insulina  ', atributos: [], nps: 3, mejorar: '   ' });
        expect(limpias).toEqual({ encontro: false, falto: 'insulina', nps: 3 });
    });
    it('numera las preguntas de corrido entre secciones', () => {
        expect(preguntasEnOrden(CUESTIONARIO).map((p) => p.numero)).toEqual([1, 2, 3, 4, 5, 6]);
    });
});

describe('obligatorias', () => {
    it('señala la primera obligatoria visible sin contestar', () => {
        const vis = recorrido(CUESTIONARIO, { encontro: false }).visibles;
        expect(primeraSinContestar(vis, { encontro: false })?.id).toBe('falto');
        expect(primeraSinContestar(vis, { encontro: false, falto: 'x', espera: 'a', nps: 10 })).toBeNull();
    });
});

describe('constructor', () => {
    it('quitar una pregunta borra también las condiciones que la miraban', () => {
        const q = quitarPregunta(CUESTIONARIO, 'nps');
        const mejorar = preguntasEnOrden(q).find((p) => p.id === 'mejorar');
        expect(mejorar.condicion).toBeUndefined();
    });
    it('cambiar de tipo conserva el texto y suelta las opciones que ya no aplican', () => {
        const p = cambiarTipo({ id: 'x', tipo: 'unica', texto: 'T', opciones: [{ id: 'a', texto: '1' }] }, 'nps');
        expect(p).toEqual({ id: 'x', tipo: 'nps', texto: 'T' });
        expect(cambiarTipo({ id: 'y', tipo: 'texto', texto: 'T' }, 'multiple').opciones).toHaveLength(2);
    });
    it('una opción nueva toma la letra siguiente libre', () => {
        expect(nuevaOpcion([{ id: 'a' }, { id: 'b' }]).id).toBe('c');
    });
    it('un id nuevo no choca con los usados', () => {
        const usados = Array.from({ length: 50 }, () => idNuevo());
        expect(usados).not.toContain(idNuevo(usados));
    });
    it('sólo las preguntas con valores comparables sirven de condición', () => {
        expect(operadoresPara('texto')).toEqual([]);
        expect(operadoresPara('nps').map((o) => o.value)).toContain('<=');
    });
});

describe('muestra y meta', () => {
    it('la muestra sugerida es la de proporciones al 95% ±5% con población finita', () => {
        expect(muestraSugerida(1509)).toBe(307);   // La Popular, medido en Ajustes
        expect(muestraSugerida(1028)).toBe(280);
        expect(muestraSugerida(1e9)).toBe(385);     // población enorme → 384.16 hacia arriba
        expect(muestraSugerida(0)).toBeNull();
    });
    it('la meta por sucursal es la suma de las cuotas', () => {
        expect(metaTotal({ alcance: 'sucursales' }, [{ meta: 10 }, { meta: 15 }])).toBe(25);
        expect(metaTotal({ alcance: 'general', meta_total: 50 }, [])).toBe(50);
    });
});

describe('teléfono', () => {
    it('8 dígitos que empiezan en 2, 6 o 7, con o sin guion', () => {
        expect(telefonoValido('7777-1234')).toBe(true);
        expect(telefonoValido('2222 1234')).toBe(true);
        expect(telefonoValido('5555-1234')).toBe(false);
        expect(telefonoValido('1234')).toBe(false);
    });
});

describe('resultados y CSV', () => {
    it('el NPS se lee por tramos', () => {
        expect(lecturaNps(60).variant).toBe('success');
        expect(lecturaNps(0).variant).toBe('info');
        expect(lecturaNps(-5).variant).toBe('danger');
        expect(lecturaNps(null).label).toBe('Sin datos');
    });
    it('cada valor se escribe en palabras', () => {
        const [encontro, , espera] = preguntasEnOrden(CUESTIONARIO);
        expect(textoDeValor(encontro, false)).toBe('No');
        expect(textoDeValor(espera, 'b')).toBe('Mucho');
        expect(textoDeValor({ tipo: 'likert' }, 4)).toBe('De acuerdo');
        expect(textoDeValor({ tipo: 'csat' }, 5)).toBe('Muy satisfecho');
    });
    it('las categorías del NPS van de 0 a 10', () => {
        expect(categoriasDe({ tipo: 'nps' })).toHaveLength(11);
    });
    it('el CSV lleva una columna por pregunta, en orden, y el contacto al final', () => {
        const { headers, rows } = tablaDeRespuestas(CUESTIONARIO, [{
            fecha: '2026-10-02T15:00:00Z', sucursal: 'Salud 1', canal: 'qr', nps: 9,
            respuestas: { encontro: true, espera: 'a', nps: 9, atributos: ['a', 'b'] },
            contacto_nombre: 'Ana', telefono: '77771234', duracion_seg: 40,
        }], { fechaHora: () => 'F' });
        expect(headers[5]).toBe('1. ¿Encontraste todo?');
        expect(headers.at(-2)).toBe('Teléfono');
        expect(rows[0]).toEqual(['F', 'Salud 1', 'QR o enlace', '', 9, 'Sí', '', 'Poco', '9', '', 'Confianza; Precio', 'Ana', '77771234', 40]);
    });
});

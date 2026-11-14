import { describe, it, expect } from 'vitest';
import {
    cumpleCondicion, recorrido, preguntasEnOrden, primeraSinContestar, quitarPregunta, cambiarTipo,
    muestraSugerida, metaTotal, telefonoValido, textoDeValor, tablaDeRespuestas, lecturaNps, categoriasDe,
    nuevaOpcion, idNuevo, operadoresPara, tramoNps, guionDeEscala, escalaNumerica, escalaDePregunta,
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
        expect(headers[8]).toBe('1. ¿Encontraste todo?');
        expect(headers.at(-2)).toBe('Teléfono');
        expect(rows[0]).toEqual(['F', 'Salud 1', 'QR o enlace', '', '', '', '', 9, 'Sí', '', 'Poco', '9', '', 'Confianza; Precio', 'Ana', '77771234', 40]);
    });
});

// ── Auditoría 2026-10-31 ───────────────────────────────────────────────────
import {
    condicionValida, limpiarCondiciones, opcionesConTexto, textoSeguroParaHoja,
} from '@nucleo/utils/encuestasClientes';

describe('cumpleCondicion — una comparación numérica exige un número (como la base)', () => {
    it('un Sí/No mirado con «≤ 6» no se cumple: Number(true) daba 1', () => {
        expect(cumpleCondicion({ pregunta: 'x', operador: '<=', valor: 6 }, { x: true })).toBe(false);
        expect(cumpleCondicion({ pregunta: 'x', operador: '=', valor: 1 }, { x: true })).toBe(false);
    });
    it('un texto numérico tampoco cuenta como número', () => {
        expect(cumpleCondicion({ pregunta: 'x', operador: '>=', valor: 3 }, { x: '5' })).toBe(false);
    });
});

describe('primeraSinContestar — sólo espacios es vacío', () => {
    it('la base hace btrim y rechazaría la respuesta', () => {
        const p = [{ id: 't', tipo: 'texto', obligatoria: true }];
        expect(primeraSinContestar(p, { t: '   ' })?.id).toBe('t');
        expect(primeraSinContestar(p, { t: ' hola ' })).toBe(null);
    });
});

describe('opcionesConTexto', () => {
    it('descarta las opciones en blanco igual que `btrim` en la base', () => {
        expect(opcionesConTexto({ opciones: [{ id: 'a', texto: 'x' }, { id: 'b', texto: '  ' }, { id: 'c' }] }).map((o) => o.id)).toEqual(['a']);
    });
});

describe('condicionValida / limpiarCondiciones', () => {
    const base = (mira, condicion) => ({ secciones: [{ id: 's', preguntas: [mira, { id: 'q', tipo: 'texto', texto: 'q', condicion }] }] });
    const condDe = (c) => c.secciones[0].preguntas[1].condicion;

    it('conserva una condición que se puede cumplir', () => {
        const c = base({ id: 'n', tipo: 'nps' }, { pregunta: 'n', operador: '<=', valor: 6 });
        expect(limpiarCondiciones(c)).toBe(c);
    });
    it('quita la condición numérica cuando la pregunta mirada pasa a Sí/No', () => {
        const c = base({ id: 'n', tipo: 'si_no' }, { pregunta: 'n', operador: '<=', valor: 6 });
        expect(condDe(limpiarCondiciones(c))).toBeUndefined();
    });
    it('quita la condición que mira una opción que ya no existe', () => {
        const c = base({ id: 'u', tipo: 'unica', opciones: [{ id: 'a', texto: 'x' }] }, { pregunta: 'u', operador: 'incluye', valor: 'b' });
        expect(condDe(limpiarCondiciones(c))).toBeUndefined();
    });
    it('NO la quita si la opción existe pero se está reescribiendo (texto vacío)', () => {
        const c = base({ id: 'u', tipo: 'unica', opciones: [{ id: 'a', texto: '' }] }, { pregunta: 'u', operador: 'incluye', valor: 'a' });
        expect(condDe(limpiarCondiciones(c))).toEqual({ pregunta: 'u', operador: 'incluye', valor: 'a' });
        // …pero para enviarla a revisión no vale (lo marca la base).
        expect(condicionValida(condDe(c), c.secciones[0].preguntas[0])).toBe(false);
    });
    it('quita la que mira una pregunta posterior', () => {
        const c = { secciones: [{ id: 's', preguntas: [
            { id: 'q', tipo: 'texto', texto: 'q', condicion: { pregunta: 'n', operador: '<=', valor: 6 } },
            { id: 'n', tipo: 'nps' },
        ] }] };
        expect(limpiarCondiciones(c).secciones[0].preguntas[0].condicion).toBeUndefined();
    });
});

describe('textoSeguroParaHoja — lo que escribe un anónimo no se ejecuta en Excel', () => {
    it.each(['=HYPERLINK("http://x","clic")', '+1+1', '@SUM(A1)', '-2+3', '\t=1'])('neutraliza %s', (v) => {
        expect(textoSeguroParaHoja(v)).toBe(`'${v}`);
    });
    it('deja tal cual un texto normal y un número negativo', () => {
        expect(textoSeguroParaHoja('Muy buena atención')).toBe('Muy buena atención');
        expect(textoSeguroParaHoja('-5')).toBe('-5');
        expect(textoSeguroParaHoja('')).toBe('');
    });
    it('tablaDeRespuestas lo aplica a las respuestas abiertas y al nombre', () => {
        const cuest = { secciones: [{ id: 's', preguntas: [{ id: 't', tipo: 'texto', texto: 'T' }] }] };
        const { rows } = tablaDeRespuestas(cuest, [{ fecha: 'x', sucursal: 'S', canal: 'qr', respuestas: { t: '=1+1' }, contacto_nombre: '@x' }], { fechaHora: () => 'f' });
        expect(rows[0]).toContain("'=1+1");
        expect(rows[0]).toContain("'@x");
    });
});

describe('máximo de una múltiple — gemelo de encuesta_cliente_limpiar', () => {
    it('lee el máximo sólo de una múltiple y con un entero válido', async () => {
        const { maximoDe } = await import('@nucleo/utils/encuestasClientes');
        expect(maximoDe({ tipo: 'multiple', maximo: 3 })).toBe(3);
        expect(maximoDe({ tipo: 'multiple' })).toBeNull();
        expect(maximoDe({ tipo: 'multiple', maximo: 0 })).toBeNull();
        expect(maximoDe({ tipo: 'multiple', maximo: 2.5 })).toBeNull();
        expect(maximoDe({ tipo: 'unica', maximo: 3 })).toBeNull();
    });
    it('no deja marcar más del máximo, pero sí desmarcar', async () => {
        const { alternarOpcion } = await import('@nucleo/utils/encuestasClientes');
        expect(alternarOpcion(['a', 'b'], 'c', 3)).toEqual(['a', 'b', 'c']);
        expect(alternarOpcion(['a', 'b', 'c'], 'd', 3)).toEqual(['a', 'b', 'c']);
        expect(alternarOpcion(['a', 'b', 'c'], 'b', 3)).toEqual(['a', 'c']);
        expect(alternarOpcion(['a', 'b', 'c'], 'd', null)).toEqual(['a', 'b', 'c', 'd']);
    });
    it('cambiar a otro tipo quita el máximo', async () => {
        const { cambiarTipo } = await import('@nucleo/utils/encuestasClientes');
        const p = cambiarTipo({ id: 'x', tipo: 'multiple', maximo: 3, opciones: [{ id: 'a', texto: 'A' }, { id: 'b', texto: 'B' }] }, 'unica');
        expect(p.maximo).toBeUndefined();
    });
});

describe('campo — respuestas sin sucursal', () => {
    it('reconoce una fila de campo por branch_id nulo o -1', async () => {
        const { esDeCampo, CAMPO } = await import('@nucleo/utils/encuestasClientes');
        expect(CAMPO).toBe(-1);
        expect(esDeCampo(null)).toBe(true);
        expect(esDeCampo(-1)).toBe(true);
        expect(esDeCampo(5)).toBe(false);
    });
    it('el CSV lleva el lugar y las coordenadas, con el lugar neutralizado', async () => {
        const { tablaDeRespuestas } = await import('@nucleo/utils/encuestasClientes');
        const { headers, rows } = tablaDeRespuestas({ secciones: [] },
            [{ fecha: '2026-11-07', sucursal: 'Campo', canal: 'campo', lugar: '=HYPERLINK("x")', lat: 13.7, lng: -89.2 }],
            { fechaHora: (x) => x });
        expect(headers.slice(0, 6)).toEqual(['Fecha', 'Sucursal', 'Canal', 'Lugar', 'Latitud', 'Longitud']);
        expect(rows[0][2]).toBe('Campo (fuera de las salas)');
        expect(String(rows[0][3]).startsWith('=')).toBe(false);
        expect(rows[0][4]).toBe(13.7);
    });
});

describe('opción que excluye a las demás — gemelo de encuesta_cliente_limpiar', () => {
    const p = { id: 'x', tipo: 'multiple', maximo: 3, opciones: [
        { id: 'a', texto: 'A' }, { id: 'b', texto: 'B' }, { id: 'c', texto: 'C' }, { id: 'd', texto: 'D' },
        { id: 'n', texto: 'Ninguno', exclusiva: true },
    ] };
    it('lee las exclusivas sólo de una múltiple', async () => {
        const { exclusivasDe } = await import('@nucleo/utils/encuestasClientes');
        expect(exclusivasDe(p)).toEqual(['n']);
        expect(exclusivasDe({ ...p, tipo: 'unica' })).toEqual([]);
    });
    it('marcar la exclusiva deja sólo ésa, aun con el máximo lleno', async () => {
        const { alternarOpcion } = await import('@nucleo/utils/encuestasClientes');
        expect(alternarOpcion(['a', 'b', 'c'], 'n', 3, ['n'])).toEqual(['n']);
    });
    it('marcar otra quita la exclusiva', async () => {
        const { alternarOpcion } = await import('@nucleo/utils/encuestasClientes');
        expect(alternarOpcion(['n'], 'a', 3, ['n'])).toEqual(['a']);
        expect(alternarOpcion(['n'], 'n', 3, ['n'])).toEqual([]);
        expect(alternarOpcion(['a', 'b', 'c'], 'd', 3, ['n'])).toEqual(['a', 'b', 'c']);
    });
    it('cambiar a otro tipo quita la marca', async () => {
        const { cambiarTipo } = await import('@nucleo/utils/encuestasClientes');
        expect(cambiarTipo(p, 'unica').opciones.some((o) => 'exclusiva' in o)).toBe(false);
        expect(cambiarTipo(p, 'multiple').opciones.find((o) => o.id === 'n').exclusiva).toBe(true);
    });
});

describe('tramos de la recomendación (NPS)', () => {
    it('corta igual que el NPS: 0–6, 7–8, 9–10', () => {
        expect(tramoNps(0).tono).toBe('danger');
        expect(tramoNps(6).tono).toBe('danger');
        expect(tramoNps(7).tono).toBe('warning');
        expect(tramoNps(8).tono).toBe('warning');
        expect(tramoNps(9).tono).toBe('success');
        expect(tramoNps(10).tono).toBe('success');
        expect(tramoNps(undefined)).toBeNull();
        expect(tramoNps('2')).toBeNull();
    });
    it('el guion sólo sale si la pregunta no dice su escala', () => {
        expect(guionDeEscala({ tipo: 'nps', texto: '¿Qué tan probable es que nos recomiende?' })).toMatch(/del 0 al 10/);
        expect(guionDeEscala({ tipo: 'nps', texto: 'Del 0 al 10, ¿qué tan probable…?' })).toBeNull();
        expect(guionDeEscala({ tipo: 'unica', texto: 'x' })).toBeNull();
    });
});

describe('escala escrita como opción única', () => {
    const op = (n) => ({ id: 'v' + n, texto: String(n) });
    const satisf = { tipo: 'unica', texto: 'Del 1 al 10, ¿qué tan satisfecho está?', ayuda: '1 = nada satisfecho · 10 = muy satisfecho',
        opciones: Array.from({ length: 10 }, (_, i) => op(i + 1)) };
    it('reconoce 1…10 y saca las puntas de la ayuda', () => {
        const e = escalaNumerica(satisf);
        expect(e).toMatchObject({ min: 1, max: 10, etiquetaMin: 'nada satisfecho', etiquetaMax: 'muy satisfecho' });
        expect(e.opciones[6]).toMatchObject({ id: 'v7', n: 7 });
    });
    it('sin ayuda con esa forma, las puntas quedan en null', () => {
        expect(escalaNumerica({ ...satisf, ayuda: 'Elija uno' })).toMatchObject({ etiquetaMin: null, etiquetaMax: null });
    });
    it('no es escala si hay texto, saltos o pocas opciones', () => {
        expect(escalaNumerica({ tipo: 'unica', opciones: [{ id: 'a', texto: 'Ubicación' }, op(2), op(3)] })).toBeNull();
        expect(escalaNumerica({ tipo: 'unica', opciones: [op(1), op(2), op(4)] })).toBeNull();
        expect(escalaNumerica({ tipo: 'unica', opciones: [op(1), op(2)] })).toBeNull();
        expect(escalaNumerica({ tipo: 'multiple', opciones: [op(1), op(2), op(3)] })).toBeNull();
    });
    it('guion: sólo si el texto no nombra la escala', () => {
        expect(guionDeEscala(satisf)).toBeNull();
        expect(guionDeEscala({ ...satisf, texto: '¿Qué tan satisfecho está?' })).toBe('Léale la escala: del 1 al 10, donde 1 es «nada satisfecho» y 10 es «muy satisfecho».');
    });
});

describe('escalaDePregunta: recomendación y satisfacción se pintan igual', () => {
    const op = (n) => ({ id: 'v' + n, texto: String(n) });
    const satisf = { tipo: 'unica', ayuda: '1 = nada satisfecho · 10 = muy satisfecho', opciones: Array.from({ length: 10 }, (_, i) => op(i + 1)) };
    it('la de recomendación es 0–10, guarda el número y rotula las puntas', () => {
        const e = escalaDePregunta({ tipo: 'nps' });
        expect(e).toMatchObject({ min: 0, max: 10, etiquetaMin: 'nada probable', etiquetaMax: 'muy probable' });
        expect(e.opciones).toHaveLength(11);
        expect(e.opciones[3]).toMatchObject({ id: 3, n: 3 });
    });
    it('con la cuadrícula partida en dos, la segunda fila empieza en el 6 en las dos', () => {
        const segundaFila = (e) => e.opciones[Math.ceil(e.opciones.length / 2)].n;
        expect(segundaFila(escalaDePregunta({ tipo: 'nps' }))).toBe(6);
        expect(segundaFila(escalaDePregunta(satisf))).toBe(6);
    });
    it('lo que no es de puntaje no es escala', () => {
        expect(escalaDePregunta({ tipo: 'texto' })).toBeNull();
        expect(escalaDePregunta({ tipo: 'unica', opciones: [{ id: 'a', texto: 'Ubicación' }, op(2), op(3)] })).toBeNull();
    });
});

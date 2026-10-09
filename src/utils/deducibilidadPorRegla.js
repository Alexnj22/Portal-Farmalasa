// La revisión de la clasificación fiscal de los proveedores, POR REGLA: las
// fichas sin confirmar agrupadas por su base legal, con el crédito fiscal en
// juego, el título llano de cada regla y —para las que la ley condiciona— la
// pregunta que hay que contestar antes de clasificar.
//
// Vivía dentro de `PanelDeducibilidad` (portal). Sale al núcleo para que el
// teléfono agrupe y pregunte EXACTAMENTE igual: son decisiones fiscales, y dos
// redacciones de la misma pregunta son dos respuestas posibles.
//
// Por qué por regla y por plata: ver el comentario largo de
// `PanelDeducibilidad.jsx` (162 fichas = 12 decisiones; ordenar por documentos
// pone arriba lo que menos pesa).

export const SIN_GIRO = '__sin_giro__';

// Nombre llano de cada regla. El texto legal completo vive en la base
// (`clasificacion_base_legal`) y se muestra debajo; esto es el título que hace
// falta para reconocerla de un vistazo, y la base no lo tiene.
//
// Se busca por el artículo + una marca del texto, no por igualdad: el texto de
// la base es una frase larga y atarla entera acá sería exactamente la lista a
// mano que se desincroniza. Sin coincidencia el título ES el texto legal —
// degrada, no se rompe.
export const TITULOS = [
    [/^Art\. 65 nº1/,                    'Mercadería para reventa'],
    [/^Art\. 65 nº4.*teléfono/i,         'Teléfono e internet'],
    [/^Art\. 65 nº4.*eléctrica/i,        'Energía eléctrica'],
    [/^Art\. 65 nº4.*agua/i,             'Agua (suministro público)'],
    [/^Art\. 65 nº3.*financieros/i,      'Comisiones y servicios financieros'],
    [/^Art\. 65 nº3.*arrendamiento/i,    'Alquiler del local'],
    [/^Art\. 65 nº3 LIVA — servicios/i,  'Otros servicios del giro'],
    [/^Art\. 65-A a\)/,                  'Alimentos y bebidas'],
    [/^Art\. 65-A c\)/,                  'Combustible y repuestos de vehículo'],
    [/^Art\. 65 nº3 LIVA \(exclusión\)/, 'Ferretería y pinturas'],
    [/^Art\. 65 nº2/,                    'Equipo de cómputo'],
    [/^Art\. 65 nº3 LIVA$/,              'Giro demasiado genérico'],
];

export const tituloDeRegla = (baseLegal) => {
    if (!baseLegal) return 'Sin giro registrado';
    for (const [re, titulo] of TITULOS) if (re.test(baseLegal)) return titulo;
    return baseLegal;
};

// La pregunta que hay que responder, en el idioma del negocio, y su par de
// respuestas. `unoPorUno` = este grupo no se decide en tanda.
//
// `clasificacion_nota` (que trae la base) es la EXPLICACIÓN legal y se muestra
// igual; esto es la PREGUNTA, que es otra cosa: la nota describe la condición,
// la pregunta dice qué tiene que contestar quien está mirando.
//
// `aplica` es el punto de partida de los campos del anexo cuando la respuesta es
// «sí» — se puede cambiar antes de confirmar, no es una decisión tomada.
export const PREGUNTAS = [
    [/^Art\. 65-A a\)/, {
        q: '¿La farmacia revende estos alimentos y bebidas?',
        si: 'Sí, se revenden', no: 'No, es consumo interno',
        // Si se revenden son activo realizable, igual que la mercadería.
        aplica: { f07_clasificacion: '1', f07_sector: '2', f07_tipo_costo_gasto: '5' },
    }],
    [/^Art\. 65-A c\)/, {
        q: '¿El vehículo es estrictamente indispensable para el giro?',
        si: 'Sí, es indispensable', no: 'No lo es',
        aplica: { f07_clasificacion: '2', f07_sector: '4', f07_tipo_costo_gasto: '1' },
    }],
    [/^Art\. 65 nº3 LIVA \(exclusión\)/, {
        q: '¿Fue mantenimiento, o fue obra sobre el local?',
        si: 'Fue mantenimiento', no: 'Fue obra sobre el local',
        aplica: { f07_clasificacion: '2', f07_sector: '4', f07_tipo_costo_gasto: '2' },
    }],
    [/^Art\. 65 nº2/, {
        q: '¿El equipo conserva su individualidad?',
        si: 'Sí, la conserva', no: 'No la conserva',
        aplica: { f07_clasificacion: '2', f07_sector: '4', f07_tipo_costo_gasto: '2' },
    }],
    // Sin `si`/`no`: hospitales, televisión y «servicios n.c.p.» no comparten
    // una respuesta. Fingir que sí sería el error de la pantalla anterior.
    [/^Art\. 65 nº3 LIVA$/, { q: 'Este grupo no se decide de una vez.', unoPorUno: true }],
];

export const preguntaDeRegla = (baseLegal) => {
    if (!baseLegal) return null;
    for (const [re, p] of PREGUNTAS) if (re.test(baseLegal)) return p;
    return null;
};


/** Las fichas pendientes agrupadas: propuestas, condicionadas y sin giro, con sus totales. */
export function agruparPorRegla(rows = []) {
    const mapa = new Map();
    for (const r of rows) {
        const key = r.clasificacion_base_legal || SIN_GIRO;
        let g = mapa.get(key);
        if (!g) {
            g = {
                key,
                baseLegal: r.clasificacion_base_legal || null,
                nota: r.clasificacion_nota || null,
                estado: r.clasificacion_estado,
                titulo: tituloDeRegla(r.clasificacion_base_legal),
                pregunta: preguntaDeRegla(r.clasificacion_base_legal),
                // Las filas de una regla comparten los valores del anexo:
                // salieron todas de la misma fila de la siembra.
                f07: {
                    f07_clasificacion: r.f07_clasificacion,
                    f07_sector: r.f07_sector,
                    f07_tipo_costo_gasto: r.f07_tipo_costo_gasto,
                },
                rows: [], ccf: 0, credito: 0,
            };
            mapa.set(key, g);
        }
        g.rows.push(r);
        g.ccf += Number(r.ccf) || 0;
        g.credito += Number(r.credito_fiscal) || 0;
    }

    const grupos = [...mapa.values()];
    for (const g of grupos) {
        g.rows.sort((a, b) =>
            Number(b.credito_fiscal) - Number(a.credito_fiscal) ||
            (a.nombre || '').localeCompare(b.nombre || ''));
        g.dominante = g.rows[0];
    }
    // Por crédito fiscal y no por documentos: comisiones bancarias tiene 190
    // documentos y $81.82 — ordenar por conteo pone arriba lo que menos pesa.
    const porPlata = (a, b) => b.credito - a.credito || a.titulo.localeCompare(b.titulo);

    const propuestas    = grupos.filter(g => g.estado === 'propuesta').sort(porPlata);
    const condicionadas = grupos.filter(g => g.estado !== 'propuesta' && g.key !== SIN_GIRO).sort(porPlata);
    const sinGiro       = grupos.find(g => g.key === SIN_GIRO) || null;

    const suma = (gs) => gs.reduce((acc, g) => ({
        provs: acc.provs + g.rows.length,
        credito: acc.credito + g.credito,
    }), { provs: 0, credito: 0 });

    const prop = suma(propuestas);
    const cond = suma(condicionadas);

    return {
        propuestas, condicionadas, sinGiro,
        totales: {
            prop, cond,
            // Las decisiones son las REGLAS, no los proveedores — y los sin
            // giro no cuentan: no son trabajo, son 59 fichas con un
            // documento entre todas.
            decisiones: propuestas.length + condicionadas.length,
            credito: prop.credito + cond.credito + (sinGiro?.credito || 0),
        },
    };
}

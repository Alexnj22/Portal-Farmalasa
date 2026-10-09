// El resumen con IA de los comentarios de la encuesta de clima, escrito una vez
// para el portal (`EncuestaView`) y la app (`app/encuesta.js`): los tres
// segmentos (General, Jefes, Empleados), cómo se parte el texto que devuelve
// Saly en secciones y el tono de cada sección. La llamada y el guardado viven
// en `data/encuestas` (`generarResumenDeComentarios`).

const conComentario = (r) => r.comentario && r.comentario.trim() && r.comentario !== 'null';
const comoComentario = (r) => ({ texto: r.comentario, isJefe: !!r.isJefe, sucursal: r.sucursal });

/** Los tres segmentos con sus comentarios (los vacíos no se mandan a resumir). */
export function segmentosDeComentarios(respuestas = []) {
    const con = respuestas.filter(conComentario);
    return [
        { key: 'General', label: 'General', comments: con.map(comoComentario) },
        { key: 'Jefes', label: 'Jefes', comments: con.filter((r) => r.isJefe).map(comoComentario) },
        { key: 'Empleados', label: 'Empleados', comments: con.filter((r) => !r.isJefe).map(comoComentario) },
    ];
}

/** El texto de Saly en secciones `{ title, content }` (los títulos vienen como **Título:**). */
export function seccionesDelResumen(rawText) {
    if (!rawText) return [];
    const text = rawText.replace(/\*\*([^*]+?)\*\*:/g, '**$1:**');
    const regex = /\*\*([^*]+?):\*\*/g;
    const partes = [];
    let fin = 0;
    let m;
    while ((m = regex.exec(text)) !== null) {
        if (m.index > fin) partes.push({ type: 'text', content: text.slice(fin, m.index).trim() });
        partes.push({ type: 'header', title: m[1] });
        fin = m.index + m[0].length;
    }
    if (fin < text.length) partes.push({ type: 'text', content: text.slice(fin).trim() });
    const secciones = [];
    let i = 0;
    while (i < partes.length) {
        if (partes[i].type === 'header') {
            const content = (i + 1 < partes.length && partes[i + 1].type === 'text') ? partes[i + 1].content : '';
            secciones.push({ title: partes[i].title, content });
            i += content ? 2 : 1;
        } else {
            if (partes[i].content) secciones.push({ title: null, content: partes[i].content });
            i++;
        }
    }
    return secciones.length ? secciones : [{ title: null, content: text }];
}

/** El tono de una sección por su título: temas, valores, fricciones, acciones. */
export function tonoDeSeccion(title) {
    if (!title) return 'chart-3';
    const t = title.toLowerCase();
    if (t.includes('recurrente') || t.includes('tema') || t.includes('idea')) return 'chart-1';
    if (t.includes('valor') || t.includes('positiv') || t.includes('aspecto')) return 'success';
    if (t.includes('friccion') || t.includes('problema') || t.includes('identif') || t.includes('riesgo')) return 'warning';
    return 'chart-3';
}

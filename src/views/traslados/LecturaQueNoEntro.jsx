import React from 'react';
import Notice from '../../components/common/Notice';

/**
 * Lo que mandó el lector, en cristiano, cuando la lectura no entró.
 *
 * Es un instrumento, no un adorno: cada renglón separa dos hipótesis que desde
 * afuera se ven idénticas —la pantalla quieta— y que se arreglan en lugares
 * distintos. Sin él, lo único que se puede decir es «no funciona».
 *
 * ── Por qué vive en su propio archivo ──────────────────────────────────────
 * Lo usan las DOS pantallas del ticket —«Recibir traslado» y el recorrido de
 * «Llevar productos»—, y un diagnóstico que se corrige en una sola de las dos
 * es peor que ninguno: el día que digan cosas distintas sobre el mismo lector,
 * la medición pasa a ser la fuente del desconcierto. Es el mismo motivo por el
 * que existe `useCapturaDeCarne` (ver su encabezado).
 *
 * `d` es el `diagnostico` que devuelve ese hook.
 */
export default function LecturaQueNoEntro({ d }) {
    if (!d) return null;

    // El caso más informativo va primero: teclas que SÍ llegaron y que el
    // navegador no supo convertir en caracteres. Prueba que el lector manda y
    // que el problema es de lectura, no de conexión.
    if (d.teclas === 0 && d.ignoradas > 0) {
        return (
            <Notice variant="warning">
                El lector mandó <strong>{d.ignoradas}</strong> {d.ignoradas === 1 ? 'tecla' : 'teclas'} que
                esta computadora no pudo interpretar. Suele arreglarse cambiándole
                el idioma de teclado al lector, o su modo de emulación.
            </Notice>
        );
    }
    if (d.teclas === 0) return null;   // nada que contar

    const partes = [
        `${d.teclas} ${d.teclas === 1 ? 'tecla' : 'teclas'}`,
        `hueco máximo ${d.huecoMax} ms`,
        d.conEnter ? 'terminó con Enter' : 'terminó sin Enter',
    ];
    if (d.ignoradas > 0) partes.push(`${d.ignoradas} sin interpretar`);

    return (
        <Notice variant="warning">
            Llegó una lectura y no se pudo usar: {partes.join(' · ')}
            {d.texto ? <> → «<strong>{d.texto}</strong>»</> : null}.
            {d.motivo === 'corta' && ' Son muy pocas para ser un código de ticket.'}
            {d.motivo === 'tecleada' && ' Vino demasiado lenta para ser un escaneo.'}
        </Notice>
    );
}

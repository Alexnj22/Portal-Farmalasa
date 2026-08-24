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
export default function LecturaQueNoEntro({ d, eventos = 0 }) {
    /* ── El CERO también se dibuja, y ésa es la mitad que faltaba ──────────
     * Sin esta rama, «no llegó ninguna tecla» se veía como una pantalla en
     * blanco — o sea, exactamente igual que un aviso que no funciona o que una
     * versión vieja sin desplegar. Un cero que se ve es una afirmación
     * verificable; un cero que no se ve no dice nada.
     *
     * Y es la afirmación que cierra el caso: si acá dice 0 después de escanear,
     * el navegador no está recibiendo NADA y el problema ya no es del portal. */
    if (!d && eventos === 0) {
        return (
            <p className="text-micro text-content-3 text-center">
                Todavía no llegó ninguna tecla a esta pantalla.
            </p>
        );
    }
    if (!d) {
        return (
            <p className="text-micro text-content-3 text-center">
                Llegaron {eventos} {eventos === 1 ? 'tecla' : 'teclas'}, y ninguna formó un código.
            </p>
        );
    }

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
    if (d.teclas === 0) {
        return (
            <p className="text-micro text-content-3 text-center">
                Llegaron {eventos} {eventos === 1 ? 'tecla' : 'teclas'}, y ninguna formó un código.
            </p>
        );
    }

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

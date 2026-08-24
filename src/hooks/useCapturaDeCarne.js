import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * La captura de un carné escaneado: el lector teclea, esto lo junta y lo entrega.
 *
 * ── Por qué vive acá y no dentro de una pantalla ───────────────────────────
 * Estaba escrito dentro de `ApoioScanModal` (el apoyo de un pedido) y hacía
 * falta igual en la entrega del efectivo: el usuario pidió esa pantalla
 * «así como apoyo» (2026-08-17). Copiarlo habría dejado dos detectores que se
 * corrigen por separado — y ya pasó con el reconocimiento del carné, que estuvo
 * mirando el código en vez del PIN en dos funciones a la vez.
 *
 * ── Sólo escaneo: teclear no cuenta ────────────────────────────────────────
 * Un código tecleado lo escribe cualquiera que lo sepa de memoria, y lo que
 * estas dos pantallas registran es que alguien ESTUVO ahí con su carné. La
 * velocidad es lo único que separa un lector de una persona: por debajo de
 * `GAP_HUMANO_MS` entre teclas es una ráfaga; en cuanto aparece un hueco humano
 * la lectura se descarta y se avisa (`manual`).
 *
 * `activo` enciende y apaga la captura — es un `keydown` global con `capture`,
 * así que mientras el diálogo no está abierto no debe existir.
 *
 * `alLeer(codigo)` recibe la ráfaga completa. Se guarda en un ref para que
 * cambiar el callback no reinstale el listener a mitad de un escaneo.
 *
 * ── Y cuándo NO hay presencia que probar ───────────────────────────────────
 * El párrafo de arriba vale para un CARNÉ: ahí el código lo puede saber
 * cualquiera de memoria, así que la velocidad es la prueba. Pero el ticket de
 * una bolsa no tiene su número impreso —está sólo adentro de las barras, por
 * decisión escrita en `trasladoTicket.js`—, o sea que no hay nada que teclear
 * de memoria y el candado no protege nada. Ahí sólo estorba.
 *
 * `opciones.aceptarTecleado` lo suelta, y `opciones.sinEnter` cierra el otro
 * agujero: **un lector sin sufijo Enter existe**. Lo dice el propio
 * `LoginView` —`RAFAGA_ESPERA_ENTER_MS`, 400ms— y este hook nunca lo aprendió:
 * entregaba SÓLO con Enter y, al vencer `FIN_DE_RAFAGA_MS`, tiraba la ráfaga
 * sin avisar. Con eso, en una computadora cuyo lector no manda Enter el ticket
 * NO se lee nunca, mientras la cámara del teléfono lo lee sin problema — que
 * es exactamente cómo se reportó (2026-08-24).
 */

// Hueco entre teclas a partir del cual deja de parecer un lector. Es el mismo
// valor con el que este archivo nació en el apoyo de pedidos.
const GAP_HUMANO_MS = 80;
// Una ráfaga que se corta sin Enter se olvida: si no, el próximo escaneo
// arrancaría con la mitad del anterior pegada adelante.
const FIN_DE_RAFAGA_MS = 500;
// Los códigos reales miden 3 a 5 caracteres y el PIN 8, así que menos de 3 no
// es un carné.
const MINIMO_DE_TECLAS = 3;

export default function useCapturaDeCarne(activo, alLeer, opciones = {}) {
    const { aceptarTecleado = false, sinEnter = false } = opciones;
    // Cuántas teclas lleva la ráfaga en curso: es lo que se dibuja como puntos,
    // y por eso es estado y no un ref. El código NUNCA se pinta.
    const [teclas, setTeclas] = useState(0);
    const [manual, setManual] = useState(false);

    const bufferRef = useRef('');
    const ultimaRef = useRef(0);
    const timerRef = useRef(null);
    const manualRef = useRef(false);
    const alLeerRef = useRef(alLeer);

    useEffect(() => { alLeerRef.current = alLeer; });

    /** Deja el detector listo para el carné siguiente. */
    const limpiar = useCallback(() => {
        bufferRef.current = '';
        manualRef.current = false;
        clearTimeout(timerRef.current);
        setTeclas(0);
        setManual(false);
    }, []);

    useEffect(() => {
        if (!activo) return undefined;
        const alTeclear = (e) => {
            if (e.key === 'Escape') return;
            const ahora = Date.now();
            const hueco = ahora - ultimaRef.current;
            ultimaRef.current = ahora;

            if (e.key === 'Enter') {
                const leido = bufferRef.current;
                bufferRef.current = '';
                setTeclas(0);
                clearTimeout(timerRef.current);
                if (leido.length >= MINIMO_DE_TECLAS && (aceptarTecleado || !manualRef.current)) {
                    // Una lectura aceptada borra el aviso de «tecleado»: es la
                    // prueba de que ahora sí entró por el lector. Si la ráfaga
                    // venía marcada como manual el aviso se queda, que es lo
                    // que explica por qué no pasó nada.
                    setManual(false);
                    alLeerRef.current?.(leido);
                }
                manualRef.current = false;
                return;
            }
            if (e.key.length !== 1) return;

            if (bufferRef.current.length > 0 && hueco > GAP_HUMANO_MS) {
                // Hueco humano en mitad de la ráfaga: se descarta lo leído y se
                // arranca de nuevo desde esta tecla.
                manualRef.current = true;
                setManual(true);
                bufferRef.current = e.key;
                setTeclas(1);
            } else {
                if (bufferRef.current.length === 0) manualRef.current = false;
                bufferRef.current += e.key;
                setTeclas(bufferRef.current.length);
            }

            clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => {
                /* La ráfaga murió sin Enter. Con `sinEnter` se entrega igual
                 * —hay lectores que no mandan sufijo, y tirarla acá es lo que
                 * hacía que en esa computadora el ticket no se leyera NUNCA—; sin
                 * él se olvida, para que el próximo escaneo no arranque con la
                 * mitad del anterior pegada adelante. */
                const leido = bufferRef.current;
                const valia = leido.length >= MINIMO_DE_TECLAS
                    && (aceptarTecleado || !manualRef.current);
                bufferRef.current = '';
                manualRef.current = false;
                setTeclas(0);
                if (sinEnter && valia) { setManual(false); alLeerRef.current?.(leido); }
            }, FIN_DE_RAFAGA_MS);
        };
        document.addEventListener('keydown', alTeclear, { capture: true });
        return () => {
            document.removeEventListener('keydown', alTeclear, { capture: true });
            clearTimeout(timerRef.current);
        };
    }, [activo, aceptarTecleado, sinEnter]);

    return { teclas, manual, limpiar };
}

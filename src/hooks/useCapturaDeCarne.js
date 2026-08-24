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

/**
 * El carácter de una tecla, incluso cuando el lector no lo dice.
 *
 * `e.key` es lo normal y mide 1. Pero hay lectores —y capas de emulación de
 * teclado— que entregan `key: 'Unidentified'` y dejan la identidad sólo en
 * `e.code`: con el filtro `e.key.length !== 1` a secas, esa ráfaga se descarta
 * **entera y sin dejar rastro**, que se ve exactamente igual que un lector que
 * no manda nada.
 *
 * El respaldo es deliberadamente estrecho —`Digit`, `Numpad` y `Key`— para no
 * convertir en carácter a un modificador: `ShiftLeft` no coincide con ninguno.
 */
function caracterDe(e) {
    if (typeof e.key === 'string' && e.key.length === 1) return e.key;
    const c = e.code || '';
    if (/^(Digit|Numpad)\d$/.test(c)) return c.slice(-1);
    if (/^Key[A-Z]$/.test(c)) return c.slice(3);
    return null;
}

export default function useCapturaDeCarne(activo, alLeer, opciones = {}) {
    const { aceptarTecleado = false, sinEnter = false } = opciones;
    // Cuántas teclas lleva la ráfaga en curso: es lo que se dibuja como puntos,
    // y por eso es estado y no un ref. El código NUNCA se pinta.
    const [teclas, setTeclas] = useState(0);
    const [manual, setManual] = useState(false);
    /* Qué llegó en la última ráfaga, para PODER MIRARLO.
     *
     * Sin esto, «el lector no funciona» y «el lector no manda nada» se ven
     * idénticos en pantalla, y las dos hipótesis se arreglan en lugares
     * distintos. Es contabilidad de eventos, no del contenido: el `texto` sólo
     * se guarda donde el código no es una credencial (`aceptarTecleado`). */
    const [diagnostico, setDiagnostico] = useState(null);

    const bufferRef = useRef('');
    const ultimaRef = useRef(0);
    const timerRef = useRef(null);
    const manualRef = useRef(false);
    const alLeerRef = useRef(alLeer);
    const huecoMaxRef = useRef(0);
    const ignoradasRef = useRef(0);

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
        /** Lo que llegó, dicho en números — se pinta donde haya dónde mirarlo. */
        const anotar = (leido, conEnter, entregado, motivo) => setDiagnostico({
            teclas: leido.length,
            huecoMax: Math.round(huecoMaxRef.current),
            ignoradas: ignoradasRef.current,
            conEnter, entregado, motivo,
            texto: aceptarTecleado ? leido : null,
        });

        /** El plazo que cierra la ráfaga cuando dejan de llegar teclas. */
        const armarFin = () => {
            clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => {
                /* La ráfaga murió sin Enter. Con `sinEnter` se entrega igual
                 * —hay lectores que no mandan sufijo, y tirarla acá es lo que
                 * hacía que en esa computadora el ticket no se leyera NUNCA—; sin
                 * él se olvida, para que el próximo escaneo no arranque con la
                 * mitad del anterior pegada adelante. */
                const leido = bufferRef.current;
                const tecleada = manualRef.current;
                const valia = leido.length >= MINIMO_DE_TECLAS
                    && (aceptarTecleado || !tecleada);
                const entregado = sinEnter && valia;
                bufferRef.current = '';
                manualRef.current = false;
                setTeclas(0);
                anotar(leido, false, entregado,
                    entregado ? null
                        : (leido.length < MINIMO_DE_TECLAS ? 'corta'
                            : (!sinEnter ? 'sin-enter' : 'tecleada')));
                huecoMaxRef.current = 0;
                ignoradasRef.current = 0;
                if (entregado) { setManual(false); alLeerRef.current?.(leido); }
            }, FIN_DE_RAFAGA_MS);
        };

        const alTeclear = (e) => {
            if (e.key === 'Escape') return;
            const ahora = Date.now();
            const hueco = ahora - ultimaRef.current;
            ultimaRef.current = ahora;

            if (e.key === 'Enter') {
                const leido = bufferRef.current;
                const tecleada = manualRef.current;
                bufferRef.current = '';
                setTeclas(0);
                clearTimeout(timerRef.current);
                const entregado = leido.length >= MINIMO_DE_TECLAS
                    && (aceptarTecleado || !tecleada);
                anotar(leido, true, entregado,
                    entregado ? null : (leido.length < MINIMO_DE_TECLAS ? 'corta' : 'tecleada'));
                if (entregado) {
                    // Una lectura aceptada borra el aviso de «tecleado»: es la
                    // prueba de que ahora sí entró por el lector. Si la ráfaga
                    // venía marcada como manual el aviso se queda, que es lo
                    // que explica por qué no pasó nada.
                    setManual(false);
                    alLeerRef.current?.(leido);
                }
                manualRef.current = false;
                huecoMaxRef.current = 0;
                ignoradasRef.current = 0;
                return;
            }

            const car = caracterDe(e);
            if (car === null) {
                // Una tecla que llegó y no se pudo convertir en carácter. Se
                // CUENTA en vez de desaparecer: si son muchas, el lector sí está
                // mandando y el problema es cómo se lee, no que no mande.
                //
                // Y arma el fin de ráfaga IGUAL. Si no, un lector que manda sólo
                // teclas ilegibles no dejaría ni un diagnóstico —el plazo sólo
                // se armaba al aceptar un carácter—, que es justo el caso que
                // esta cuenta existe para delatar.
                ignoradasRef.current += 1;
                armarFin();
                return;
            }

            if (bufferRef.current.length > 0) {
                huecoMaxRef.current = Math.max(huecoMaxRef.current, hueco);
            }

            if (bufferRef.current.length > 0 && hueco > GAP_HUMANO_MS) {
                // Hueco humano en mitad de la ráfaga: se descarta lo leído y se
                // arranca de nuevo desde esta tecla.
                manualRef.current = true;
                setManual(true);
                bufferRef.current = car;
                setTeclas(1);
            } else {
                if (bufferRef.current.length === 0) manualRef.current = false;
                bufferRef.current += car;
                setTeclas(bufferRef.current.length);
            }

            armarFin();
        };
        document.addEventListener('keydown', alTeclear, { capture: true });
        return () => {
            document.removeEventListener('keydown', alTeclear, { capture: true });
            clearTimeout(timerRef.current);
        };
    }, [activo, aceptarTecleado, sinEnter]);

    return { teclas, manual, limpiar, diagnostico };
}

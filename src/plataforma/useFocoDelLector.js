// ─────────────────────────────────────────────────────────────────────────────
// Mantener el foco en el campo que lee el carné — la versión del NAVEGADOR.
// ─────────────────────────────────────────────────────────────────────────────
//
// El lector de carné del kiosco es un teclado: escribe donde esté el foco. Si
// el foco se va (un toque en otro lado, la pestaña que vuelve a primer plano),
// la siguiente lectura se pierde. Esto lo devuelve al campo. Es un problema del
// navegador —en una app nativa el lector llega por otro camino—, así que vive
// acá y no en el motor de marcación.
//
// ── Una sola regla, no dos ─────────────────────────────────────────────────
//
// Hasta el 2026-09-25 esto estaba dos veces dentro de `useTimeClockEngine`: un
// temporizador de cada segundo y unos oyentes de toque/clic/tecla/foco, y cada
// uno con SU lista de «cuándo no hay que robar el foco». No coincidían: el
// temporizador respetaba el panel de autodeclaración y los oyentes no. Hoy no
// rompía nada —ese panel no tiene campos de texto—, pero eran dos copias de la
// misma regla que ya se habían separado una vez. Ahora el motor la calcula UNA
// vez (`puedeEnfocar`) y los dos mecanismos la consultan.
//
// Los dos se conservan tal cual trabajaban: el temporizador enfoca directo; el
// que reacciona a un evento espera un cuadro (el toque puede estar abriendo
// algo que cambia la respuesta) y vuelve a preguntar.
import { useCallback, useEffect, useRef } from 'react';

const EVENTOS_DE_USO = ['click', 'keydown', 'touchstart'];

export function useFocoDelLector(inputRef, puedeEnfocar) {
    // Por ref: los oyentes se enganchan una vez y tienen que leer el valor de
    // AHORA, no el del render en que se registraron.
    // Se actualiza en un efecto y no durante el render (regla del compilador de
    // React); va PRIMERO, así que los efectos de abajo ya leen el valor nuevo.
    const puedeRef = useRef(puedeEnfocar);
    useEffect(() => { puedeRef.current = puedeEnfocar; }, [puedeEnfocar]);

    // El temporizador de cada segundo.
    useEffect(() => {
        if (!puedeEnfocar) return undefined;
        const intervalo = setInterval(() => {
            if (inputRef.current && document.activeElement !== inputRef.current && puedeRef.current) {
                inputRef.current.focus();
            }
        }, 1000);
        return () => clearInterval(intervalo);
    }, [puedeEnfocar, inputRef]);

    // Devolver el foco ahora, si se puede. Estable: la leen oyentes y el motor
    // la entrega a la pantalla (`ensureInputFocus`).
    const enfocar = useCallback(() => {
        if (!puedeRef.current || !inputRef.current) return;
        if (document.activeElement === inputRef.current) return;
        requestAnimationFrame(() => {
            if (!puedeRef.current) return;
            inputRef.current?.focus();
        });
    }, [inputRef]);

    // Los que reaccionan: volver a la pestaña, recuperar el foco de la ventana,
    // tocar, hacer clic o teclear.
    useEffect(() => {
        enfocar();
        const alVolver = () => { if (document.visibilityState === 'visible') enfocar(); };

        document.addEventListener('visibilitychange', alVolver, true);
        window.addEventListener('focus', enfocar, true);
        EVENTOS_DE_USO.forEach((t) => window.addEventListener(t, enfocar, true));
        return () => {
            document.removeEventListener('visibilitychange', alVolver, true);
            window.removeEventListener('focus', enfocar, true);
            EVENTOS_DE_USO.forEach((t) => window.removeEventListener(t, enfocar, true));
        };
    }, [enfocar, puedeEnfocar]);

    return enfocar;
}

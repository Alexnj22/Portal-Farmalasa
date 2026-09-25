import { useEffect, useRef, useState } from 'react';
import { tiemposGota } from '../components/common/gotaApertura';

/**
 * useMontadoParaSalida — mantener el modal en el árbol mientras SALE.
 *
 * Creado el 2026-08-08 después de tres rondas persiguiendo «el modal no hace la
 * animación de cierre, sólo desaparece». La causa no estaba en la animación:
 * estaba en que el modal se iba del árbol antes de que hubiera algo que animar.
 *
 * ── El defecto ────────────────────────────────────────────────────────────
 * Ocho componentes del portal —`UnifiedModal`, que es el de las fichas, los
 * seis de Pedidos, `PracticanteModal`, `KioskConfigModal`— hacían:
 *
 *     if (!open) return null;
 *
 * justo encima de su `<ModalShell>`. Con eso, en el mismo tick en que `open`
 * pasa a `false` el componente entero se desmonta: `ModalShell` **nunca llega a
 * ver `open=false`**, su estado `mounted` no sobrevive a nada, y la gota de
 * salida no tiene elemento sobre el cual correr. La apertura sí animaba —ahí el
 * componente está montado— y por eso el síntoma se leía como «anima al abrir
 * pero no al cerrar», que suena a un problema de la animación y no lo era.
 *
 * Lo midió el usuario en su propia consola: 19 recortes distintos de `clip-path`
 * durante la apertura y `none` en los últimos fotogramas antes de desaparecer.
 *
 * ── Por qué no alcanza con borrar la línea ────────────────────────────────
 * Borrarla a secas deja el cuerpo del modal renderizando SIEMPRE, también
 * cerrado. Para la mayoría es gratis, pero no para todos: `RutaMapModal` monta
 * un mapa y `UnifiedModal` carga sus formularios con `React.lazy` según el
 * tipo. Pagar eso en cada vista, para siempre, por una animación de 240ms, es un
 * mal trato.
 *
 * Este hook es el punto medio: montado mientras está abierto, montado mientras
 * SALE, y afuera después. `ModalShell` sigue siendo el que decide qué se pinta
 * —ya devuelve `null` cuando está cerrado y terminó de salir—; esto sólo le
 * garantiza que exista para poder decidirlo.
 *
 * ── El plazo es un TECHO, no una cita ─────────────────────────────────────
 * Sale del mismo reloj del tema que usa la gota (`--gota-salida`), más un margen
 * deliberadamente holgado: tiene que durar MÁS que la ventana propia de
 * `ModalShell` (que desmonta por el `onfinish` de la gota, o por su techo de
 * `salida + 400`). Si este plazo venciera antes, volveríamos al mismo bug con
 * otro número. No se sincroniza con nada: sólo garantiza que nadie corte por
 * abajo.
 */
const MARGEN = 520;

export function useMontadoParaSalida(open) {
    const [montado, setMontado] = useState(open);
    // El temporizador de la salida en curso, para cancelarlo si reabren antes.
    const salida = useRef(null);

    useEffect(() => {
        if (open) {
            if (salida.current) { clearTimeout(salida.current); salida.current = null; }
            setMontado(true); // eslint-disable-line react-hooks/set-state-in-effect -- monta en respuesta a `open`; es el mismo patrón que `mounted` en ModalShell
            return undefined;
        }
        salida.current = setTimeout(() => {
            salida.current = null;
            setMontado(false);
        }, tiemposGota().salida + MARGEN);
        return () => { if (salida.current) { clearTimeout(salida.current); salida.current = null; } };
    }, [open]);

    return open || montado;
}

export default useMontadoParaSalida;

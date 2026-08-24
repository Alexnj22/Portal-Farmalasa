import { useCallback, useEffect, useRef, useState } from 'react';
import { clearDraft, loadDraft, loadDraftTime, saveDraft } from '../utils/draftUtils';

/**
 * Un formulario largo se guarda solo.
 *
 * ── Por qué existe ─────────────────────────────────────────────────────────
 * El portal cierra la sesión sola cuando nadie usa la pantalla, y desde
 * v2.647.0 ese plazo se configura por cargo: **los de sala están en 5 minutos**.
 * Un formulario vive en memoria, así que cuando la sesión se cierra se pierde
 * todo lo escrito y no queda rastro. El aviso «¿Sigues ahí?» evita la SORPRESA,
 * no la PÉRDIDA — nadie vuelve a tiempo si se fue diez minutos.
 *
 * ── Por qué un hook y no `saveDraft` en cada formulario ────────────────────
 * Porque ya está medido en este proyecto qué pasa con una regla que cada
 * llamador tiene que repetir: el `buscador` de `FilterBar` lo pasaba **1 de 22
 * vistas**, y `usePestanaEnUrl` nació porque 20 de 29 vistas no guardaban la
 * pestaña. `npm run gate:borradores` encontró **24 formularios** sin borrador
 * teniendo `saveDraft` disponible desde hacía meses. El andamiaje —cuándo
 * guardar, con cuánto retardo, cuándo limpiar, qué pasa si el valor todavía no
 * cargó— es lo que se salta quien lo escribe a mano.
 *
 * ── Qué hace, y qué NO ─────────────────────────────────────────────────────
 * Guarda `valor` cada vez que cambia, con retardo. Devuelve lo que había
 * guardado **de antes** (`recuperado`), para que la pantalla decida si lo
 * repone sola o lo ofrece; y `descartar()`, para llamarlo cuando el formulario
 * se envía con éxito.
 *
 * **No repone nada por su cuenta.** Reponer es una decisión de la pantalla: un
 * modal que se abre vacío puede repoblarse solo, pero una vista que ya tiene
 * datos cargados no puede pisárselos. Devolver el dato y no aplicarlo es lo que
 * deja esa decisión donde se puede tomar bien.
 *
 * ── El primer guardado NO se dispara al montar ─────────────────────────────
 * Si lo hiciera, abrir un formulario vacío borraría el borrador que había: el
 * valor inicial pisaría lo guardado antes de que la persona escriba una letra.
 * Por eso la primera pasada sólo LEE.
 *
 * @param {string|null} clave     identificador del formulario; `null` lo apaga
 * @param {any} valor             lo que hay que conservar (objeto plano)
 * @param {{retardoMs?: number, activo?: boolean, vale?: (v:any)=>boolean}} [opciones]
 *   · `activo` — apaga el guardado sin desmontar el hook (un modal cerrado)
 *   · `vale`   — qué cuenta como «hay algo escrito». Por defecto, cualquier
 *                objeto con al menos una clave con valor. Sin esto, un
 *                formulario recién abierto guardaría su forma vacía y la
 *                pantalla creería que hay borrador.
 * @returns {{ recuperado: any, cuando: number|null, descartar: () => void, hayBorrador: boolean }}
 *   · `cuando` — cuándo se guardó, en milisegundos. Un formulario que OFRECE
 *     recuperar lo necesita: lo que decide a una persona no es «hay un
 *     borrador», es «hay uno de hace diez minutos».
 */
export default function useBorrador(clave, valor, opciones = {}) {
    const { retardoMs = 800, activo = true, vale = tieneAlgo } = opciones;

    // Lo que había guardado ANTES de esta sesión del formulario. Se lee una vez
    // por clave: releerlo en cada render devolvería lo que este mismo hook
    // acaba de escribir, y «lo de antes» dejaría de existir.
    const [recuperado, setRecuperado] = useState(() => (clave ? loadDraft(clave) : null));
    const [cuando, setCuando] = useState(() => (clave ? loadDraftTime(clave) : null));
    // La clave anterior se guarda en ESTADO y no en un `ref`: leer un ref
    // durante el render no está permitido, y el patrón que React documenta para
    // «recalcular algo cuando una prop cambia» es justamente éste — se
    // re-ejecuta el componente antes de pintar, así que no hay parpadeo ni un
    // efecto que muestre primero el valor viejo.
    const [claveLeida, setClaveLeida] = useState(clave);
    if (claveLeida !== clave) {
        setClaveLeida(clave);
        setRecuperado(clave ? loadDraft(clave) : null);
        setCuando(clave ? loadDraftTime(clave) : null);
    }

    const primera = useRef(true);

    useEffect(() => {
        if (!clave || !activo) return undefined;
        if (primera.current) { primera.current = false; return undefined; }
        if (!vale(valor)) return undefined;
        const t = setTimeout(() => saveDraft(clave, valor), retardoMs);
        return () => clearTimeout(t);
    }, [clave, activo, valor, retardoMs, vale]);

    // Al apagarse (el modal se cerró) vuelve a armarse la guarda: si no, la
    // próxima apertura guardaría su estado inicial encima de lo recuperado.
    useEffect(() => { if (!activo) primera.current = true; }, [activo]);

    const descartar = useCallback(() => {
        if (clave) clearDraft(clave);
        setRecuperado(null);
        setCuando(null);
    }, [clave]);

    return { recuperado, cuando, descartar, hayBorrador: recuperado != null };
}

/** ¿Hay algo escrito? Un objeto con todas sus claves vacías no cuenta. */
function tieneAlgo(v) {
    if (v == null) return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'object') {
        return Object.values(v).some(x => {
            if (x == null || x === '' || x === false) return false;
            if (Array.isArray(x)) return x.length > 0;
            // Un 0 SÍ cuenta: es el caso que rompen los `if (!x)` — una cantidad
            // en cero o un id 0 son datos que alguien escribió.
            return true;
        });
    }
    return v !== '' && v !== false;
}

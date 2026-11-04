import { useEffect, useRef } from 'react';
import { create } from 'zustand';

// Lo que la pantalla de turno le cuenta a Saly. La burbuja la monta
// `AppLayout` y vive fuera de las vistas; las vistas se anotan con
// `useSalyEnPantalla` y se borran al salir. Sin vista anotada, no hay burbuja:
// Saly sólo aparece donde sabe ayudar.
//
// Lo que la vista declara:
//   · modulo      — la guía que usa la función del servidor (`cortes_caja`, `caja`)
//   · titulo      — cómo se llama la pantalla, para el saludo
//   · leer()      — lo que se ve, en datos cortos (no el DOM entero: más barato)
//   · filtros     — { clave: { rotulo, valor, opciones: [{value,label}], poner(v) } }
//   · avisos      — los que arma el portal con sus números ($0)
//   · enFormulario— nombre del formulario abierto, para ofrecer ayuda si se queda quieto

export const useSalyAyudaStore = create((set) => ({
    pantalla: null,
    avisos: [],
    enFormulario: null,
    anotar: (pantalla) => set({ pantalla }),
    borrar: (pantalla) => set((s) => (s.pantalla === pantalla ? { pantalla: null, avisos: [], enFormulario: null } : s)),
    ponerAvisos: (avisos) => set({ avisos }),
    ponerFormulario: (enFormulario) => set({ enFormulario }),
}));

/**
 * La vista se anota con lo que Saly puede ver y tocar. Los datos se leen al
 * PREGUNTAR (`leer` se llama en ese momento), así que pasar funciones nuevas en
 * cada render no cuesta nada.
 */
export function useSalyEnPantalla({ modulo, titulo, leer, filtros, avisos, enFormulario = null }) {
    const ref = useRef({ leer, filtros });
    useEffect(() => { ref.current = { leer, filtros }; });

    // Sin `modulo` no se anota: así una vista con pestañas se anota sólo en la
    // pestaña donde Saly sabe ayudar, sin romper el orden de los hooks.
    useEffect(() => {
        if (!modulo) return undefined;
        const pantalla = {
            modulo,
            titulo,
            leer: () => ref.current.leer?.() ?? {},
            filtros: () => ref.current.filtros || {},
        };
        useSalyAyudaStore.getState().anotar(pantalla);
        return () => useSalyAyudaStore.getState().borrar(pantalla);
    }, [modulo, titulo]);

    // Los avisos sólo se reemplazan cuando cambian de verdad (por su clave):
    // reponerlos en cada render reiniciaría la burbuja.
    const firma = (avisos || []).filter(Boolean).map((a) => a.clave).join('|');
    const avisosRef = useRef(avisos);
    useEffect(() => { avisosRef.current = avisos; });
    useEffect(() => {
        if (!modulo) return;
        useSalyAyudaStore.getState().ponerAvisos((avisosRef.current || []).filter(Boolean));
    }, [firma, modulo]);

    useEffect(() => {
        if (!modulo) return;
        useSalyAyudaStore.getState().ponerFormulario(enFormulario);
    }, [enFormulario, modulo]);
}

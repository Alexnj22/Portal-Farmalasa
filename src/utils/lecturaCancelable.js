// Una lectura que se puede abandonar (2026-11-23).
//
// Nació en «Cuándo se vende más» del Inicio (`DashboardView`). Su efecto hacía
// `fetch().then(...)` sin `.catch` y sin guarda de cancelación:
//   · si la lectura —o el armado de los promedios— LANZABA, nadie apagaba la
//     carga y la tarjeta quedaba con el esqueleto para siempre;
//   · al cambiar rápido de sucursal, la respuesta de la anterior podía llegar
//     DESPUÉS que la nueva y pintar los números de otra sucursal.
//
// `lecturaCancelable(leer, { alLlegar, alFallar, alTerminar })` corre `leer()`
// y avisa sólo si sigue vigente: `alLlegar(resultado)`, `alFallar(error)` si
// la lectura o `alLlegar` lanzan, y siempre `alTerminar()` al final. Devuelve
// la función que la abandona: es el `return` del `useEffect`. Abandonada, no
// llama a nada (la que la reemplazó maneja su propia carga).
export function lecturaCancelable(leer, { alLlegar, alFallar, alTerminar } = {}) {
    let vigente = true;
    Promise.resolve()
        .then(() => leer())
        .then((r) => { if (vigente) alLlegar?.(r); })
        .catch((e) => { if (vigente) alFallar?.(e); })
        .finally(() => { if (vigente) alTerminar?.(); });
    return () => { vigente = false; };
}

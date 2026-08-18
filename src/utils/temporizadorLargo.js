// ── Un temporizador para un instante LEJANO se arma por tramos ───────────────
//
// `setTimeout` guarda el retraso en un entero de 32 bits con signo: cualquier
// valor mayor a 2,147,483,647 ms (~24.8 días) desborda y el navegador lo dispara
// **al instante**, no cuando se pidió. No avisa, no lanza, no queda en ningún
// log — simplemente hace lo contrario de lo que se le pidió.
//
// No es un caso teórico. En la app instalada el límite de inactividad son 30
// días (2,592,000,000 ms), así que los dos temporizadores del cierre por
// inactividad desbordaban SIEMPRE. Lo que se veía (reportado el 2026-08-18, en
// dos teléfonos): el cartel «¿Sigues ahí?» aparecía a los pocos segundos de
// entrar, prometiendo cerrar la sesión en **2,591,998 segundos** —los 30 días
// completos—. Y el de cierre, que al llegar relee el sello y se reprograma si
// todavía no vence, se volvía a disparar al instante: un bucle sin freno
// comiéndose la batería del teléfono.
//
// La solución es la de siempre para plazos largos: si falta más que el tope, se
// duerme hasta el tope y se vuelve a preguntar. Recalcular contra el reloj de
// AHORA en cada tramo tiene un segundo beneficio: un teléfono que estuvo
// suspendido no arrastra el desfase del tramo anterior.
export const TOPE_TIMEOUT_MS = 2 ** 31 - 1;

// `ref` es el mismo `{ current }` de siempre, y guarda el id del tramo EN CURSO
// — así `clearTimeout(ref.current)` sigue cancelando todo, esté en el tramo que
// esté. `accion` corre una sola vez, al llegar el instante pedido.
export function programarEn(ref, cuando, accion) {
    const armar = () => {
        const falta = cuando - Date.now();
        if (falta > TOPE_TIMEOUT_MS) {
            ref.current = setTimeout(armar, TOPE_TIMEOUT_MS);
            return;
        }
        ref.current = setTimeout(() => { ref.current = null; accion(); }, Math.max(0, falta));
    };
    armar();
}

// ¿El INSTRUMENTO puede fallar? — F1 de `docs/PLAN-CIERRE-MOVIL-2026-08-08.md`.
//
// El resto de la suite mide la app. Esto mide al medidor, y existe por una
// regla que este proyecto pagó caro: **un instrumento que no puede fallar no
// prueba nada**. El 2026-08-07 una prueba pasó dos veces con cero
// intercepciones porque el service worker se comía la petición, y el verde no
// decía nada de lo que se creía estar probando.
//
// Lo que se verifica acá es la corrección de `alcanzable()`: el sidebar del
// teléfono se esconde con `transform: translateX(-100%)` y `visible()` sólo
// mira `display`/`visibility`/`opacity`, así que su botón entraba como visible
// en las 37 rutas — 37 de los 77 `sinAcuse` no existían.
//
// Los cuatro casos NO son cuatro maneras de decir lo mismo. Dos prueban que la
// corrección tapa el agujero, y los otros dos prueban que **no tapa de más**:
// si alguien reescribe `alcanzable` como «está dentro del viewport» a secas,
// los casos «bajo el pliegue» se ponen en rojo. Ésa es la mitad que importa,
// porque una regla que descarta todo lo de abajo del pliegue haría subcontar la
// mitad inferior de cada vista y el informe saldría verde por vacío.
//
// No necesita la app ni sesión: arma su propio DOM con `setContent`. Correr con
//   E2E_BASE_URL=http://localhost:9 npx playwright test --project=webkit-movil -g instrumento
// (la URL falsa es para que Playwright no levante el preview: no se navega).

import { test, expect } from '@playwright/test';
import { MEDIR } from './medicion-movil.js';

// Cuatro controles, ninguno con `active:` — o sea que los cuatro son candidatos
// a `sinAcuse`— y dos de ellos además por debajo de 44pt, candidatos a `chicos`.
// La diferencia entre ellos es SÓLO dónde están.
const PAGINA = `
<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>
  body { margin: 0; font: 16px sans-serif; }
  button { background: #ccc; border: 0; }
  /* Como el sidebar real: sigue en el flujo, con tamaño y opacidad, pero
     corrido fuera de cuadro. Ninguna de las tres propiedades que mira
     visible() lo delata. */
  .fuera-de-lado { position: fixed; top: 0; left: 0; width: 300px; height: 200px;
                   transform: translateX(-100%); }
  .bajo-el-pliegue { position: absolute; top: 3000px; left: 0; }
</style></head><body>
  <div class="fuera-de-lado">
    <button id="lado-grande" style="width:120px;height:60px">escondido de lado</button>
    <button id="lado-chico"  style="width:30px;height:30px">x</button>
  </div>
  <div class="bajo-el-pliegue">
    <button id="abajo-grande" style="width:120px;height:60px">abajo del pliegue</button>
    <button id="abajo-chico"  style="width:30px;height:30px">y</button>
  </div>
  <!-- A la vista, alcanzable y sin acuse — pero DESHABILITADO, así que tocarlo
       no hace nada y pedirle un active: sería prometer lo que no pasa. Chico a
       propósito: prueba de paso que chicos SÍ lo sigue contando, porque el
       tamaño no cambia cuando se habilite. -->
  <button id="apagado" disabled style="width:30px;height:30px">z</button>
  <!-- Detrás del velo de un diálogo: el shell entero recibe pointer-events:none
       (más scale 0.98 y blur) mientras hay un modal abierto. Se ve, pero no
       recibe el toque — así que no es un blanco táctil ni le falta acuse. -->
  <div id="tras-el-velo" style="pointer-events:none">
    <button id="velado" style="width:30px;height:30px">w</button>
  </div>
  <div style="height:4000px"></div>
</body></html>`;

test.describe('el instrumento', () => {
    test('instrumento · no cuenta lo que está corrido fuera de lado, y sí lo que está bajo el pliegue', async ({ page }) => {
        await page.setContent(PAGINA);
        const m = await page.evaluate(MEDIR);

        const ids = (lista) => lista.map(h => h.sel).join(' ');
        // `sel()` arma `tagName#id.clases`, así que el id viaja en el selector.
        const enSinAcuse = (id) => m.grupos.sinAcuse.some(g => g.muestra.sel.includes(`#${id}`));
        const enChicos = (id) => m.grupos.chicos.some(g => g.muestra.sel.includes(`#${id}`));

        // 1 · La corrección: corrido de lado = inalcanzable. No hay scroll
        //     horizontal con que ir a buscarlo (`desbordePagina` es 0).
        expect(m.desbordePagina, 'la página no scrollea de lado').toBe(0);
        expect(enSinAcuse('lado-grande'), `#lado-grande no debería contarse — ${ids(m.sinAcuse)}`).toBe(false);
        expect(enChicos('lado-chico'), `#lado-chico no debería contarse — ${ids(m.chicos)}`).toBe(false);

        // 2 · Y lo que la corrección NO puede llevarse por delante: bajo el
        //     pliegue se alcanza scrolleando, así que sigue siendo deuda. Si
        //     esto se pone en rojo, `alcanzable` se escribió como «dentro del
        //     viewport» y el medidor pasó a subcontar media vista.
        expect(enSinAcuse('abajo-grande'), '#abajo-grande SÍ debe contarse: se alcanza scrolleando').toBe(true);
        expect(enChicos('abajo-chico'), '#abajo-chico SÍ debe contarse: se alcanza scrolleando').toBe(true);

        // 3 · Deshabilitado: no acusa (no pasa nada al tocarlo) pero SÍ cuenta
        //     como chico, porque su tamaño no cambia cuando se habilite.
        expect(enSinAcuse('apagado'), '#apagado no debe pedir acuse: está disabled').toBe(false);
        expect(enChicos('apagado'), '#apagado SÍ es chico: disabled no lo agranda').toBe(true);

        // 4 · Detrás del velo: se ve, pero no recibe el toque. Ni chico ni mudo.
        expect(enChicos('velado'), '#velado no es un blanco táctil: pointer-events none').toBe(false);
        expect(enSinAcuse('velado'), '#velado no necesita acuse: no se puede tocar').toBe(false);

        // Prueba de vida: cero hallazgos y cero datos se ven igual. Si el
        // medidor no vio NADA, las cuatro comprobaciones de arriba pasarían por
        // vacío y este spec sería un verde que no prueba nada.
        expect(m.totales.sinAcuse, 'el medidor tiene que haber visto algo').toBeGreaterThan(0);
    });
});

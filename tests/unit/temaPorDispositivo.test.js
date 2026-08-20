import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// El tema del teléfono y el de la computadora se guardan aparte, y esa decisión
// vive DOS veces: en `src/utils/temaPorDispositivo.js` y en el script inline de
// `index.html` que estampa `data-theme` antes del primer pintado.
//
// El espejo es a propósito —el script tiene que correr antes de que exista un
// módulo que importar— pero si divergen no falla nada: el teléfono carga con el
// tema del escritorio y se corrige al montar React, o sea un parpadeo en cada
// carga. Es exactamente el tipo de hallazgo que nadie reporta y que sobrevive
// meses, así que lo mira una prueba en vez de un comentario.
//
// Se compara TEXTO y no comportamiento porque el script inline no se puede
// importar: lo que hay que verificar es que las dos copias digan lo mismo.

// `resolve` desde la raíz del repo y no `import.meta.url`: bajo el entorno
// jsdom de vitest esa URL no es de esquema `file:` y `readFileSync` la rechaza.
const leer = (rel) => readFileSync(resolve(process.cwd(), rel), 'utf8');
const html = leer('index.html');
const modulo = leer('src/utils/temaPorDispositivo.js');
// La OTRA mitad del espejo: el script inline resuelve lo mismo que
// `resolveInitialTheme`, que es quien lee las claves del lado de React.
const contexto = leer('src/context/ThemeContext.jsx');

describe('el script inline de index.html espeja temaPorDispositivo.js', () => {
    it('usa la misma consulta para decidir si es un teléfono', () => {
        // La consulta sale del módulo, no está escrita a mano acá: si alguien la
        // cambia, la prueba sigue midiendo el espejo y no una copia vieja.
        const consulta = modulo.match(/CONSULTA_MOVIL = '([^']+)'/)?.[1];
        expect(consulta).toBeTruthy();
        expect(html).toContain(`window.matchMedia('${consulta}')`);
    });

    it('usa las mismas dos claves de localStorage', () => {
        const claves = modulo.match(/CLAVE_TEMA = ES_MOVIL \? '([^']+)' : '([^']+)'/);
        expect(claves).toBeTruthy();
        const [, movil, escritorio] = claves;
        expect(html).toContain(`'${movil}' : '${escritorio}'`);
    });

    it('respalda a la clave vieja en el teléfono, para no borrarle el tema a quien ya lo tenía', () => {
        // Las dos copias tienen que hacer el respaldo, no una sola: si el script
        // inline no lo hiciera, la primera carga pintaría el default y recién al
        // montar React aparecería el tema heredado.
        expect(contexto).toContain("localStorage.getItem('portal-theme')");
        expect(html).toContain("localStorage.getItem('portal-theme')");
    });
});

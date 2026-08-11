import { test, expect } from '@playwright/test';
import fs from 'node:fs';

/**
 * ¿Algún rótulo del clúster del pulgar se parte en DOS renglones?
 *
 * El clúster de `BarraFlotante` da una columna de 60px por botón y el rótulo va
 * debajo del ícono con `line-clamp-2`, así que un nombre largo ("CERRAR
 * QUINCENA", "NUEVO PRACTICANTE") ocupa dos renglones: ese botón queda más alto
 * que los demás, la barra entera crece y los rótulos dejan de leerse como una
 * fila.
 *
 * ── Cómo se cuenta un renglón ─────────────────────────────────────────────
 * NO por `top` de las cajas: dos cajas de distinta altura en la MISMA fila
 * tienen distinto `top` y eso marca como partido todo lo que se alinee al
 * centro. Un renglón es una BANDA: dos cajas están en renglones distintos sólo
 * si sus franjas verticales no se tocan. Y se mide con `Range` sobre el
 * contenido, porque el rótulo es un nodo de TEXTO suelto — un recorrido por
 * elementos hijos no ve nada.
 *
 * ── Y además se mira el CORTE ─────────────────────────────────────────────
 * Desde que el rótulo lleva `truncate`, partirse en dos ya es imposible: el
 * defecto se mudó de "dos renglones" a "…". O sea que un detector que sólo
 * cuente renglones daría verde para siempre — mediría su propio arreglo, no el
 * problema. Por eso se comparan `scrollWidth` y `clientWidth`: un rótulo
 * recortado es un `rotulo` que falta en el descriptor de la acción.
 */

const E2E_USER = process.env.E2E_USER;
const E2E_PASSWORD = process.env.E2E_PASSWORD;
const SALIDA = 'barridos';
const INFORME = `${SALIDA}/rotulos-cluster.json`;

const RUTAS = process.env.RUTAS ? process.env.RUTAS.split(',').map(r => r.trim()) : [
    'overview', 'ventas', 'compras', 'productos', 'pedidos', 'minmax', 'clientes',
    'proveedores', 'facturacion', 'facturas-compra', 'facturas-sala', 'cotizaciones',
    'conteo-inventario', 'libro-compras-completo', 'libros-iva', 'resumen-fiscal',
    'corte-z', 'ventas-perdidas', 'inventario', 'gestion-stock', 'traslados',
    'staff', 'monitor', 'audit', 'auditview', 'schedules', 'payroll', 'requests',
    'vacation-plan', 'announcements', 'encuesta', 'encuesta-admin', 'metas',
    'branches', 'laboratorios', 'roles', 'permissions', 'sync-health', 'my-requests',
    'my-documents', 'my-announcements', 'profile', 'dashboard',
];

// Se ejecuta DENTRO de la página: mide cada botón del clúster y devuelve el
// rótulo con su cuenta de renglones.
const MEDIR = () => {
    const barra = document.querySelector('[data-barra-flotante]');
    if (!barra) return null;
    const botones = [...barra.querySelectorAll('button')];
    return botones.map((b) => {
        // El rótulo es el último `span` del botón — el primero es el círculo
        // del ícono. Si los rótulos están apagados (un solo botón) no hay.
        const spans = [...b.querySelectorAll(':scope > span')];
        const rot = spans.length > 1 ? spans[spans.length - 1] : null;
        if (!rot || !rot.textContent.trim()) {
            return { texto: null, renglones: 0, anchoBoton: Math.round(b.getBoundingClientRect().width) };
        }
        const r = document.createRange();
        r.selectNodeContents(rot);
        const cajas = [...r.getClientRects()].filter(c => c.width > 0 && c.height > 0);
        cajas.sort((a, c) => a.top - c.top);
        let renglones = 0;
        let fin = -Infinity;
        let ancho = 0;
        for (const c of cajas) {
            ancho = Math.max(ancho, c.width);
            // Banda nueva sólo si la caja EMPIEZA después de donde terminó la
            // anterior. `-1` de tolerancia por el redondeo subpíxel.
            if (c.top >= fin - 1) { renglones++; fin = c.bottom; }
            else fin = Math.max(fin, c.bottom);
        }
        const cs = getComputedStyle(rot);
        return {
            texto: rot.textContent.trim(),
            renglones,
            // `+1` de tolerancia: el redondeo subpíxel de WebKit deja diferencias
            // de fracciones de píxel en rótulos que entran perfectos.
            cortado: rot.scrollWidth > rot.clientWidth + 1,
            anchoTexto: Math.round(ancho),
            anchoRotulo: Math.round(rot.getBoundingClientRect().width),
            anchoBoton: Math.round(b.getBoundingClientRect().width),
            fuente: `${cs.fontSize} ${cs.fontWeight}`,
            aria: b.getAttribute('aria-label'),
        };
    });
};

test.describe('Rótulos del clúster del pulgar', () => {
    test.skip(!E2E_USER || !E2E_PASSWORD, 'Requiere E2E_USER/E2E_PASSWORD');

    test('ninguno ocupa dos renglones', async ({ page }) => {
        test.setTimeout(Number(process.env.TIMEOUT_MS) || 1_800_000);
        fs.mkdirSync(SALIDA, { recursive: true });

        await page.goto('/login');
        await page.locator('#username').fill(E2E_USER);
        await page.locator('#password').fill(E2E_PASSWORD);
        await page.locator('button[type="submit"]').first().click();
        await page.waitForFunction(
            () => !location.pathname.startsWith('/login'), null, { timeout: 60_000 },
        ).catch(() => {});
        await page.waitForTimeout(3000);
        // Sin sesión el barrido mediría 37 pantallas de login y saldría todo en
        // cero — «sin hallazgos» y «sin datos» se ven igual.
        if (/\/login/.test(page.url())) {
            throw new Error('No se pudo iniciar sesión: el barrido habría medido el login 37 veces.');
        }

        const informe = [];
        for (const ruta of RUTAS) {
            await page.goto('/' + ruta).catch(() => {});
            await page.waitForTimeout(2500);
            let medida = null;
            try { medida = await page.evaluate(MEDIR); } catch { /* vista reventada */ }
            if (!medida) { informe.push({ ruta, sinBarra: true }); continue; }
            informe.push({ ruta, botones: medida });
            if (medida.some(b => b.renglones > 1 || b.cortado)) {
                await page.screenshot({ path: `${SALIDA}/rotulos-${ruta}.png` }).catch(() => {});
            }
        }

        fs.writeFileSync(INFORME, JSON.stringify(informe, null, 2));

        const malos = [];
        for (const v of informe) {
            for (const b of v.botones || []) {
                if (b.renglones > 1) malos.push(`${v.ruta}: "${b.texto}" se parte en ${b.renglones} renglones (${b.anchoTexto}px en ${b.anchoBoton}px)`);
                else if (b.cortado) malos.push(`${v.ruta}: "${b.texto}" se corta con «…» (${b.anchoBoton}px de columna) — falta \`rotulo\` en el descriptor`);
            }
        }
        console.log(malos.length
            ? `\n⚠️  ${malos.length} rótulos del clúster mal:\n  ${malos.join('\n  ')}\n`
            : '\n✅ Ningún rótulo del clúster se parte ni se corta.\n');

        // Y falla, no sólo informa: un rótulo largo sin su `rotulo` corto no se
        // nota mirando el código —la etiqueta descriptiva se ve bien en
        // escritorio— y sólo aparece en el teléfono.
        expect(malos, malos.join('\n')).toEqual([]);
    });
});

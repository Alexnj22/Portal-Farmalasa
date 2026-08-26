// ─────────────────────────────────────────────────────────────────────────────
// Las regresiones que el candado de rutas TIENE que cazar
// ─────────────────────────────────────────────────────────────────────────────
//
// El día que se escribió `gate:rutas` dio TRES hallazgos, y dos eran suyos:
// acusó a `/conteo-inventario/:id` de no tener título de pestaña —una ficha de
// detalle arma el suyo con el nombre de lo que se abrió— y dijo que el
// encabezado de `/encuesta` era «Volver a Gestión de encuesta», que es el
// tooltip de la flecha de volver, porque su regex saltaba por encima de un
// `title={` dinámico hasta caer en el `title` de un botón anidado.
//
// O sea: dos tercios de la primera medición no estaban en el portal sino en
// cómo se medía. Por eso estas pruebas fabrican el defecto a mano y exigen que
// el gate lo vea — y fabrican también los dos casos CORRECTOS que se acusaron
// mal, para que el arreglo no se pierda.

import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const RAIZ = path.resolve(import.meta.dirname, '../..');
const GATE = path.join(RAIZ, 'scripts', 'rutas-gate.mjs');
const APP_REAL = path.join(RAIZ, 'src', 'App.jsx');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rutas-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

// Corre el gate contra un App.jsx fabricado. Devuelve { ok, salida } en vez de
// lanzar: lo que se prueba es justamente el código de salida.
function correr(transformar = (s) => s) {
    const app = path.join(tmp, `App-${Math.random().toString(36).slice(2)}.jsx`);
    fs.writeFileSync(app, transformar(fs.readFileSync(APP_REAL, 'utf8')));
    const env = { ...process.env, RUTAS_GATE_APP: app };
    try {
        return { ok: true, salida: execFileSync('node', [GATE], { env, encoding: 'utf8', cwd: RAIZ }) };
    } catch (e) {
        return { ok: false, salida: (e.stdout || '') + (e.stderr || '') };
    }
}

describe('gate:rutas', () => {
    it('el árbol real pasa', () => {
        const { ok, salida } = correr();
        expect(salida).toContain('gate:rutas');
        expect(ok).toBe(true);
    });

    it('caza una ruta NUEVA en inglés', () => {
        const { ok, salida } = correr(s => s.replace(
            '<Route path="bitacoras" element=',
            '<Route path="user-settings" element={<PermissionGuard moduleKey="bitacoras"><BitacorasView /></PermissionGuard>} />\n<Route path="bitacoras" element=',
        ));
        expect(ok).toBe(false);
        expect(salida).toContain('NUEVA(s) en inglés');
        expect(salida).toContain('/user-settings');
    });

    it('caza una pestaña que no copia el encabezado de su vista', () => {
        const { ok, salida } = correr(s => s.replace(
            "'/compras':           'Compras (Bodega)',",
            "'/compras':           'Compritas',",
        ));
        expect(ok).toBe(false);
        expect(salida).toContain('no copian su encabezado');
        expect(salida).toContain('Compritas');
    });

    it('caza una ruta sin título de pestaña', () => {
        const { ok, salida } = correr(s => s.replace("    '/bitacoras':         'Bitácoras',\n", ''));
        expect(ok).toBe(false);
        expect(salida).toContain('sin título de pestaña');
        expect(salida).toContain('/bitacoras');
    });

    it('caza un ítem del menú que apunta a una ruta que ya no existe', () => {
        // El módulo del menú sigue nombrando `/bitacoras` y la ruta pasa a
        // llamarse distinto: en el portal eso no da error, se ve como una
        // pantalla rota al tocar el menú.
        const { ok, salida } = correr(s => s.replace('<Route path="bitacoras"', '<Route path="cuadernos"'));
        expect(ok).toBe(false);
        expect(salida).toContain('ruta que no existe');
    });

    it('caza una entrada de HEREDADAS que ya se arregló', () => {
        // Hoy la lista de deuda está VACÍA —las 18 se renombraron el mismo día
        // que nació el gate—, así que este chequeo no tendría contra qué
        // dispararse y quedaría sin prueba justo el día que vuelva a hacer
        // falta. Se le inyecta una lista que nombra una ruta que ya no existe.
        const app = path.join(tmp, `App-heredada.jsx`);
        fs.writeFileSync(app, fs.readFileSync(APP_REAL, 'utf8'));
        const env = {
            ...process.env,
            RUTAS_GATE_APP: app,
            RUTAS_GATE_HEREDADAS: JSON.stringify({ '/payroll': 'se renombró a /nomina el 2026-08-26' }),
        };
        let salida = '', ok = true;
        try { salida = execFileSync('node', [GATE], { env, encoding: 'utf8', cwd: RAIZ }); }
        catch (e) { ok = false; salida = (e.stdout || '') + (e.stderr || ''); }
        expect(ok).toBe(false);
        expect(salida).toContain('HEREDADAS que ya no existen');
        expect(salida).toContain('/payroll');
    });

    it('NO acusa a `monitor` ni a `prueba-ios` de estar en inglés', () => {
        // `monitor` es palabra española (RAE) y `ios` es el nombre de una
        // plataforma, no una palabra. Las dos las acusaba el regex, que es la
        // misma familia de falso positivo que los otros dos de la primera
        // corrida.
        const { ok, salida } = correr();
        expect(ok).toBe(true);
        expect(salida).not.toContain('/monitor');
        expect(salida).not.toContain('/prueba-ios');
    });

    it('caza una ruta sin clave de precarga', () => {
        // El modo de falla que este chequeo cubre es el peor: no rompe nada.
        // Sin la clave, `prefetchRuta` no encuentra nada y no hace nada — la
        // vista carga lento la primera vez, sin error y sin rastro. Así se
        // perdió la precarga de 19 rutas al renombrarlas, y así `cortes` estuvo
        // años sin precargarse figurando como `cortes_caja`.
        const pre = path.join(tmp, 'routeImporters.js');
        fs.writeFileSync(pre, fs.readFileSync(path.join(RAIZ, 'src/constants/routeImporters.js'), 'utf8')
            .replace("'bitacoras': IMPORTADORES.BitacorasView,", ''));
        const app = path.join(tmp, 'App-precarga.jsx');
        fs.writeFileSync(app, fs.readFileSync(APP_REAL, 'utf8'));
        const env = { ...process.env, RUTAS_GATE_APP: app, RUTAS_GATE_PRECARGA: pre };
        let salida = '', ok = true;
        try { salida = execFileSync('node', [GATE], { env, encoding: 'utf8', cwd: RAIZ }); }
        catch (e) { ok = false; salida = (e.stdout || '') + (e.stderr || ''); }
        expect(ok).toBe(false);
        expect(salida).toContain('sin clave en IMPORTADOR_POR_RUTA');
        expect(salida).toContain('/bitacoras');
    });

    it('caza un menú y un encabezado que no comparten ni una palabra', () => {
        // Es la señal que delató a «Centro de comunicaciones» sobre una pantalla
        // que dice «aviso» 34 veces, con el menú diciendo «Gestionar avisos».
        // Contar la palabra dentro del archivo NO sirve: se probó y acusa a
        // cuatro pantallas correctas. Lo que sirve es que los dos nombres de la
        // misma pantalla no se toquen.
        const mm = path.join(tmp, 'moduleMap.js');
        fs.writeFileSync(mm, fs.readFileSync(path.join(RAIZ, 'src/constants/moduleMap.js'), 'utf8')
            .replace("label: 'Bitácoras'", "label: 'Registros regulados'"));
        const app = path.join(tmp, 'App-vocabulario.jsx');
        fs.writeFileSync(app, fs.readFileSync(APP_REAL, 'utf8'));
        const env = { ...process.env, RUTAS_GATE_APP: app, RUTAS_GATE_MODULOS: mm };
        let salida = '', ok = true;
        try { salida = execFileSync('node', [GATE], { env, encoding: 'utf8', cwd: RAIZ }); }
        catch (e) { ok = false; salida = (e.stdout || '') + (e.stderr || ''); }
        expect(ok).toBe(false);
        expect(salida).toContain('no comparten ni una palabra');
        expect(salida).toContain('/bitacoras');
    });

    it('NO acusa al menú que abrevia dentro de su grupo', () => {
        // `/personal` dice «Listado» en el menú y «Gestión de personal» en el
        // encabezado. No comparten palabra y está BIEN: «Listado» se lee bajo el
        // grupo «Personal». Está declarado en MENU_ABREVIA con su motivo.
        const { ok, salida } = correr();
        expect(ok).toBe(true);
        expect(salida).not.toContain('no comparten ni una palabra');
    });

    // ── Los dos falsos positivos de la primera corrida ───────────────────────

    it('NO acusa a una ficha de detalle de no tener título de pestaña', () => {
        const { salida } = correr();
        expect(salida).not.toContain('/conteo-inventario/:id');
        expect(salida).not.toContain('/personal/empleado/:id');
    });

    it('NO confunde el tooltip de un botón anidado con el encabezado de la vista', () => {
        // `EncuestaView` arma su título con un `title={<div>…}` que lleva
        // adentro un botón de volver. El encabezado NO se puede medir desde el
        // fuente, y «no lo pude medir» no es «está mal».
        const { salida } = correr();
        expect(salida).not.toContain('Volver a Gestión de encuesta');
    });
});

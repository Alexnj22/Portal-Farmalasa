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

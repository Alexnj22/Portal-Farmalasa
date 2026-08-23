// ─────────────────────────────────────────────────────────────────────────────
// Las regresiones que el candado de auditoría TIENE que cazar
// ─────────────────────────────────────────────────────────────────────────────
//
// Existe por la lección más cara de agosto: «en esta tanda, seis de los
// hallazgos no estaban en el portal sino en cómo se leía la medición». Un gate
// que da verde no prueba nada hasta que se le fabrica el caso que debería
// hacerlo fallar — el detector de acuse acusaba a 36 tarjetas correctas y tapaba
// al único botón mudo, y nadie lo notó porque el número se veía razonable.
//
// Acá cada prueba construye a mano el defecto y exige que el gate lo vea. Si
// alguna de éstas empieza a pasar en verde con el defecto puesto, el gate se
// quedó ciego y el porcentaje del portal deja de significar algo.

import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AREAS, EJES, TOPE_SIN_SELLO, areaDeArchivo } from '../../auditoria/areas.mjs';

const RAIZ = path.resolve(import.meta.dirname, '../..');
const GATE = path.join(RAIZ, 'scripts', 'auditoria-gate.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'auditoria-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

// Corre el gate contra un directorio de registro fabricado. Devuelve
// { ok, salida } en vez de lanzar, porque lo que se prueba es justamente el
// código de salida.
function correr({ registro, desbloqueos = { abiertos: [] }, preparados = [], hook = true, extra = null }) {
    fs.writeFileSync(path.join(tmp, 'registro.json'), JSON.stringify(registro));
    fs.writeFileSync(path.join(tmp, 'desbloqueos.json'), JSON.stringify(desbloqueos));
    // El snapshot se copia del real: estas pruebas son sobre el CANDADO, y sin
    // snapshot el gate emite un aviso que ensucia la lectura de cada caso.
    const real = path.join(RAIZ, 'auditoria', 'snapshot-produccion.json');
    if (fs.existsSync(real)) fs.copyFileSync(real, path.join(tmp, 'snapshot-produccion.json'));
    const anon = path.join(RAIZ, 'auditoria', 'superficie-anon.json');
    if (fs.existsSync(anon)) fs.copyFileSync(anon, path.join(tmp, 'superficie-anon.json'));
    if (extra) for (const [nombre, valor] of Object.entries(extra))
        fs.writeFileSync(path.join(tmp, nombre), JSON.stringify(valor));

    const env = { ...process.env, AUDITORIA_DIR: tmp, AUDITORIA_PREPARADOS: preparados.join(',') };
    try {
        const salida = execFileSync('node', [GATE, ...(hook ? ['--hook'] : [])], { env, encoding: 'utf8' });
        return { ok: true, salida };
    } catch (e) {
        return { ok: false, salida: (e.stdout || '') + (e.stderr || '') };
    }
}

// Un área congelada de mentira: los doce ejes en 100 con evidencia y el sello
// puesto. Es el único estado desde el que el candado debe morder.
function areaCongelada(id) {
    const ejes = {};
    for (const e of EJES) ejes[e.id] = { pct: 100, evidencia: 'prueba' };
    return { [id]: { ejes, pct: 100, estado: 'congelado', sello_sala: '2026-08-23', hallazgos: [] } };
}

describe('el mapa cubre el portal entero', () => {
    it('no deja ni un archivo de src/ sin área', () => {
        const archivos = execFileSync('git', ['ls-files', 'src/**'], { cwd: RAIZ, encoding: 'utf8' })
            .trim().split('\n').filter(f => /\.(js|jsx)$/.test(f));
        expect(archivos.length).toBeGreaterThan(400);
        expect(archivos.filter(f => !areaDeArchivo(f))).toEqual([]);
    });

    it('gana el prefijo más largo, no el primero que empareja', () => {
        // Si ganara el primero, `src/views/productos/` (área productos) se
        // llevaría los archivos de tabminmax, que son de Min·Máx. Esa confusión
        // no da error: da un porcentaje que suma la deuda de un área a la otra.
        expect(areaDeArchivo('src/views/productos/TabCatalogo.jsx')).toBe('productos');
        expect(areaDeArchivo('src/views/productos/tabminmax/helpers.js')).toBe('minmax');
    });

    it('ninguna pieza pertenece a dos áreas', () => {
        for (const campo of ['tablas', 'edge', 'crons']) {
            const vistas = new Map();
            for (const a of AREAS) for (const v of a[campo]) {
                expect(vistas.has(v), `${campo} «${v}» está en ${vistas.get(v)} y en ${a.id}`).toBe(false);
                vistas.set(v, a.id);
            }
        }
    });
});

describe('el candado muerde cuando debe', () => {
    it('bloquea el commit que toca un área congelada', () => {
        const r = correr({
            registro: { areas: areaCongelada('traslados') },
            preparados: ['src/views/TrasladosView.jsx'],
        });
        expect(r.ok).toBe(false);
        expect(r.salida).toContain('CONGELADA');
        expect(r.salida).toContain('auditoria:desbloquear');
    });

    it('deja pasar el commit que NO toca ningún área congelada', () => {
        const r = correr({
            registro: { areas: areaCongelada('traslados') },
            preparados: ['src/views/PedidosView.jsx'],
        });
        expect(r.ok).toBe(true);
    });

    it('deja pasar cuando hay un desbloqueo abierto, pero lo avisa', () => {
        const r = correr({
            registro: { areas: areaCongelada('traslados') },
            desbloqueos: { abiertos: [{ area: 'traslados', motivo: 'arreglar el motivo obligatorio', desde: '2026-08-23' }] },
            preparados: ['src/views/TrasladosView.jsx'],
            hook: true,
        });
        expect(r.ok).toBe(true);
    });

    it('NO deja cerrar el trabajo con un desbloqueo abierto', () => {
        // Ésta es la mitad «verificación después». El commit puntual pasa (arriba)
        // pero el gate completo tiene que negarse hasta que el área se vuelva a
        // sellar. Si esta prueba se pone verde, descongelar se volvió gratis.
        const r = correr({
            registro: { areas: areaCongelada('traslados') },
            desbloqueos: { abiertos: [{ area: 'traslados', motivo: 'x', desde: '2026-08-23' }] },
            hook: false,
        });
        expect(r.ok).toBe(false);
        expect(r.salida).toContain('sin volver a sellar');
    });
});

describe('un puntaje no se puede inventar', () => {
    it('rechaza un pct escrito a mano que no sale de los ejes', () => {
        const areas = areaCongelada('traslados');
        areas.traslados.ejes.flujo.pct = 40;     // el promedio ya no da 100…
        // …pero el pct guardado sigue diciendo 100.
        const r = correr({ registro: { areas }, hook: false });
        expect(r.ok).toBe(false);
        expect(r.salida).toContain('≠ calculado');
    });

    it('rechaza un eje en verde sin evidencia escrita', () => {
        const areas = areaCongelada('traslados');
        delete areas.traslados.ejes.seguridad.evidencia;
        const r = correr({ registro: { areas }, hook: false });
        expect(r.ok).toBe(false);
        expect(r.salida).toContain('sin evidencia escrita');
    });

    it('rechaza congelar un área sin el sello de sala', () => {
        const areas = areaCongelada('traslados');
        areas.traslados.sello_sala = null;
        areas.traslados.pct = TOPE_SIN_SELLO;    // el tope que impone la falta de sello
        const r = correr({ registro: { areas }, hook: false });
        expect(r.ok).toBe(false);
        expect(r.salida).toContain('sin sello de sala');
    });

    it('el sello es un tope y no un sumando: doce ejes perfectos sin sello no llegan a 100', () => {
        const areas = areaCongelada('traslados');
        areas.traslados.sello_sala = null;
        areas.traslados.estado = 'completo';
        areas.traslados.pct = TOPE_SIN_SELLO;
        const r = correr({ registro: { areas }, hook: false });
        expect(r.ok).toBe(true);
        expect(TOPE_SIN_SELLO).toBeLessThan(100);
    });
});

describe('la superficie que se toca SIN credenciales está vigilada', () => {
    it('lo que produccion expone a anon está declarado con su motivo', () => {
        const snap = JSON.parse(fs.readFileSync(path.join(RAIZ, 'auditoria/snapshot-produccion.json'), 'utf8'));
        const dec = JSON.parse(fs.readFileSync(path.join(RAIZ, 'auditoria/superficie-anon.json'), 'utf8'));
        for (const clave of ['funciones', 'tablas']) {
            const nombres = new Set(dec[clave].map(x => x.nombre));
            expect((snap.anon?.[clave] || []).filter(x => !nombres.has(x))).toEqual([]);
        }
        // Y cada una tiene que decir CÓMO se defiende. Una entrada sin guarda
        // escrita es una declaración vacía: sirve para callar el gate y para
        // nada más.
        for (const f of dec.funciones) { expect(f.guarda, f.nombre).toBeTruthy(); expect(f.motivo.length, f.nombre).toBeGreaterThan(30); }
    });

    it('el gate FALLA si producción expone algo que nadie declaró', () => {
        const snap = JSON.parse(fs.readFileSync(path.join(RAIZ, 'auditoria/snapshot-produccion.json'), 'utf8'));
        const r = correr({
            registro: { areas: {} },
            hook: false,
            extra: { 'snapshot-produccion.json': {
                ...snap,
                anon: { ...snap.anon, funciones: [...snap.anon.funciones, 'borrar_todo_sin_permiso'] },
            } },
        });
        expect(r.ok).toBe(false);
        expect(r.salida).toContain('borrar_todo_sin_permiso');
        expect(r.salida).toContain('sin declarar');
    });
});

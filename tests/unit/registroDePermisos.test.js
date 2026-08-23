// El registro de permisos — 156 llaves, y ninguna puede ser ambigua.
//
// Permisos no tenía ni una prueba, y es el archivo que decide quién ve qué en
// todo el portal. `gate:permisos` ya cruza lo declarado contra lo que el código
// consulta; lo que no mira nadie es la FORMA del registro, y ahí hay tres cosas
// que se rompen solas:
//
//   · una clave repetida — la segunda gana en silencio y el permiso que alguien
//     otorgó desde la pantalla se aplica a otra cosa;
//   · un sub-permiso cuya clave no empieza por la de su módulo, que rompe el
//     canon §7-bis y hace imposible saber a qué pertenece leyéndola;
//   · un `_tab_` que en realidad es una capacidad, que fue exactamente el
//     hallazgo de la auditoría del 2026-08-03 (`productos_tab_catalogo_costos`
//     se llamaba pestaña y gateaba una columna).
//
// Ninguna de las tres da error. Las tres producen una pantalla de permisos que
// promete algo distinto de lo que hace.

import { describe, it, expect } from 'vitest';
import { MODULE_GROUPS, MODULE_INFO, pestanasDe, capacidadesDe } from '../../src/constants/permissionModules';
import { MODULE_MAP } from '../../src/constants/moduleMap';

const modulos = MODULE_GROUPS.flatMap(g => g.modules);
const subs    = modulos.flatMap(m => (m.sub || []).map(s => ({ ...s, padre: m.key })));

describe('la forma del registro', () => {
    it('tiene módulos y grupos, y ninguno vacío', () => {
        expect(MODULE_GROUPS.length).toBeGreaterThan(5);
        for (const g of MODULE_GROUPS) {
            expect(g.group, 'grupo sin nombre').toBeTruthy();
            expect(g.modules.length, `grupo vacío: ${g.group}`).toBeGreaterThan(0);
        }
    });

    it('ninguna clave se repite — ni entre módulos, ni entre sub-permisos', () => {
        // Una clave repetida no falla: la segunda pisa a la primera en
        // `MODULE_INFO` y el interruptor de la pantalla queda gobernando otra
        // cosa. Se comprueba sobre TODAS las claves juntas porque los
        // sub-permisos también son filas de `role_permissions`.
        const todas = [...modulos.map(m => m.key), ...subs.map(s => s.key)];
        const vistas = new Map();
        const repetidas = [];
        for (const k of todas) {
            if (vistas.has(k)) repetidas.push(k);
            vistas.set(k, true);
        }
        expect(repetidas).toEqual([]);
        expect(Object.keys(MODULE_INFO)).toHaveLength(todas.length);
    });

    it('cada módulo declara etiqueta y descripción', () => {
        // La pantalla de Permisos es lo que alguien lee para decidir si le da
        // una llave a otra persona. Un módulo sin descripción se otorga a ciegas.
        for (const m of modulos) {
            expect(m.label, `sin label: ${m.key}`).toBeTruthy();
            expect(m.desc, `sin desc: ${m.key}`).toBeTruthy();
            expect(m.desc.length, `desc demasiado corta: ${m.key}`).toBeGreaterThan(15);
        }
    });

    it('las claves son snake_case en minúsculas', () => {
        for (const k of [...modulos.map(m => m.key), ...subs.map(s => s.key)]) {
            expect(k, `clave fuera de formato: ${k}`).toMatch(/^[a-z0-9_]+$/);
        }
    });
});

describe('el canon de los sub-permisos (§7-bis)', () => {
    // La ÚNICA clave del registro que no sigue el canon. Se ancla con su motivo
    // en vez de arreglarse, y en vez de bajarle la exigencia a la regla:
    //
    // `conteo_ver_sistema` es del módulo `conteo_inventario`, así que debería
    // llamarse `conteo_inventario_ver_sistema`. Renombrarla no es editar una
    // línea: hay 9 filas otorgadas en `role_permissions` y una función de
    // Postgres que la nombra, así que exige migración de datos MÁS cambiar la
    // función MÁS el frontend — y es exactamente el caso de «el rótulo ES la
    // clave». Cuesta una migración y no arregla ningún comportamiento: la llave
    // funciona, sólo se lee peor.
    //
    // Queda acá para que una clave NUEVA fuera del canon sí haga fallar la
    // prueba. Perdonar la categoría entera por este caso sería cambiar la regla
    // para que el incumplimiento entre.
    const FUERA_DEL_CANON_CON_MOTIVO = new Set(['conteo_ver_sistema']);

    it('la clave de un sub-permiso EMPIEZA por la de su módulo', () => {
        // Sin esto no se puede saber a qué pertenece una clave leyéndola, y
        // `role_permissions` guarda claves sueltas: la fila no dice de quién es.
        const malas = subs
            .filter(s => !s.key.startsWith(`${s.padre}_`))
            .filter(s => !FUERA_DEL_CANON_CON_MOTIVO.has(s.key))
            .map(s => `${s.key} debería empezar por ${s.padre}_`);
        expect(malas).toEqual([]);
    });

    it('la excepción declarada sigue siendo UNA, y sigue existiendo', () => {
        // Las dos mitades importan. Si la lista crece sin que nadie lo decida,
        // la excepción se volvió la regla; y si la clave se renombró y nadie
        // limpió esta lista, la prueba estaría perdonando algo que ya no existe
        // — y el día que aparezca otra con ese nombre pasaría sin ruido.
        expect(FUERA_DEL_CANON_CON_MOTIVO.size).toBe(1);
        for (const k of FUERA_DEL_CANON_CON_MOTIVO) {
            expect(subs.some(s => s.key === k), `«${k}» ya no está en el registro`).toBe(true);
        }
    });

    it('cada sub-permiso declara SI es pestaña o capacidad', () => {
        // El campo `tipo` existe porque antes todo se llamaba «pestaña» y para
        // la mitad era mentira. Uno sin tipo vuelve a esa ambigüedad.
        for (const s of subs) {
            expect(['tab', 'cap'], `«${s.key}» tiene tipo «${s.tipo}»`).toContain(s.tipo);
        }
    });

    it('`_tab_` en la clave sólo lo llevan las pestañas de verdad', () => {
        // El hallazgo del 2026-08-03: `productos_tab_catalogo_costos` se llamaba
        // pestaña y gateaba una columna de costos.
        for (const s of subs) {
            if (s.key.includes('_tab_')) {
                expect(s.tipo, `«${s.key}» lleva _tab_ y es tipo «${s.tipo}»`).toBe('tab');
            }
            if (s.tipo === 'tab') {
                expect(s.key.includes('_tab_'), `pestaña «${s.key}» sin _tab_ en la clave`).toBe(true);
            }
        }
    });

    it('los helpers parten los sub-permisos sin perder ninguno', () => {
        for (const m of modulos) {
            const total = (m.sub || []).length;
            expect(pestanasDe(m).length + capacidadesDe(m).length, `módulo ${m.key}`).toBe(total);
        }
    });

    it('un módulo sin sub-permisos no rompe los helpers', () => {
        expect(pestanasDe({})).toEqual([]);
        expect(capacidadesDe({ sub: undefined })).toEqual([]);
    });
});

describe('el registro y el menú hablan de los mismos módulos', () => {
    it('todo módulo del MENÚ existe en el registro de permisos', () => {
        // Al revés está permitido —hay módulos que se otorgan y no son una
        // entrada de menú, como `staff_detail`— pero un módulo que el menú
        // muestra y que no se puede otorgar es una puerta sin llave. Pasó con
        // `maintenance`, que estaba en el menú y ausente del registro.
        const enRegistro = new Set(Object.keys(MODULE_INFO));
        const huerfanos = Object.keys(MODULE_MAP).filter(k => !enRegistro.has(k));
        expect(huerfanos).toEqual([]);
    });

    it('las rutas del menú son rutas, no etiquetas', () => {
        for (const [k, v] of Object.entries(MODULE_MAP)) {
            expect(v.path, `módulo sin ruta: ${k}`).toMatch(/^\//);
            expect(v.label, `módulo sin etiqueta: ${k}`).toBeTruthy();
        }
    });

    it('dos módulos no comparten la misma ruta', () => {
        // Dos llaves para la misma puerta: al quitar una, la puerta sigue
        // abierta por la otra y nadie entiende por qué.
        const rutas = Object.values(MODULE_MAP).map(v => v.path);
        expect(new Set(rutas).size, 'hay rutas repetidas en MODULE_MAP').toBe(rutas.length);
    });
});

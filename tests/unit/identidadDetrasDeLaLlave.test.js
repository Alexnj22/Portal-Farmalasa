// La identidad previsional dejó de viajar con la fila.
//
// `dui`, `alt_identity_document`, `isss_number` y `afp_number` salieron de
// `employees_safe` el 2026-08-24. El motivo es distinto —y peor— que el del
// sueldo: allá la protección existía por una coincidencia de configuración (los
// cuatro cargos que abren un expediente eran los cuatro que tenían la llave).
// Acá no había coincidencia que valga. La policy de `employees` deja que
// **cualquier sesión** lea las filas que no son de un superusuario, y el recorte
// por sucursal lo hace el NAVEGADOR: el documento de identidad de las 47
// personas viajaba a cualquiera que abriera la consola.
//
// Lo que este archivo ancla son las dos asimetrías que hacen que esto funcione y
// que se pierden en cuanto alguien "simplifica":
//
//   · **la identidad devuelve lo PROPIO aunque no haya llave** — «Mi perfil»
//     muestra el documento de uno, y esconderle a alguien su propio DUI no
//     protege a nadie: rompe una pantalla. Es justo al revés que el sueldo, que
//     sin la llave viene vacío y punto;
//   · **el duplicado ya no se busca en el padrón cargado** — sin el campo ahí,
//     `some()` diría «no hay duplicado» SIEMPRE. No fallaría al comprobar:
//     guardaría, y el índice único de la base tiraría un error crudo en
//     pantalla. Es exactamente lo que pasó con el código de carné.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { crearEspia } from './_espiaSupabase';

const espia = crearEspia();
vi.mock('../../src/supabaseClient', () => ({ supabase: espia.supabase }));

const { fetchIdentidades, duiDisponible } = await import('../../src/data/employees');
const rpcReal = espia.supabase.rpc;

beforeEach(() => { espia.limpiar(); espia.supabase.rpc = rpcReal; });

/** Hace que el próximo `rpc` conteste lo que se le diga. */
const contesta = (data, error = null) => {
    espia.supabase.rpc = (nombre, args) => {
        espia.rpc.push({ nombre, args });
        return Promise.resolve({ data, error });
    };
};

describe('la identidad se pide por su función, no con la fila', () => {
    it('va al RPC y no a la vista', async () => {
        contesta([]);
        await fetchIdentidades(['a', 'b']);
        expect(espia.rpc[0].nombre).toBe('get_employee_identidad');
        expect(espia.pasos.filter(p => p.metodo === 'from')).toHaveLength(0);
    });

    it('los ids van sin repetir y sin huecos', async () => {
        // Se piden TODOS de una en el arranque: repetir un id es pedir la misma
        // fila dos veces por cada pantalla que la nombre.
        contesta([]);
        await fetchIdentidades(['a', 'a', null, 'b', undefined, '']);
        expect(espia.rpc[0].args.p_ids).toEqual(['a', 'b']);
    });

    it('sin ids no pregunta nada', async () => {
        contesta([]);
        expect((await fetchIdentidades([])).size).toBe(0);
        expect((await fetchIdentidades(null)).size).toBe(0);
        expect(espia.rpc).toHaveLength(0);
    });

    it('devuelve un mapa por empleado', async () => {
        contesta([{ employee_id: 'a', dui: '01234567-8', isss_number: '111',
                    afp_number: 'AFP-1', alt_identity_document: null }]);
        const m = await fetchIdentidades(['a']);
        expect(m.get('a').dui).toBe('01234567-8');
        expect(m.get('a').isss_number).toBe('111');
    });

    it('si falla NO lanza: el portal se queda sin el dato, no sin empleados', async () => {
        // Es la misma decisión que con los salarios. Lanzar acá dejaría el
        // arranque entero sin padrón por un campo de la ficha.
        contesta(null, { message: 'timeout' });
        const m = await fetchIdentidades(['a']);
        expect(m.size).toBe(0);
    });

    it('quien no está en la respuesta simplemente no está', async () => {
        // El servidor devuelve MENOS filas de las pedidas cuando no le tocan: es
        // el caso normal, no un error. Quien fusiona deja esos campos como
        // vinieron de la vista, o sea nulos.
        contesta([{ employee_id: 'a', dui: '01234567-8' }]);
        const m = await fetchIdentidades(['a', 'b', 'c']);
        expect(m.size).toBe(1);
        expect(m.get('b')).toBeUndefined();
    });
});

describe('el DUI repetido lo contesta el servidor', () => {
    it('pregunta por su función, con el excluido', async () => {
        // Al EDITAR hay que excluirse: si no, toda ficha con DUI chocaría
        // consigo misma y no se podría guardar ningún otro campo.
        contesta(true);
        await duiDisponible('01234567-8', 'emp-7');
        expect(espia.rpc[0].nombre).toBe('dui_disponible');
        expect(espia.rpc[0].args).toEqual({ p_dui: '01234567-8', p_excluir: 'emp-7' });
    });

    it('en un alta el excluido es nulo, no `undefined`', async () => {
        contesta(true);
        await duiDisponible('01234567-8');
        expect(espia.rpc[0].args.p_excluir).toBeNull();
    });

    it('un valor ausente viaja como cadena vacía y no como «null»', async () => {
        // `String(null)` da la cadena 'null', que del otro lado son cuatro
        // caracteres que nadie tiene de DUI — se vería como «libre» por el
        // motivo equivocado.
        contesta(true);
        await duiDisponible(null);
        expect(espia.rpc[0].args.p_dui).toBe('');
    });

    it('devuelve `null` si no se pudo preguntar — y eso NO es «ocupado»', async () => {
        // La distinción es el punto: sólo un `false` explícito bloquea. Una red
        // caída no puede impedir dar de alta a alguien, y el índice único de la
        // base sigue siendo la última palabra.
        contesta(null, { message: 'sin red' });
        expect(await duiDisponible('01234567-8')).toBeNull();
    });

    it('libre y ocupado se distinguen', async () => {
        contesta(true);
        expect(await duiDisponible('01234567-8')).toBe(true);
        contesta(false);
        expect(await duiDisponible('01234567-8')).toBe(false);
    });
});

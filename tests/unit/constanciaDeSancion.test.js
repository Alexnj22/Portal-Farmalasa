/**
 * La constancia del Art. 83, anclada por lo que el REGLAMENTO exige.
 *
 * No prueba que se vea bonita: prueba que no se pueda perder en silencio nada de
 * lo que hace válido el papel. Un documento legal es exactamente el sitio donde
 * un rediseño bienintencionado borra un renglón y nadie lo nota hasta que un
 * juez lo mira.
 */
import { describe, it, expect } from 'vitest';
import { definicionDeLaConstancia, nombreDeLaConstancia } from '../../src/utils/constanciaDeSancion';

/** Todo el texto del documento, en una sola cadena. */
function textoDe(nodo, out = []) {
    if (nodo == null) return out;
    if (Array.isArray(nodo)) { nodo.forEach(n => textoDe(n, out)); return out; }
    if (typeof nodo === 'string') { out.push(nodo); return out; }
    if (typeof nodo !== 'object') return out;
    if (typeof nodo.text === 'string') out.push(nodo.text);
    else if (Array.isArray(nodo.text)) textoDe(nodo.text, out);
    ['stack', 'columns', 'content'].forEach(k => textoDe(nodo[k], out));
    if (nodo.table?.body) textoDe(nodo.table.body, out);
    return out;
}
const todo = (def) => textoDe(def.content).join('\n');

/** Los renglones en blanco: una tabla cuyas celdas son sólo un espacio. */
function renglonesEnBlanco(def) {
    let n = 0;
    const ver = (nodo) => {
        if (nodo == null || typeof nodo !== 'object') return;
        if (Array.isArray(nodo)) return nodo.forEach(ver);
        if (nodo.table?.body && nodo.table.body.every(f => f.length === 1 && f[0]?.text === ' ')) {
            n += nodo.table.body.length;
        }
        ['stack', 'columns', 'content'].forEach(k => ver(nodo[k]));
        if (nodo.table?.body) ver(nodo.table.body);
    };
    ver(def.content);
    return n;
}

const base = {
    nombre: 'JUANA PÉREZ', dui: '01234567-8', cargo: 'Dependiente', sala: 'Salud 1',
    falta: 'Faltante de caja', faltaArticulo: 'CT Art. 50 num. 9',
    fecha: '2026-08-31', hechos: 'Diferencia de $12.00 en el corte del turno.',
    impuestaPor: 'CELINA ESCOBAR',
};

describe('constancia de sanción · lo que el Art. 83 exige', () => {
    it('deja renglones EN BLANCO para el compromiso de puño y letra', () => {
        // El num. 2 pide que el compromiso lo declare el trabajador «con puño y
        // letra». Un párrafo ya redactado no cumple: el espacio ES el requisito.
        const def = definicionDeLaConstancia({ ...base, peldano: 2 });
        expect(renglonesEnBlanco(def)).toBeGreaterThanOrEqual(3);
        expect(todo(def)).toMatch(/puño y letra/i);
    });

    it('imprime el derecho a reclamar del Art. 77 con sus plazos', () => {
        // Un derecho con plazo que nadie comunica es un derecho que vence solo.
        const t = todo(definicionDeLaConstancia({ ...base, peldano: 1 }));
        expect(t).toMatch(/Art\. 77/);
        expect(t).toMatch(/DOS DÍAS HÁBILES/);
        expect(t).toMatch(/Recursos Humanos/);
        expect(t).toMatch(/Administración/);
    });

    it('nombra el numeral del reglamento que corresponde a cada peldaño', () => {
        // El papel tiene que poder leerse CONTRA el RIT; el rótulo de la
        // pantalla no alcanza.
        expect(todo(definicionDeLaConstancia({ ...base, peldano: 1 }))).toMatch(/numeral 1/);
        expect(todo(definicionDeLaConstancia({ ...base, peldano: 2 }))).toMatch(/numeral 2/);
        expect(todo(definicionDeLaConstancia({ ...base, peldano: 3 }))).toMatch(/numeral 3/);
        expect(todo(definicionDeLaConstancia({ ...base, peldano: 4 }))).toMatch(/numeral 4/);
    });

    it('la suspensión del numeral 3 dice UN día y no un rango', () => {
        const t = todo(definicionDeLaConstancia({ ...base, peldano: 3, dias: 1 }));
        expect(t).toMatch(/Un día sin goce de salario/);
        expect(t).not.toMatch(/ al 3[01] de/);   // no imprime un rango
    });

    it('la suspensión del numeral 4 imprime el rango Y la autorización del DGIT', () => {
        // Sin esa autorización la suspensión de más de un día es ilegal. Que
        // esté guardada no basta: quien recibe el papel tiene que poder verla.
        const t = todo(definicionDeLaConstancia({
            ...base, peldano: 4, dias: 3, hasta: '2026-09-02',
            autorizacion: 'Resolución DGIT 123/2026',
        }));
        expect(t).toMatch(/3 días sin goce de salario/);
        expect(t).toMatch(/31 de agosto de 2026/);
        expect(t).toMatch(/2 de septiembre de 2026/);
        expect(t).toMatch(/Director General de Inspección de Trabajo/);
        expect(t).toMatch(/Resolución DGIT 123\/2026/);
    });

    it('la advertencia cambia con el peldaño', () => {
        // El num. 1 manda advertir que rectifique «de inmediato»; a partir del 2
        // lo que corresponde advertir es la consecuencia de reincidir.
        expect(todo(definicionDeLaConstancia({ ...base, peldano: 1 }))).toMatch(/de inmediato/);
        expect(todo(definicionDeLaConstancia({ ...base, peldano: 2 }))).toMatch(/sesenta días/);
    });

    it('lleva las dos firmas: el trabajador y la Empresa', () => {
        const t = todo(definicionDeLaConstancia({ ...base, peldano: 2 }));
        expect(t).toMatch(/Trabajador/);
        expect(t).toMatch(/Por la Empresa/);
        expect(t).toMatch(/JUANA PÉREZ/);
        expect(t).toMatch(/CELINA ESCOBAR/);
    });

    it('una fecha sin hora no retrocede un día', () => {
        // `new Date('2026-08-31')` es medianoche UTC y en El Salvador (UTC-6) se
        // lee como el 30. El mediodía lo evita.
        expect(todo(definicionDeLaConstancia({ ...base, peldano: 1 })))
            .toMatch(/31 de agosto de 2026/);
    });

    it('sin hechos escritos no imprime un bloque vacío', () => {
        const t = todo(definicionDeLaConstancia({ ...base, peldano: 1, hechos: null }));
        expect(t).not.toMatch(/HECHOS/);
    });

    it('deja constancia de la NEGATIVA a firmar, con dos testigos', () => {
        // Es el caso normal en una sanción, no la excepción: una hoja sin firma
        // y sin nada que explique por qué no la tiene no prueba que el acto
        // haya ocurrido.
        const t = todo(definicionDeLaConstancia({ ...base, peldano: 2 }));
        expect(t).toMatch(/SE NIEGA A FIRMAR/);
        expect((t.match(/Testigo/g) || []).length).toBe(2);
    });

    it('el membrete identifica al patrono con NIT y NRC', () => {
        // Sin emisor, una hoja no acredita nada — no importa lo bien redactada
        // que esté.
        const t = todo(definicionDeLaConstancia({ ...base, peldano: 1 }));
        expect(t).toMatch(/NIT 0401-210685-101-0/);
        expect(t).toMatch(/NRC 213237-5/);
    });

    it('sin lugar confirmado NO inventa una ciudad', () => {
        // La primera versión decía «Chalatenango», que salió de una inferencia
        // y no de ningún dato de la empresa. Un documento que se firma no lleva
        // un lugar deducido.
        const sinLugar = todo(definicionDeLaConstancia({ ...base, peldano: 1 }));
        expect(sinLugar).not.toMatch(/Chalatenango/);
        expect(sinLugar).toMatch(/^A los 31 de agosto de 2026.$/m);

        const conLugar = todo(definicionDeLaConstancia({ ...base, peldano: 1, lugar: 'Chalatenango' }));
        expect(conLugar).toMatch(/En Chalatenango, a los 31 de agosto de 2026/);
    });

    it('el nombre del archivo se reconoce sin abrirlo', () => {
        expect(nombreDeLaConstancia('JUANA PÉREZ', '2026-08-31'))
            .toBe('constancia-juana-perez-2026-08-31.pdf');
    });
});

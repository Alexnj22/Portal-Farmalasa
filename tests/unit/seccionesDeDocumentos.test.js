// ─────────────────────────────────────────────────────────────────────────────
// En qué sección va cada documento del expediente
// ─────────────────────────────────────────────────────────────────────────────
//
// El orden es por CUÁNDO SE PIDE cada papel, que es como se llena un
// expediente. Lo que estas pruebas cuidan no es el orden en sí —eso se discute
// mirando la pantalla— sino las dos cosas que se rompen solas:
//
//   · que un documento quede en DOS secciones, y aparezca dos veces;
//   · que un documento no esté en ninguna, y desaparezca de la pantalla.
//
// La segunda ya tiene su red en el componente —lo que sobra cae en «Otros»—
// pero una red que nadie mira deja de avisar: acá el hueco se ve por nombre.
//
// Y el ISSS y la AFP tienen su propia sección desde que el usuario señaló que
// no tenían sentido dentro de «para ejercer su profesión»: no habilitan a nadie
// a ejercer nada, los tiene cualquiera que trabaje.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const fuente = fs.readFileSync(
    path.join(process.cwd(), 'src/components/forms/EmployeeFormModal.jsx'), 'utf8');

/* Recorta un arreglo por sus CORCHETES, contándolos.
 *
 * La primera versión cortaba en el primer `\n];`, y con eso dio VERDE sobre la
 * regresión que tenía que cazar: `EN_ACREDITACIONES` se declara en UNA sola
 * línea, así que no había `\n];` que encontrar, `indexOf` devolvía -1 y el
 * recorte se llevaba medio archivo — o sea que cualquier documento parecía estar
 * ahí dentro y ninguno quedaba «sin sección». Se descubrió fabricándole la
 * regresión. */
const bloque = (nombre) => {
    const i = fuente.indexOf(`const ${nombre} = [`);
    if (i < 0) throw new Error(`no encontré ${nombre}`);
    let prof = 0;
    for (let j = fuente.indexOf('[', i); j < fuente.length; j++) {
        if (fuente[j] === '[') prof++;
        else if (fuente[j] === ']' && --prof === 0) return fuente.slice(i, j + 1);
    }
    throw new Error(`${nombre} no cierra`);
};

const clavesPorSeccion = () => {
    const b = bloque('SECCIONES_DE_DOCUMENTOS');
    const titulos = [...b.matchAll(/titulo: '([^']+)'/g)].map(m => m[1]);
    const claves = [...b.matchAll(/claves: \[([^\]]+)\]/g)]
        .map(m => [...m[1].matchAll(/'([A-Z_]+)'/g)].map(x => x[1]));
    return Object.fromEntries(titulos.map((t, i) => [t, claves[i]]));
};

describe('las secciones', () => {
    const secciones = clavesPorSeccion();

    it('ningún documento está en dos secciones', () => {
        const todas = Object.values(secciones).flat();
        const repetidas = todas.filter((k, i) => todas.indexOf(k) !== i);
        expect(repetidas).toEqual([]);
    });

    it('el ISSS y la AFP van en la SUYA, no en «para ejercer su profesión»', () => {
        expect(secciones['ISSS y AFP']).toEqual(['TARJETA_ISSS', 'TARJETA_AFP']);
        expect(secciones['Para ejercer su profesión']).not.toContain('TARJETA_ISSS');
        expect(secciones['Para ejercer su profesión']).not.toContain('TARJETA_AFP');
    });

    it('lo que caduca va junto, y el certificado médico está entre ellos', () => {
        expect(secciones['Cada año']).toContain('CERTIFICADO_MEDICO_ANUAL');
        expect(secciones['Cada año']).toContain('ANUALIDAD_JVPQF');
    });

    it('el contrato y lo del Art. 8 van en «al entrar»', () => {
        expect(secciones['Al entrar']).toContain('CONTRATO');
        expect(secciones['Al entrar']).toContain('SOLICITUD_EMPLEO');
    });
});

describe('ningún documento se queda sin sección', () => {
    it('todos los del catálogo están ubicados, o el componente los manda a «Otros»', () => {
        // Las claves que el formulario puede ofrecer, sacadas de las dos listas
        // donde se declaran. `EN_ACREDITACIONES` no cuenta: esos se pintan en la
        // pestaña Contrato, no en Documentos.
        const enAcreditaciones = [...bloque('EN_ACREDITACIONES').matchAll(/'([A-Z_]+)'/g)].map(m => m[1]);
        const todasLasClaves = new Set([...fuente.matchAll(/key: '([A-Z_]+)'/g)].map(m => m[1]));
        const ubicadas = new Set(Object.values(clavesPorSeccion()).flat());

        const sinSeccion = [...todasLasClaves]
            .filter(k => !enAcreditaciones.includes(k) && !ubicadas.has(k));

        // Si esto falla, no es un error: es un documento nuevo al que hay que
        // decidirle sección. Cae en «Otros» mientras tanto, no desaparece.
        expect(sinSeccion).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// El carné de dependiente de farmacia, que dejó de ser un papel
// ─────────────────────────────────────────────────────────────────────────────
//
// El CSSP lo digitalizó: entrega un QR que lleva a la ficha en línea, y el
// expediente guarda esa DIRECCIÓN, no una foto del código.
//
// Lo que estas pruebas anclan es la comprobación de dominio, y la que importa
// no es «acepta el carné bueno» sino las tres que lo rechazan — sobre todo el
// truco del SUFIJO (`srs.gob.sv.otracosa.com`), que pasa cualquier
// comprobación escrita con `includes('srs.gob.sv')` y deja el expediente
// apuntando a un sitio de otro dueño.
//
// La misma regla vive en el CHECK de la base. Si las dos dejan de decir lo
// mismo, la pantalla acepta algo que Postgres rechaza y el guardado falla con
// un error de base de datos en la cara de quien lo escribió.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
    esCarneDeDependiente, normalizarCarne, numeroDelCarne, porQueNoSirve,
} from '../../src/utils/carneDeDependiente';

const REAL = 'https://expedientes.srs.gob.sv/carnets/dependientes/1758306680151';

describe('qué acepta', () => {
    it('el carné real', () => {
        expect(esCarneDeDependiente(REAL)).toBe(true);
    });

    it('otro subdominio del Consejo, y otra ruta', () => {
        // La comprobación es del DOMINIO a propósito: atada a la ruta exacta,
        // el día que el Consejo reacomode su sitio el portal empieza a
        // rechazar carnés válidos y nadie va a saber por qué.
        expect(esCarneDeDependiente('https://srs.gob.sv/carnets/x')).toBe(true);
        expect(esCarneDeDependiente('https://otro.srs.gob.sv/ruta/nueva/9')).toBe(true);
    });

    it('con espacios de sobra alrededor', () => {
        expect(normalizarCarne(`  ${REAL}  `)).toBe(REAL);
    });
});

describe('qué rechaza — que es la parte que importa', () => {
    it('el TRUCO DEL SUFIJO', () => {
        // `includes('srs.gob.sv')` diría que sí. El dueño de ese dominio es
        // otro, y el expediente quedaría apuntando a su sitio.
        expect(esCarneDeDependiente('https://srs.gob.sv.malo.com/carnets/dependientes/1')).toBe(false);
        expect(normalizarCarne('https://srs.gob.sv.malo.com/x')).toBeNull();
    });

    it('sin conexión segura', () => {
        expect(esCarneDeDependiente('http://expedientes.srs.gob.sv/carnets/dependientes/1')).toBe(false);
    });

    it('otro sitio cualquiera', () => {
        expect(esCarneDeDependiente('https://ejemplo.com/carnets/dependientes/1')).toBe(false);
    });

    it('el dominio pelado, sin ficha', () => {
        // `https://srs.gob.sv/` no es el carné de nadie.
        expect(esCarneDeDependiente('https://srs.gob.sv/')).toBe(false);
        expect(esCarneDeDependiente('https://srs.gob.sv')).toBe(false);
    });

    it('un texto que no es una dirección, y nada', () => {
        expect(esCarneDeDependiente('1758306680151')).toBe(false);
        expect(esCarneDeDependiente('')).toBe(false);
        expect(esCarneDeDependiente(null)).toBe(false);
    });
});

describe('el número que se muestra', () => {
    it('sale del último tramo', () => {
        expect(numeroDelCarne(REAL)).toBe('1758306680151');
        expect(numeroDelCarne(`${REAL}/`)).toBe('1758306680151');
    });

    it('NO se inventa cuando el último tramo no son dígitos', () => {
        // Mostrar un tramo cualquiera como «el número del carné» es fabricar un
        // dato con forma de dato.
        expect(numeroDelCarne('https://srs.gob.sv/carnets/dependientes/juan-perez')).toBeNull();
    });

    it('no dice nada de lo que no es un carné', () => {
        expect(numeroDelCarne('https://ejemplo.com/123456')).toBeNull();
    });
});

describe('por qué no sirve, dicho para quien escaneó', () => {
    it('distingue los tres casos en vez de dar un mensaje único', () => {
        expect(porQueNoSirve('')).toMatch(/no se leyó nada/i);
        expect(porQueNoSirve('cualquier texto')).toMatch(/no lleva a ninguna dirección/i);
        expect(porQueNoSirve('http://expedientes.srs.gob.sv/x')).toMatch(/conexión segura/i);
        expect(porQueNoSirve('https://ejemplo.com/x')).toMatch(/Consejo Superior de Salud Pública/i);
    });
});

describe('la pantalla y la base dicen lo mismo', () => {
    it('el CHECK de la migración usa la misma expresión', () => {
        const sql = fs.readFileSync(path.join(process.cwd(),
            'supabase/migrations/20260828161419_el_carne_de_dependiente_es_un_qr_no_un_papel.sql'), 'utf8');
        // Si divergen, la pantalla acepta algo que Postgres rechaza y el
        // guardado revienta con un error de base de datos.
        expect(sql).toMatch(/\^https:\/\/\(\[a-z0-9-\]\+\\\.\)\*srs\\\.gob\\\.sv\//);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// El documento que se le entrega a alguien el día que entra
// ─────────────────────────────────────────────────────────────────────────────
//
// Lo que se prueba acá no es «arma un PDF»: es lo que el documento NO puede
// decir y lo que no puede callar.
//
//  · El valor del carné NUNCA va en texto. Es la instrucción del usuario sobre
//    el carné de papel —«JAMÁS lo debes mostrar»— y vale igual acá: es una
//    credencial, y en claro basta una foto.
//  · «Nadie preguntó» no genera orientación. Escribirle «tienes que afiliarte»
//    a quien quizá ya está afiliado es peor que no decir nada.
//  · Al ISSS lo inscribe la empresa y la AFP la elige la persona. Confundirlos
//    le pide a alguien un trámite que no puede hacer.

import { describe, it, expect } from 'vitest';
import { marcaDeLaSala, logoDeLaSala } from '../../src/utils/marcaDeLaSala';
import { definicionDelDocumento, BASICO_DEL_REGLAMENTO, paginaDelCarne, INDUCCION, orientacionPrevisional, nombreDelArchivo } from '../../src/utils/documentoDeBienvenida';

const textoDe = (def) => JSON.stringify(def.content);

describe('el documento de accesos', () => {
    const base = {
        nombre: 'Ana María Pérez', cargo: 'Dependiente de Farmacia', sala: 'Salud 1',
        usuario: 'ana.perez', contrasenaTemporal: 'K7M2QX9P',
    };

    it('lleva el usuario y la contraseña', () => {
        const t = textoDe(definicionDelDocumento(base));
        expect(t).toContain('ana.perez');
        expect(t).toContain('K7M2QX9P');
    });

    it('el valor del carné NO se escribe en texto', () => {
        const t = textoDe(definicionDelDocumento({ ...base, barrasPng: 'data:image/png;base64,AAAA' }));
        expect(t).toContain('data:image/png;base64,AAAA');   // el código va como imagen
        expect(t).not.toContain('O25CPB1J');                 // …y su valor, nunca
    });

    it('el carné es el DEFINITIVO, y el documento lo dice', () => {
        // No es un carné del día: es el mismo código del plástico. Que no
        // caduque es lo que lo vuelve útil hasta que llega la tarjeta — y lo que
        // obliga a decir en voz alta lo que vale.
        const t = textoDe(definicionDelDocumento({ ...base, barrasPng: 'data:image/png;base64,AAAA' }));
        // Desde el 2026-08-29 esto vive en la PÁGINA 2, debajo del carné —que
        // es donde lo va a leer quien lo recorta— y no arriba con las claves.
        expect(t).toMatch(/mismo código que va a llevar tu carné de plástico/);
        expect(t).toMatch(/no caduca/);
        expect(t).toMatch(/puede marcar por ti/);
        // Y NO promete un vencimiento que ya no existe.
        expect(t).not.toMatch(/hasta el \d/);
    });

    it('sin carné, el documento sale igual', () => {
        // Si el carné no se pudo emitir, el usuario y la contraseña siguen
        // sirviendo: un documento a medias vale más que ninguno.
        const t = textoDe(definicionDelDocumento(base));
        expect(t).toContain('ana.perez');
        expect(t).not.toContain('carné temporal');
    });

    it('dice el nombre, el cargo y la sala', () => {
        const t = textoDe(definicionDelDocumento(base));
        expect(t).toContain('Ana María Pérez');
        expect(t).toContain('Dependiente de Farmacia');
        expect(t).toContain('Salud 1');
    });
});

describe('orientacionPrevisional', () => {
    it('«nadie preguntó» no genera texto', () => {
        expect(orientacionPrevisional({})).toEqual([]);
        expect(orientacionPrevisional({ isss_estado: null, afp_estado: null })).toEqual([]);
    });

    it('quien ya tiene los dos no recibe orientación', () => {
        expect(orientacionPrevisional({ isss_estado: 'TIENE', afp_estado: 'TIENE' })).toEqual([]);
    });

    it('el ISSS lo hace la empresa: no le pide nada a la persona', () => {
        const [b] = orientacionPrevisional({ isss_estado: 'NO_TIENE' });
        expect(b.titulo).toMatch(/ISSS/);
        expect(b.texto).toMatch(/la hace la empresa|La inscripción la hace la empresa/i);
        expect(b.texto).toMatch(/no tienes que ir/i);
    });

    it('la AFP la elige la persona: sí le pide algo, y le dice qué', () => {
        const [b] = orientacionPrevisional({ afp_estado: 'NO_TIENE' });
        expect(b.texto).toMatch(/lo tienes que hacer tú/i);
        expect(b.texto).toMatch(/DUI/);
    });

    it('«en trámite» sigue diciendo algo, y algo distinto', () => {
        const [b] = orientacionPrevisional({ afp_estado: 'EN_TRAMITE' });
        expect(b.texto).toMatch(/en trámite/i);
    });
});

describe('nombreDelArchivo', () => {
    it('se reconoce en la carpeta de descargas sin abrirlo', () => {
        expect(nombreDelArchivo('Ana María Pérez')).toBe('accesos-ana-maria-perez.pdf');
    });

    it('sin nombre no produce un archivo sin nombre', () => {
        expect(nombreDelArchivo('')).toBe('accesos-empleado.pdf');
        expect(nombreDelArchivo(null)).toBe('accesos-empleado.pdf');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// DOS páginas: una que se guarda y otra que se recorta
// ─────────────────────────────────────────────────────────────────────────────
//
// Pedido del usuario (2026-08-29): «que sea de 2 páginas, 1 página con
// información relevante, portal, bienvenida (puedes tomar algunas reglas… del
// RIT que sean básicas y necesarias) y en la 2, genera un carné».
//
// Son dos páginas por una razón física: la primera lleva la contraseña temporal
// —se guarda o se destruye— y la segunda se RECORTA. En la misma hoja, recortar
// el carné mutila las claves.

describe('las dos páginas', () => {
    const con = (extra = {}) => definicionDelDocumento({
        nombre: 'Carlos Antonio Renderos Mejía', cargo: 'Dependiente de Farmacia',
        sala: 'Salud 3', usuario: 'crenderos', contrasenaTemporal: 'Xk29-mQ4',
        fechaDeInicio: '2026-09-01', barrasPng: 'data:image/png;base64,AAAA', ...extra,
    });

    it('el carné empieza en una página nueva', () => {
        const saltos = JSON.stringify(con().content).match(/"pageBreak":"before"/g) || [];
        expect(saltos).toHaveLength(1);
    });

    it('la primera trae lo básico del reglamento, con su artículo', () => {
        const t = textoDe(con());
        expect(t).toMatch(/Lo básico, para empezar/);
        expect(t).toMatch(/diez minutos de tolerancia POR SEMANA/i);
        // Con el artículo: un papel que dice «no se puede» sin decir dónde lo
        // dice es una orden; con el artículo es una regla que se puede ir a leer.
        expect(t).toMatch(/Art\. 26/);
        expect(BASICO_DEL_REGLAMENTO.every(r => r.art && r.titulo && r.texto)).toBe(true);
    });

    /* ── La fecha del carné NO puede retroceder un día ───────────────────────
     * `new Date('2026-09-01')` es medianoche UTC, y en El Salvador (UTC-6) eso
     * es el 31 de agosto: el carné salía impreso con la persona empezando un
     * día antes. Es el defecto que la memoria llama «una fecha sin hora leída
     * como UTC retrocede», y acá se ve en un papel que se entrega. */
    it('la fecha de inicio no se corre un día', () => {
        const t = textoDe(con({ fechaDeInicio: '2026-09-01' }));
        expect(t).toMatch(/1 de septiembre de 2026|01 de septiembre de 2026/);
        expect(t).not.toMatch(/de agosto de 2026/);
    });

    it('el carné dice qué vale, y eso vive con el carné', () => {
        // Se mudó de la página 1 a la 2 al separarlas. Es lo que no puede
        // faltar: el código no caduca y quien le tome una foto puede marcar por
        // esta persona.
        const t = textoDe(con());
        expect(t).toMatch(/no caduca/);
        expect(t).toMatch(/puede marcar por ti/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// El carné DE PIE, con marcas de corte, y la inducción debajo
// ─────────────────────────────────────────────────────────────────────────────
//
// El usuario eligió la variante F de los seis bocetos: tarjeta de pie, blanca,
// con el canto verde y el ícono de la farmacia. Y pidió dos cosas más — marcas
// de corte, y partir la segunda hoja para meter «una pequeña inducción del
// portal» en la mitad de abajo.

describe('el carné de pie y la inducción', () => {
    const hoja2 = () => JSON.stringify(paginaDelCarne({
        nombre: 'Carlos Antonio Renderos Mejía', cargo: 'Dependiente de Farmacia',
        sala: 'Salud 3', fechaDeInicio: '2026-09-01',
        barrasPng: 'data:image/png;base64,AAAA', retratoPng: 'data:image/png;base64,BBBB',
        iconoPng: 'data:image/png;base64,CCCC',
    }));

    /* La tarjeta va de pie y no acostada, y la diferencia no es de gusto: con la
     * tarjeta parada el retrato entra a casi el doble de tamaño, que es lo que
     * hace reconocible a alguien desde el otro lado del mostrador. */
    it('la tarjeta es ID-1 DE PIE, no acostada', () => {
        const t = hoja2();
        // 53.98 × 85.6 mm en puntos: 153 de ancho, 242.6 de alto.
        expect(t).toMatch(/"w":153/);
        expect(t).toMatch(/"h":242\.6/);
    });

    /* Sin marcas hay que adivinar dónde termina la tarjeta —el borde impreso es
     * del mismo color que el papel de alrededor— y una recortada torcida no
     * entra en la funda. */
    it('lleva marcas de corte en las cuatro esquinas', () => {
        const lineas = (hoja2().match(/"type":"line"/g) || []).length;
        expect(lineas).toBeGreaterThanOrEqual(8);   // dos por esquina
    });

    it('la mitad de abajo es la inducción al portal', () => {
        const t = hoja2();
        expect(t).toMatch(/El portal, en cinco minutos/);
        expect(t).toMatch(/portal\.farmasalud\.lat/);
        expect(INDUCCION.length).toBeGreaterThanOrEqual(5);
        for (const b of INDUCCION) expect(b.titulo && b.texto).toBeTruthy();
    });

    // Lo que ve cada quien depende de su cargo: prometer un menú completo haría
    // que la primera ausencia se leyera como una falla del portal.
    it('avisa que lo que se ve depende del cargo', () => {
        expect(hoja2()).toMatch(/tu cargo todavía no lo tiene habilitado/);
    });
});

/* ── La hoja del carné es opcional ──────────────────────────────────────────
 *
 * La decide «Todavía no tiene carné» al dar de alta. Antes esa casilla mandaba
 * a imprimir un carné de papel en la ticketera y el documento SIEMPRE llevaba
 * su hoja de carné; el usuario lo corrigió el 2026-08-31.
 *
 * Se prueba por el salto de página y por el contenido, no sólo por uno de los
 * dos: un `pageBreak` sin carné sería una hoja en blanco —que se imprime
 * igual— y un carné sin salto saldría encima del texto de la primera. */
describe('la hoja del carné', () => {
    const base = {
        nombre: 'Ana María Pérez', cargo: 'Dependiente de Farmacia', sala: 'Salud 1',
        usuario: 'ana.perez', contrasenaTemporal: 'K7M2QX9P',
    };
    const saltos = (def) => (JSON.stringify(def.content).match(/"pageBreak":"before"/g) || []).length;

    it('va cuando se pide', () => {
        const def = definicionDelDocumento({ ...base, conCarne: true });
        expect(saltos(def)).toBe(1);
        expect(textoDe(def)).toContain('Dependiente de Farmacia');
        expect(textoDe(def)).toMatch(/El carné va en la página siguiente/);
    });

    it('NO va cuando no se pide, y ahí el documento es de una hoja', () => {
        const def = definicionDelDocumento({ ...base, conCarne: false });
        expect(saltos(def)).toBe(0);
        // Y el aviso deja de prometer una página que no existe.
        expect(textoDe(def)).not.toMatch(/El carné va en la página siguiente/);
    });

    it('por defecto va: quien no toca nada se lleva su carné', () => {
        expect(saltos(definicionDelDocumento(base))).toBe(1);
    });
});

/* ── Una recontratación no trae contraseña temporal ─────────────────────────
 *
 * Al ENLAZAR con una ficha que ya existe, la persona conserva la contraseña que
 * tenía. Hasta el 2026-08-31 el documento entero no se armaba en ese caso —la
 * guarda del modal era `if (created?.tempPassword)`— y la casilla marcada no
 * hacía nada: *«¿por qué no me guardó el documento de bienvenida?»*.
 *
 * El documento no es sólo la contraseña: lleva el carné, la inducción, lo
 * básico del reglamento y la orientación previsional. Quien vuelve lo necesita
 * igual. */
describe('sin contraseña temporal', () => {
    const base = {
        nombre: 'Edemir Quintanilla', cargo: 'Dependiente de Farmacia', sala: 'Salud 1',
        usuario: 'edemir.quintanilla',
    };

    it('se arma igual y lleva el usuario', () => {
        const t = textoDe(definicionDelDocumento(base));
        expect(t).toContain('edemir.quintanilla');
    });

    it('NO escribe una fila de contraseña vacía', () => {
        const t = textoDe(definicionDelDocumento(base));
        expect(t).not.toContain('Contraseña temporal');
    });

    it('dice que entra con la que ya tenía, en vez de la nota de la temporal', () => {
        const t = textoDe(definicionDelDocumento(base));
        expect(t).toMatch(/contraseña que ya tenías/);
        expect(t).not.toMatch(/sirve una sola vez/);
    });

    it('y con contraseña sí van las dos filas', () => {
        const t = textoDe(definicionDelDocumento({ ...base, contrasenaTemporal: 'K7M2QX9P' }));
        expect(t).toContain('Contraseña temporal');
        expect(t).toContain('K7M2QX9P');
        expect(t).toMatch(/sirve una sola vez/);
    });
});

/* ── El logo es el de SU farmacia ───────────────────────────────────────────
 *
 * «Según quién vea: si La Popular o La Salud (todos los demás)» (usuario,
 * 2026-08-31). La regla se escribió como una EXCEPCIÓN y no como un catálogo:
 * una sala nueva cae del lado correcto sin que nadie la agregue. */
describe('la marca de la sala', () => {
    it('sólo La Popular es La Popular', () => {
        expect(marcaDeLaSala('La Popular')).toBe('popular');
        expect(logoDeLaSala('La Popular')).toBe('/logo-la-popular.png');
    });

    it('todas las demás son La Salud, incluidas Bodega y Administración', () => {
        for (const s of ['Salud 1', 'Salud 2', 'Salud 3', 'Salud 4', 'Salud 5',
                         'Bodega', 'Administracion']) {
            expect(marcaDeLaSala(s), s).toBe('salud');
        }
        expect(logoDeLaSala('Salud 3')).toBe('/logo-la-salud.png');
    });

    // Una sala que todavía no existe tiene que caer en La Salud sin tocar código.
    it('una sala nueva cae en La Salud sin agregarla a ninguna lista', () => {
        expect(marcaDeLaSala('Salud 6')).toBe('salud');
        expect(marcaDeLaSala('Chalatenango Centro')).toBe('salud');
    });

    // Sin sala —o con una vacía— no se puede adivinar, y el resto es La Salud.
    it('sin sala, La Salud', () => {
        expect(marcaDeLaSala('')).toBe('salud');
        expect(marcaDeLaSala(null)).toBe('salud');
        expect(marcaDeLaSala(undefined)).toBe('salud');
    });
});

describe('el carné lleva el logo', () => {
    const base = {
        nombre: 'Ana María Pérez', cargo: 'Dependiente de Farmacia', sala: 'Salud 1',
        usuario: 'ana.perez', contrasenaTemporal: 'K7M2QX9P', conCarne: true,
    };
    const LOGO = 'data:image/png;base64,AAAA';

    /* Se mira SÓLO la hoja del carné, no el documento entero: «La Popular y La
       Salud» también está en el titular de la hoja 1 —«Bienvenido a Farmacias La
       Popular y La Salud»— y ése se queda, porque esa hoja le habla de la
       EMPRESA y no de su sala. La primera versión de esta prueba miraba todo y
       fallaba acusando a un texto que estaba bien. */
    const hojaDelCarne = (def) => {
        const c = def.content;
        const corte = c.findIndex(b => b?.pageBreak === 'before');
        return JSON.stringify(c.slice(corte));
    };

    it('cuando el logo cargó, va el logo y NO el texto de las dos farmacias', () => {
        const carne = hojaDelCarne(definicionDelDocumento({ ...base, logoPng: LOGO }));
        expect(carne).toContain(LOGO);
        expect(carne).not.toContain('La Popular y La Salud');
    });

    /* Si el logo no cargó vuelve lo de antes. Un carné sin marca sirve para
       entrar; uno que no se genera, no. */
    it('si no cargó, vuelve el icono con su texto', () => {
        const carne = hojaDelCarne(definicionDelDocumento({
            ...base, logoPng: null, iconoPng: 'data:image/png;base64,BBBB' }));
        expect(carne).toContain('La Popular y La Salud');
        expect(carne).toContain('data:image/png;base64,BBBB');
    });
});

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
import { definicionDelDocumento, orientacionPrevisional, nombreDelArchivo } from '../../src/utils/documentoDeBienvenida';

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

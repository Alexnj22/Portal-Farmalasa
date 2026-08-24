import { describe, it, expect } from 'vitest';
import { repararCorreo, correoValido } from '../../supabase/functions/_shared/erp-clientes.ts';

// El correo del receptor de un DTE, cuando Hacienda lo rechaza.
//
// **Esta prueba existe porque lo que decide este código es si a un cliente se le
// conserva o se le borra el correo de su ficha fiscal.** Un arreglo de más
// inventa un dato de contacto; uno de menos borra el correo bueno de alguien.
// Ninguno de los dos falla al correr: se descubren mirando la ficha después.
//
// El caso que la originó (2026-08-24): dos facturas de Salud 1 llevaban días
// rebotando con «Campo #/receptor/correo no cumple el formato requerido», y lo
// que tenían era **un espacio al final**. Los dos correos pasaban cualquier
// regex razonable — por eso la reparación se prueba por su EFECTO y no por si
// el resultado «parece válido».
describe('repararCorreo', () => {
    it('quita el espacio del final — el caso real que trabó dos facturas', () => {
        expect(repararCorreo('doradeahernandez@gmail.com ').valor)
            .toBe('doradeahernandez@gmail.com');
        expect(repararCorreo('JMGMPERSONAL28@GMAIL.COM ').valor)
            .toBe('JMGMPERSONAL28@GMAIL.COM');
    });

    it('quita también los espacios de ADENTRO, que es donde no se ven', () => {
        expect(repararCorreo('juan perez@gmail.com').valor).toBe('juanperez@gmail.com');
        expect(repararCorreo(' a@b.com ').valor).toBe('a@b.com');
    });

    it('corrige «.con» por «.com»', () => {
        expect(repararCorreo('juan@gmail.con').valor).toBe('juan@gmail.com');
        expect(repararCorreo('JUAN@GMAIL.CON').valor).toBe('JUAN@GMAIL.com');
    });

    // `.co` es Colombia y es un dominio real. Tratarlo como un «.com» mal
    // escrito le cambiaría el correo a alguien que lo tenía bien — y encima el
    // resultado pasaría la validación, así que nadie lo notaría.
    it('NO toca «.co»: es Colombia, no un «.com» a medias', () => {
        expect(repararCorreo('juan@empresa.co').valor).toBe('juan@empresa.co');
        expect(repararCorreo('juan@empresa.co').arreglos).toEqual([]);
    });

    it('la coma del dominio pasa a punto, y sólo ahí', () => {
        expect(repararCorreo('juan@gmail,com').valor).toBe('juan@gmail.com');
        // Una coma en el medio no se sabe qué quiso ser: se deja.
        expect(repararCorreo('juan,perez@gmail.com').valor).toBe('juan,perez@gmail.com');
    });

    it('quita la puntuación pegada al final', () => {
        expect(repararCorreo('juan@gmail.com.').valor).toBe('juan@gmail.com');
        expect(repararCorreo('juan@gmail.com;').valor).toBe('juan@gmail.com');
    });

    // El contrato del que depende la rama de decisión: sin arreglos, el correo
    // no es un error de tipeo y hay que decidir otra cosa —pedirlo o borrarlo—.
    // Si esto devolviera arreglos sobre un correo intacto, el circuito escribiría
    // el mismo valor y Hacienda daría el mismo rechazo, para siempre.
    it('un correo sin nada que arreglar vuelve igual y sin arreglos', () => {
        const r = repararCorreo('persona@dominio.com');
        expect(r.valor).toBe('persona@dominio.com');
        expect(r.arreglos).toEqual([]);
    });

    it('nunca inventa: lo que no tiene arreglo evidente sale como entró', () => {
        for (const malo of ['sin-arroba', '@sindominio', 'juan@', '']) {
            expect(repararCorreo(malo).valor).toBe(malo);
        }
    });

    it('no revienta con null ni undefined', () => {
        expect(repararCorreo(null).valor).toBe('');
        expect(repararCorreo(undefined).valor).toBe('');
    });
});

// `correoValido` NO decide si el correo de una ficha está bien — eso lo decide
// Hacienda. Sirve para saber si una REPARACIÓN produjo algo con forma antes de
// escribirlo. Lo prueba el caso real: los dos correos que Hacienda rechazó
// pasan esta función una vez sin el espacio, y aun así habían sido rechazados.
describe('correoValido', () => {
    it('acepta lo que tiene forma de correo, mayúsculas incluidas', () => {
        expect(correoValido('a@b.com')).toBe(true);
        expect(correoValido('JMGMPERSONAL28@GMAIL.COM')).toBe(true);
        expect(correoValido('juan.perez+etiqueta@sub.dominio.sv')).toBe(true);
    });

    // ⚠️ El espacio del FINAL lo tapa: la función hace `.trim()` antes de
    // comparar. O sea que sobre los dos correos reales que Hacienda rechazó,
    // `correoValido` decía **true**. Ésta es la prueba de por qué no puede
    // gobernar la decisión: si la rama del correo preguntara «¿es válido?» en
    // vez de «¿el rechazo lo dice?», las dos facturas seguirían trabadas hoy.
    it('el espacio del FINAL lo tapa — por eso no decide nada', () => {
        expect(correoValido('a@b.com ')).toBe(true);
    });

    it('rechaza lo que no tiene forma de correo', () => {
        expect(correoValido('a b@c.com')).toBe(false);  // el espacio de adentro sí
        expect(correoValido('sin-arroba')).toBe(false);
        expect(correoValido('@sindominio.com')).toBe(false);
        expect(correoValido('juan@sinpunto')).toBe(false);
        expect(correoValido(null)).toBe(false);
        expect(correoValido('')).toBe(false);
    });
});

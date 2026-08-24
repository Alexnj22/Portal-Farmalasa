// Las reglas de la ficha de cliente — lo que decide si Hacienda acepta un DTE.
//
// Se prueban porque su modo de falla es el PEOR posible: un dato faltante no
// rompe el guardado, rompe la factura **semanas después y en la caja**. Y porque
// casi todos sus números salen de haber contado datos reales, no de la teoría —
// si alguien los "corrige" de memoria, rechaza fichas que hoy facturan bien.
//
// Tres decisiones que estas pruebas anclan y que se pueden deshacer sin que nada
// falle:
//
//   · el prefijo **5** de móvil se habilitó el 29-oct-2025; una lista escrita de
//     memoria hace un par de años lo deja afuera;
//   · el NRC va de **4 a 8 dígitos** — contados sobre 115 NRC dentro de 60 DTE
//     sellados. Exigir 7, que es lo que uno escribiría de memoria, habría
//     bloqueado 8 fichas legítimas;
//   · el formato **sólo se le exige a lo que se toca**, para que 148 fichas
//     heredadas con teléfono de relleno no queden congeladas sin poder
//     arreglarles el correo.

import { describe, it, expect } from 'vitest';
import {
    esContribuyente, telefonoValido, duiValido, nitValido, nrcValido,
    correoValido, retencionValida, camposRequeridos, validarCliente,
} from '../../src/utils/clienteValidacion';

describe('teléfono', () => {
    it('cuenta DÍGITOS, no caracteres: el mismo número con o sin guiones vale', () => {
        for (const t of ['7538-5899', '75385899', '(503) 7538-5899', '+503 7538 5899'])
            expect(telefonoValido(t)).toBe(true);
    });

    it.each(['2', '5', '6', '7'])('acepta el prefijo %s', (p) => {
        expect(telefonoValido(`${p}5385899`)).toBe(true);
    });

    it('el 5 vale — se habilitó el 29-oct-2025', () => {
        // Ésta es la que caza el "arreglo" de memoria: quien recuerde sólo 2/6/7
        // rechazaría números móviles legítimos y nadie sabría por qué.
        expect(telefonoValido('5538-5899')).toBe(true);
    });

    it.each(['1538-5899', '3538-5899', '4538-5899', '8538-5899', '9000-0144'])(
        'rechaza el prefijo inexistente de %s', (t) => { expect(telefonoValido(t)).toBe(false); });

    it('rechaza el relleno que sí tenía ocho dígitos', () => {
        // 148 fichas portadas traen '1111-1111'. Pasaba la regla vieja porque
        // contaba largo y no prefijo.
        expect(telefonoValido('1111-1111')).toBe(false);
    });

    it('el largo tiene que ser exacto', () => {
        expect(telefonoValido('753858')).toBe(false);
        expect(telefonoValido('753858991')).toBe(false);
        expect(telefonoValido('503753858991')).toBe(false);
    });

    it('vacío pasa: eso lo juzgan los requeridos, no el formato', () => {
        expect(telefonoValido('')).toBe(true);
        expect(telefonoValido(null)).toBe(true);
    });
});

describe('NIT', () => {
    it('catorce dígitos siempre valen', () => {
        expect(nitValido('0614-123456-101-2')).toBe(true);
    });

    it('el de nueve se compara CONTRA EL DUI de la misma ficha', () => {
        // Si es el DUI, tiene que ser EL DUI. Así un dígito mal tecleado se
        // detecta aunque por casualidad pase el verificador. Comprobado sobre
        // las 18 fichas portadas que tienen ambos: coinciden las 18.
        expect(nitValido('04413277-6', '04413277-6')).toBe(true);
        expect(nitValido('04413277-6', '12345678-4')).toBe(false);
    });

    it('sin DUI en la ficha cae al verificador, que es lo mejor disponible', () => {
        expect(nitValido('04413277-6', '')).toBe(true);
        expect(nitValido('04413277-5', '')).toBe(false);
    });

    it('cualquier otro largo se rechaza', () => {
        expect(nitValido('12345')).toBe(false);
        expect(nitValido('0614123456101')).toBe(false);   // 13
    });
});

describe('NRC — el rango salió de contar, no de la documentación', () => {
    it.each([4, 5, 6, 7, 8])('acepta %s dígitos', (n) => {
        expect(nrcValido('1'.repeat(n))).toBe(true);
    });

    it('rechaza 3 y 9', () => {
        // El piso de 4 atrapa el typo real: un DUI de 9 dígitos escrito en el
        // campo del NRC.
        expect(nrcValido('123')).toBe(false);
        expect(nrcValido('044132776')).toBe(false);
    });

    it('el tope es 8 aunque en los DTE reales no se vio ninguno — el error caro es el falso negativo', () => {
        expect(nrcValido('01234567')).toBe(true);
    });
});

describe('correo y retención', () => {
    it('el correo es deliberadamente permisivo: un TLD raro es válido', () => {
        expect(correoValido('a@b.sv')).toBe(true);
        expect(correoValido('nombre.apellido+etiqueta@sub.dominio.com.sv')).toBe(true);
    });

    it.each(['sinarroba.com', 'a@b', 'a@b.c', 'con espacio@b.com', 'a@@b.com'])(
        'rechaza «%s»', (c) => { expect(correoValido(c)).toBe(false); });

    it('la retención es un entero de 0 a 100', () => {
        expect(retencionValida('1')).toBe(true);
        expect(retencionValida('100')).toBe(true);
        expect(retencionValida('101')).toBe(false);
        expect(retencionValida('1.5')).toBe(false);
        expect(retencionValida('-1')).toBe(false);
        expect(retencionValida('')).toBe(true);
    });
});

describe('qué se le exige a cada categoría', () => {
    it('al contribuyente se le pide más, porque su documento es un CCF', () => {
        const base = camposRequeridos('Consumidor Final');
        const fiscal = camposRequeridos('Contribuyente');
        expect(base).toEqual(['name', 'phone', 'departamento', 'municipio', 'distrito']);
        expect(fiscal).toEqual(expect.arrayContaining([...base, 'nit', 'nrc', 'giro', 'email', 'direccion']));
    });

    it.each(['Contribuyente', 'Gran Contribuyente', 'Contribuyente Exento'])(
        '«%s» cuenta como contribuyente', (c) => { expect(esContribuyente(c)).toBe(true); });

    it('una categoría desconocida NO se trata como contribuyente', () => {
        // Falla hacia el lado seguro: se le piden menos campos, no más. Pedirle
        // de más a una categoría que nadie decidió bloquearía fichas al azar.
        expect(esContribuyente('Extranjero')).toBe(false);
        expect(esContribuyente(null)).toBe(false);
    });
});

describe('validarCliente — el formato sólo se le exige a lo que se toca', () => {
    const heredada = { name: 'Ficha vieja', phone: '1111-1111', departamento: 'San Salvador',
                       municipio: 'San Salvador', distrito: 'San Salvador', email: 'viejo@x.sv' };

    it('una ficha heredada con teléfono de relleno se puede editar en otro campo', () => {
        // Es la decisión que evita 148 callejones sin salida: si el formato se
        // exigiera siempre, nadie podría arreglarle el correo a esas fichas.
        const r = validarCliente({ ...heredada, email: 'nuevo@x.sv' }, heredada);
        expect(r.errores.phone).toBeUndefined();
        expect(r.ok).toBe(true);
    });

    it('pero si se TOCA el teléfono malo, ahí sí se marca', () => {
        const r = validarCliente({ ...heredada, phone: '1111-1112' }, heredada);
        expect(r.errores.phone).toBeTruthy();
        expect(r.ok).toBe(false);
    });

    it('una ficha NUEVA se valida entera', () => {
        // Sin `original` no hay nada heredado que respetar.
        const r = validarCliente({ ...heredada });
        expect(r.errores.phone).toBeTruthy();
    });

    it('los REQUERIDOS se exigen siempre, tocados o no', () => {
        // La asimetría es deliberada: un campo vacío se puede llenar ahí mismo
        // —el distrito es un desplegable— así que bloquear es accionable. Un DUI
        // heredado y malo no se deduce de nada.
        const sinDistrito = { ...heredada, distrito: '' };
        const r = validarCliente(sinDistrito, sinDistrito);
        expect(r.faltan).toContain('distrito');
        expect(r.ok).toBe(false);
    });

    it('un contribuyente incompleto lista TODO lo que le falta, no sólo lo primero', () => {
        const r = validarCliente({ name: 'ACME', phone: '2538-5899', categoria: 'Contribuyente',
                                   departamento: 'San Salvador', municipio: 'San Salvador', distrito: 'San Salvador' });
        expect(r.faltan).toEqual(expect.arrayContaining(['nit', 'nrc', 'giro', 'email', 'direccion']));
        expect(r.ok).toBe(false);
    });

    it('una ficha completa y bien escrita pasa', () => {
        const r = validarCliente({
            name: 'ACME S.A. de C.V.', phone: '2538-5899', categoria: 'Contribuyente',
            departamento: 'San Salvador', municipio: 'San Salvador', distrito: 'San Salvador',
            nit: '0614-123456-101-2', nrc: '123456', giro: 'Comercio',
            email: 'facturacion@acme.sv', direccion: 'Av. Siempre Viva 742',
        });
        expect(r.errores).toEqual({});
        expect(r.faltan).toEqual([]);
        expect(r.ok).toBe(true);
    });

    it('un formulario vacío no rompe', () => {
        expect(() => validarCliente(null)).not.toThrow();
        expect(validarCliente(undefined).ok).toBe(false);
    });
});

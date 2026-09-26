// @vitest-environment node
import { describe, it, expect } from 'vitest';
import Ajv from 'ajv';
import { dec, num, mul, div, aCentavos, fijo } from '../../supabase/functions/_shared/dte/decimal.ts';
import { calcularRenglon, calcularResumen } from '../../supabase/functions/_shared/dte/calculos.ts';
import {
    armarFactura, armarCreditoFiscal, armarNotaRemision, armarNotaCredito, armarNotaDebito,
} from '../../supabase/functions/_shared/dte/documentos.ts';
import { numeroControl, fechaHoraSV } from '../../supabase/functions/_shared/dte/identificacion.ts';
import { totalEnLetras } from '../../supabase/functions/_shared/dte/letras.ts';
import {
    leerCertificadoMH, claveCoincide, importarLlavePrivada, firmarDte, verificarFirma,
} from '../../supabase/functions/_shared/dte/firma.ts';
import reales from '../fixtures/dte-reales-2026-09.json';
import esqFactura from '../../supabase/functions/_shared/dte/esquemas/fe-f-v2.json';
import esqCcf from '../../supabase/functions/_shared/dte/esquemas/fe-ccf-v4.json';
import esqNr from '../../supabase/functions/_shared/dte/esquemas/fe-nr-v4.json';
import esqNc from '../../supabase/functions/_shared/dte/esquemas/fe-nc-v4.json';
import esqNd from '../../supabase/functions/_shared/dte/esquemas/fe-nd-v4.json';

// El motor de DTE de la S.A.S. de rutas.
//
// **Los jueces de estas pruebas no son este repo.** Son dos cosas que vienen de
// afuera y que el código no puede acomodar a su favor:
//
//   1. los esquemas JSON OFICIALES de Hacienda (factura.gob.sv, ZIP de julio
//      2026), copiados tal cual en `_shared/dte/esquemas/`;
//   2. 28 DTE REALES que Hacienda ya selló — 24 Créditos Fiscales de las
//      droguerías que le venden a la cadena y 4 Facturas —, reducidos a sus
//      números (sin nombres ni NIT) en `tests/fixtures/dte-reales-2026-09.json`.
//
// Si una fórmula de `calculos.ts` está mal, (2) lo dice con el número que
// Hacienda aceptó. Si una clave sobra o falta, (1) lo dice antes de gastar una
// de las pruebas de certificación.

const ajv = new Ajv({ allErrors: true, multipleOfPrecision: 8 });
const validar = (esquema, json) => {
    const v = ajv.compile(esquema);
    const ok = v(json);
    return ok ? [] : v.errors.map(e => `${e.dataPath} ${e.message} ${JSON.stringify(e.params)}`);
};

describe('decimal: la regla de redondeo del Manual Funcional §XXI', () => {
    it('cuerpo a 8 decimales: la novena ≥5 sube la octava (ejemplo del manual)', () => {
        expect(num(dec('1.87654321987654'))).toBe(1.87654322);
        expect(num(dec('3.55555555400000'))).toBe(3.55555555);
        expect(num(dec('5.67215366775307'))).toBe(5.67215367);
    });
    it('resumen a 2 decimales: 5.664 → 5.66, 5.665 → 5.67, 5.666 → 5.67', () => {
        expect(num(aCentavos(dec('5.664')))).toBe(5.66);
        expect(num(aCentavos(dec('5.665')))).toBe(5.67);
        expect(num(aCentavos(dec('5.666')))).toBe(5.67);
    });
    it('no hereda el error del doble: 2.675 redondea a 2.68 (toFixed da 2.67)', () => {
        expect((2.675).toFixed(2)).toBe('2.67');
        expect(fijo(dec(2.675), 2)).toBe('2.68');
    });
    it('0.1 + 0.2 es 0.3 exacto', () => {
        expect(num(dec(0.1) + dec(0.2))).toBe(0.3);
    });
    it('multiplica y divide redondeando a 8', () => {
        expect(num(mul(dec(30), dec('4.08774')))).toBe(122.6322);
        expect(num(div(dec(1), dec(3)))).toBe(0.33333333);
        expect(num(div(dec(2), dec(3)))).toBe(0.66666667);
    });
    it('rechaza lo que no es un número en vez de volverlo cero', () => {
        expect(() => dec('')).toThrow();
        expect(() => dec('12,5')).toThrow();
        expect(() => dec(NaN)).toThrow();
    });
});

// Arma los renglones del motor con los valores de cuerpo QUE HACIENDA ACEPTÓ.
// Las droguerías redondean `ventaGravada` a 2 decimales en el renglón; lo que
// se prueba acá son las fórmulas del RESUMEN sobre esos renglones.
const renglonesDe = (doc, base) => doc.renglones.map(r => ({
    cantidad: dec(r.cantidad), precioUni: dec(r.precioUni), montoDescu: dec(r.montoDescu),
    ventaNoSuj: dec(r.ventaNoSuj), ventaExenta: dec(r.ventaExenta), ventaGravada: dec(r.ventaGravada),
    iva: base === 'con_iva' ? dec(r.ivaItem) : mul(dec(r.ventaGravada), dec('0.13')),
}));

describe('el resumen contra DTE reales sellados por Hacienda', () => {
    const ccf = reales.filter(d => d.tipo === '03');
    const fe = reales.filter(d => d.tipo === '01');

    it('hay casos de los dos tipos, y con y sin percepción', () => {
        expect(ccf.length).toBe(24);
        expect(fe.length).toBe(4);
        expect(ccf.filter(d => d.resumen.ivaPerci > 0).length).toBe(9);
    });

    // La holgura oficial es ±0.01 en el resumen (Manual §XXI), y algunos
    // proveedores la usan: TRUNCAN donde el manual manda subir en 5 (32.35 ×
    // 0.13 = 4.2055 → escriben 4.20, el manual dice 4.21). Hacienda les aceptó
    // las dos cosas. Por eso cada caso se juzga con la holgura, y aparte se
    // cuenta cuántos cuadran EXACTO — si ese número baja, cambió una fórmula.
    const HOLGURA = 0.01 + 1e-9;
    const cerca = (a, b) => Math.abs(a - b) <= HOLGURA;
    const exactos = [];

    it.each(ccf.map((d, i) => [i, d]))('CCF real #%i: IVA, percepción, monto y total dentro de la holgura', (i, d) => {
        const res = calcularResumen(renglonesDe(d, 'sin_iva'), 'sin_iva', { percibe1: d.resumen.ivaPerci > 0 });
        const par = [
            [num(res.totalGravada), d.resumen.totalGravada],
            [num(res.subTotal), d.resumen.subTotal],
            [num(res.iva), Number(d.resumen.iva.toFixed(2))],
            [num(res.ivaPerci), d.resumen.ivaPerci],
            [num(res.montoTotalOperacion), d.resumen.montoTotalOperacion],
            [num(res.totalPagar), d.resumen.totalPagar],
        ];
        for (const [nuestro, suyo] of par) expect(cerca(nuestro, suyo)).toBe(true);
        if (par.every(([a, b]) => a === b)) exactos.push(i);
    });

    it('21 de los 24 CCF cuadran al centavo exacto (los otros 3 son truncamientos del proveedor)', () => {
        expect(exactos.length).toBe(21);
    });

    it('la percepción sale sola cuando la base llega a $100 y no antes', () => {
        // Todos los CCF sin percepción de un proveedor que percibe están bajo
        // $100 o son de proveedores que no perciben: el umbral es de ley.
        const conPerci = ccf.filter(d => d.resumen.ivaPerci > 0);
        expect(conPerci.every(d => d.resumen.subTotal >= 100)).toBe(true);
    });

    it.each(fe.map((d, i) => [i, d]))('Factura real #%i: IVA por renglón y del documento', (_i, d) => {
        for (const r of d.renglones) {
            const c = calcularRenglon(
                { cantidad: r.cantidad, precio: r.precioUni, precioIncluyeIva: true, descuento: r.montoDescu },
                'con_iva');
            expect(Math.abs(num(c.ventaGravada) - r.ventaGravada)).toBeLessThanOrEqual(0.01);
            // El IVA contenido, recalculado sobre la venta que Hacienda aceptó.
            const iva = div(mul(dec(r.ventaGravada), dec('0.13')), dec('1.13'));
            expect(Math.abs(num(iva) - r.ivaItem)).toBeLessThanOrEqual(1e-6);
        }
        const res = calcularResumen(renglonesDe(d, 'con_iva'), 'con_iva');
        expect(Math.abs(num(res.iva) - d.resumen.iva)).toBeLessThanOrEqual(0.01 + 1e-9);
        expect(num(res.totalPagar)).toBe(d.resumen.totalPagar);
    });
});

// ── Datos de prueba de la S.A.S. (ficticios) ──────────────────────────────
const DIR = { departamento: '04', municipio: '36', distrito: '07', complemento: 'Barrio El Centro, Chalatenango' };
const EMISOR = {
    nit: '0407-010126-101-5', nrc: '345678-9', nombre: 'DISTRIBUIDORA DE PRUEBA, S.A.S.',
    codActividad: '46491', descActividad: 'Venta al por mayor de productos farmacéuticos y medicinales',
    nombreComercial: 'RUTA PRUEBA', direccion: DIR, telefono: '23010013', correo: 'facturas@ejemplo.com',
    establecimiento: 'B001', puntoVenta: 'P001',
};
const TIENDA = {
    tipoDocumento: '13', numDocumento: '01234567-8', nrc: null, nombre: 'TIENDA LA ESQUINA',
    codActividad: null, descActividad: null, direccion: DIR, telefono: '77778888', correo: null,
};
const FARMACIA = {
    tipoDocumento: '36', numDocumento: '0407-150390-102-3', nrc: '123456-7', nombre: 'FARMACIA DEL PUEBLO, S.A. DE C.V.',
    codActividad: '47721', descActividad: 'Venta al por menor de productos farmacéuticos', nombreComercial: null,
    direccion: DIR, telefono: '24445555', correo: 'compras@farmaciadelpueblo.com',
};
const AHORA = new Date('2026-09-26T16:30:00Z'); // 10:30 a. m. en El Salvador
const CODIGO = 'A1B2C3D4-E5F6-4789-8ABC-DEF012345678';
const renglones = [
    { codigo: 'ACET500', descripcion: 'ACETAMINOFÉN 500 MG X 100 TAB', cantidad: 12, precio: '1.95', precioIncluyeIva: false },
    { codigo: 'SUERO01', descripcion: 'SUERO ORAL 500 ML', cantidad: 24, precio: '0.62', precioIncluyeIva: false, descuento: '0.96' },
];

describe('los documentos armados cumplen el esquema OFICIAL', () => {
    it('Factura v2 a una tienda, de contado', () => {
        const f = armarFactura({
            ambiente: '00', emisor: EMISOR, correlativo: 1, receptor: TIENDA, renglones,
            condicion: 1, pagos: [{ codigo: '01', monto: '42.17' }], ahora: AHORA, codigoGeneracion: CODIGO,
        });
        expect(validar(esqFactura, f.json)).toEqual([]);
        expect(f.numeroControl).toBe('DTE-01-B001P001-000000000000001');
        // Precio sin IVA 1.95 → con IVA 2.2035: 12 × 2.2035 = 26.442
        expect(f.json.cuerpoDocumento[0].precioUni).toBe(2.2035);
        expect(f.json.cuerpoDocumento[0].ventaGravada).toBe(26.442);
        expect(f.json.resumen.totalPagar).toBe(42.17);
        expect(f.json.resumen.totalLetras).toBe('CUARENTA Y DOS 17/100 DÓLARES');
    });

    it('Factura sin receptor (consumidor final anónimo)', () => {
        const f = armarFactura({
            ambiente: '00', emisor: EMISOR, correlativo: 2, receptor: null,
            renglones: [{ codigo: null, descripcion: 'SUERO ORAL', cantidad: 1, precio: '0.70', precioIncluyeIva: true }],
            condicion: 1, pagos: [{ codigo: '01', monto: '0.70' }], ahora: AHORA,
        });
        expect(validar(esqFactura, f.json)).toEqual([]);
        expect(f.json.resumen.totalIva).toBe(0.08);
    });

    it('Crédito Fiscal v4 a una farmacia, a crédito 30 días', () => {
        const c = armarCreditoFiscal({
            ambiente: '00', emisor: EMISOR, correlativo: 7, receptor: FARMACIA, renglones,
            condicion: 2, pagos: [{ codigo: '13', monto: '42.17', plazo: '01', periodo: 30 }], ahora: AHORA,
        });
        expect(validar(esqCcf, c.json)).toEqual([]);
        const r = c.json.resumen;
        // 12 × 1.95 = 23.40 ; 24 × 0.62 − 0.96 = 13.92 ; gravada 37.32
        expect(r.totalGravada).toBe(37.32);
        expect(r.tributos).toEqual([{ codigo: '20', descripcion: 'Impuesto al Valor Agregado 13%', valor: 4.85 }]);
        expect(r.totalPagar).toBe(42.17);
        expect(c.json.receptor.nit).toBe('04071503901023');
        expect(c.json.receptor.nrc).toBe('1234567');
    });

    it('Crédito Fiscal a un supermercado que retiene el 1%', () => {
        const c = armarCreditoFiscal({
            ambiente: '00', emisor: EMISOR, correlativo: 8, receptor: FARMACIA,
            renglones: [{ codigo: 'X', descripcion: 'CAJA SUERO ORAL X 24', cantidad: 10, precio: '14.88', precioIncluyeIva: false }],
            opciones: { retiene1: true }, condicion: 1, pagos: [{ codigo: '05', monto: '166.65', referencia: 'TRF-001' }], ahora: AHORA,
        });
        expect(validar(esqCcf, c.json)).toEqual([]);
        // 148.80 + IVA 19.34 = 168.14 − retención 1.49 = 166.65
        expect(c.json.resumen.ivaRete).toBe(1.49);
        expect(c.json.resumen.totalPagar).toBe(166.65);
    });

    it('Nota de Remisión v4: la carga del camión, a título de traslado', () => {
        const n = armarNotaRemision({
            ambiente: '00', emisor: EMISOR, correlativo: 3, bienTitulo: '04',
            receptor: { ...FARMACIA, tipoDocumento: '36', numDocumento: EMISOR.nit, nombre: EMISOR.nombre, nrc: EMISOR.nrc },
            renglones, ahora: AHORA, observaciones: 'Carga de ruta 1, vehículo P-123456',
        });
        expect(validar(esqNr, n.json)).toEqual([]);
        expect(n.json.resumen.montoTotalOperacion).toBe(42.17);
    });

    const relacionado = { tipoDocumento: '03', numeroDocumento: CODIGO, fechaEmision: '2026-09-20' };
    const devolucion = [{ ...renglones[1], cantidad: 2, descuento: 0, numeroDocumento: CODIGO, descripcion: 'SUERO ORAL 500 ML (vencido)' }];

    it('Nota de Crédito v4: devolución de vencidos contra un CCF', () => {
        const n = armarNotaCredito({
            ambiente: '00', emisor: EMISOR, correlativo: 1, receptor: FARMACIA, condicion: 1,
            documentoRelacionado: [relacionado], renglones: devolucion, ahora: AHORA,
        });
        expect(validar(esqNc, n.json)).toEqual([]);
        expect(n.json.resumen.totalIva).toBe(0.16);
        expect(n.json.resumen.totalPagar).toBe(1.4);
    });

    it('Nota de Crédito con percepción: aplica el 1% aunque la nota sea chica', () => {
        const n = armarNotaCredito({
            ambiente: '00', emisor: EMISOR, correlativo: 2, receptor: FARMACIA, condicion: 1,
            documentoRelacionado: [relacionado], renglones: devolucion, opciones: { percibe1: true }, ahora: AHORA,
        });
        expect(validar(esqNc, n.json)).toEqual([]);
        expect(n.json.resumen.ivaPerci).toBe(0.01);
    });

    it('Nota de Débito v4', () => {
        const n = armarNotaDebito({
            ambiente: '00', emisor: EMISOR, correlativo: 1, receptor: FARMACIA, condicion: 1,
            documentoRelacionado: [relacionado], renglones: devolucion, ahora: AHORA,
        });
        expect(validar(esqNd, n.json)).toEqual([]);
    });
});

describe('lo que el motor se niega a emitir', () => {
    const base = { ambiente: '00', emisor: EMISOR, correlativo: 1, renglones, ahora: AHORA };
    it('un CCF a quien no tiene NRC', () => {
        expect(() => armarCreditoFiscal({ ...base, receptor: TIENDA, condicion: 1, pagos: [{ codigo: '01', monto: '42.17' }] }))
            .toThrow(/NRC/);
    });
    it('pagos que no suman el total', () => {
        expect(() => armarFactura({ ...base, receptor: null, condicion: 1, pagos: [{ codigo: '01', monto: '40.00' }] }))
            .toThrow(/pagos suman/);
    });
    it('una venta a crédito sin plazo', () => {
        expect(() => armarCreditoFiscal({ ...base, receptor: FARMACIA, condicion: 2, pagos: [{ codigo: '13', monto: '42.17' }] }))
            .toThrow(/plazo/);
    });
    it('una nota con un renglón que no dice qué documento corrige', () => {
        expect(() => armarNotaCredito({
            ...base, receptor: FARMACIA, condicion: 1,
            documentoRelacionado: [{ tipoDocumento: '03', numeroDocumento: CODIGO, fechaEmision: '2026-09-20' }],
        })).toThrow(/no dice a cuál/);
    });
    it('un descuento mayor que el renglón', () => {
        expect(() => calcularRenglon({ cantidad: 1, precio: 1, precioIncluyeIva: false, descuento: 2 }, 'sin_iva')).toThrow();
    });
    it('una contingencia «otro» sin motivo', () => {
        expect(() => armarFactura({
            ...base, receptor: null, condicion: 1, pagos: [{ codigo: '01', monto: '42.17' }], contingencia: { tipo: 5 },
        })).toThrow(/motivo/);
    });
});

describe('identificación', () => {
    it('número de control de 31 caracteres', () => {
        const n = numeroControl('03', 'M001', 'P025', 1);
        expect(n).toBe('DTE-03-M001P025-000000000000001');
        expect(n.length).toBe(31);
        expect(() => numeroControl('03', '0001', 'P001', 1)).toThrow();
        expect(() => numeroControl('03', 'M001', 'P001', 0)).toThrow();
    });
    it('la fecha es la de El Salvador: 11 p. m. del 26 sigue siendo el 26', () => {
        expect(fechaHoraSV(new Date('2026-09-27T05:00:00Z'))).toEqual({ fecEmi: '2026-09-26', horEmi: '23:00:00' });
        expect(fechaHoraSV(new Date('2026-09-27T06:00:00Z'))).toEqual({ fecEmi: '2026-09-27', horEmi: '00:00:00' });
    });
    it('contingencia pasa el documento a modelo diferido', () => {
        const f = armarFactura({
            ambiente: '00', emisor: EMISOR, correlativo: 1, receptor: null, renglones, ahora: AHORA,
            condicion: 1, pagos: [{ codigo: '01', monto: '42.17' }], contingencia: { tipo: 3 },
        });
        expect(f.json.identificacion).toMatchObject({ tipoModelo: 2, tipoOperacion: 2, tipoContingencia: 3, motivoContin: null });
        expect(validar(esqFactura, f.json)).toEqual([]);
    });
});

describe('valor en letras', () => {
    it.each([
        [100n, 'UN 00/100 DÓLAR'],
        [4217n, 'CUARENTA Y DOS 17/100 DÓLARES'],
        [10000n, 'CIEN 00/100 DÓLARES'],
        [12150n, 'CIENTO VEINTIÚN 50/100 DÓLARES'],
        [10150n, 'CIENTO UN 50/100 DÓLARES'],
        [2100000n, 'VEINTIÚN MIL 00/100 DÓLARES'],
        [100000000n, 'UN MILLÓN 00/100 DÓLARES'],
        [45n, 'CERO 45/100 DÓLARES'],
    ])('%s centavos → %s', (c, t) => {
        expect(totalEnLetras(c)).toBe(t);
    });
});

describe('firma: la misma que el firmador oficial (JWS RS512)', () => {
    const b64 = (buf) => Buffer.from(buf).toString('base64');
    const certificadoDePrueba = async (clave) => {
        const par = await crypto.subtle.generateKey(
            { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-512' },
            true, ['sign', 'verify']);
        const priv = await crypto.subtle.exportKey('pkcs8', par.privateKey);
        const pub = await crypto.subtle.exportKey('spki', par.publicKey);
        const hash = Buffer.from(await crypto.subtle.digest('SHA-512', new TextEncoder().encode(clave))).toString('hex');
        return `<CertificadoMH><nit>04070101261015</nit><publicKey><keyType>PUBLIC</keyType><algorithm>RSA</algorithm><encodied>${b64(pub)}</encodied><format>X.509</format><clave>${hash}</clave></publicKey><privateKey><keyType>PRIVATE</keyType><algorithm>RSA</algorithm><encodied>${b64(priv)}</encodied><format>PKCS#8</format><clave>${hash}</clave></privateKey><activo>true</activo></CertificadoMH>`;
    };

    it('lee el .crt, reconoce la contraseña y firma un DTE que se verifica', async () => {
        const xml = await certificadoDePrueba('Clave-Privada-1');
        const cert = leerCertificadoMH(xml);
        expect(cert.nit).toBe('04070101261015');
        expect(await claveCoincide(cert, 'Clave-Privada-1')).toBe(true);
        expect(await claveCoincide(cert, 'otra')).toBe(false);

        const f = armarFactura({
            ambiente: '00', emisor: EMISOR, correlativo: 1, receptor: null, renglones, ahora: AHORA,
            condicion: 1, pagos: [{ codigo: '01', monto: '42.17' }],
        });
        const jws = await firmarDte(f.json, await importarLlavePrivada(cert.llavePrivadaPkcs8));
        const [h] = jws.split('.');
        expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'RS512' });
        expect(await verificarFirma(jws, cert.llavePublicaSpki)).toEqual(f.json);
    });

    it('una firma alterada no verifica', async () => {
        const cert = leerCertificadoMH(await certificadoDePrueba('x'));
        const jws = await firmarDte({ a: 1 }, await importarLlavePrivada(cert.llavePrivadaPkcs8));
        const [h, , s] = jws.split('.');
        const otra = Buffer.from(JSON.stringify({ a: 2 })).toString('base64url');
        await expect(verificarFirma(`${h}.${otra}.${s}`, cert.llavePublicaSpki)).rejects.toThrow(/no corresponde/);
    });

    it('un certificado sin llave privada se rechaza al leerlo', () => {
        expect(() => leerCertificadoMH('<CertificadoMH><nit>1</nit></CertificadoMH>')).toThrow(/llave privada/);
    });
});

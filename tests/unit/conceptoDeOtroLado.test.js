import { describe, it, expect } from 'vitest';
import { vaEnOtroLado, detalleSuficiente, textoComparable } from '@nucleo/utils/conceptoDeOtroLado';

// Un extracto de `caja_conceptos_de_otro_lado` tal como está en la base.
const LISTA = [
    { sentido: 'ENTRADA', orden: 30, patron: 'mapfre|asegurad', va_en: 'anótalo en «Pago de asegurado Mapfre»' },
    { sentido: 'ENTRADA', orden: 40, patron: '(^|[^a-z])(anticip|adelant|encarg|apart|reserv|abono (de|para|del|por) |mayoreo|cancelacion|se solicito|pedido)', va_en: 'anótalo en «Apartar o encargar»' },
    { sentido: 'SALIDA', orden: 10, patron: '(^|[^a-z])(por error|correcc|corregi|ajuste|se (ingreso|realizo|hizo) (como )?entrada|era remesa|anotad[oa] (mal|al reves))', va_en: 'si es para arreglar un movimiento que quedó mal, ábrelo en la lista del día y usa «Corregir»' },
    { sentido: 'SALIDA', orden: 70, patron: 'proveedor|(^|[^a-z])(pepsi|dizasa|distribuidora|drogueria|laboratorio)', va_en: 'anótalo en «Pago a proveedor»' },
    { sentido: 'SALIDA', orden: 80, patron: '(^|[^a-z])(agua|almuerzo|cena|impuesto)', va_en: 'anótalo en «Gasto o compra urgente»' },
];

describe('vaEnOtroLado', () => {
    it('manda los casos reales a su tipo', () => {
        expect(vaEnOtroLado(LISTA, 'ENTRADA', 'Otro · Adelanto de Neurontin 300')).toMatch(/Apartar o encargar/);
        expect(vaEnOtroLado(LISTA, 'ENTRADA', 'Otro · Pago de asegurado MAPFRE')).toMatch(/Mapfre/);
        expect(vaEnOtroLado(LISTA, 'SALIDA', 'Otro · Por error se ingresó como entrada una remesa')).toMatch(/Corregir/);
        expect(vaEnOtroLado(LISTA, 'SALIDA', 'Otro · pago de Pepsi')).toMatch(/Pago a proveedor/);
        expect(vaEnOtroLado(LISTA, 'SALIDA', 'Otro · compra de agua para personal')).toMatch(/Gasto/);
    });

    it('respeta el sentido', () => {
        expect(vaEnOtroLado(LISTA, 'SALIDA', 'Otro · asegurado mapfre')).toBeNull();
    });

    it('deja pasar lo que de verdad es «Otro»', () => {
        expect(vaEnOtroLado(LISTA, 'SALIDA', 'Otro · ofrenda autorizada por don Rutilio')).toBeNull();
    });

    it('no confunde una palabra dentro de otra', () => {
        // «paguayaba» no es «agua»: el borde es una letra, no un espacio.
        expect(vaEnOtroLado(LISTA, 'SALIDA', 'Otro · paguayaba de regalo')).toBeNull();
    });

    it('sin lista no avisa nada (el servidor frena igual)', () => {
        expect(vaEnOtroLado([], 'SALIDA', 'Otro · pago de Pepsi')).toBeNull();
        expect(vaEnOtroLado(null, 'SALIDA', 'Otro · pago de Pepsi')).toBeNull();
    });

    it('un patrón roto no tumba la pantalla', () => {
        expect(vaEnOtroLado([{ sentido: 'SALIDA', patron: '(', va_en: 'x' }], 'SALIDA', 'Otro · algo')).toBeNull();
    });
});

describe('detalleSuficiente', () => {
    it('pide al menos diez letras sin contar el rótulo', () => {
        expect(detalleSuficiente('Otro · agua')).toBe(false);
        expect(detalleSuficiente('Otro')).toBe(false);
        expect(detalleSuficiente('Otro · ofrenda autorizada')).toBe(true);
    });
});

describe('textoComparable', () => {
    it('quita tildes y mayúsculas', () => {
        expect(textoComparable('Corrección ÁÑ')).toBe('correccion an');
    });
});

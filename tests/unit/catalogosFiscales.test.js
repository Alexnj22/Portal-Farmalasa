// Los catálogos del anexo F-07 y el catálogo de tipos de DTE.
//
// Son listas, y una lista parece no necesitar prueba. Estas sí, por dos motivos
// que no se ven leyéndolas:
//
//   · **sus códigos son los que un CHECK de `proveedores_maestro` hace
//     cumplir.** Si un valor cambia acá y no allá, el formulario ofrece una
//     opción que el servidor rechaza — y el rechazo llega al guardar, no al
//     elegir;
//   · **la matriz Costo/Gasto de la página 21 del manual** decide qué tipos se
//     ofrecen. Ofrecer uno de la otra clase es exactamente el callejón de
//     arriba.

import { describe, it, expect } from 'vitest';
import {
    CLASIFICACION_OPTIONS, SECTOR_OPTIONS, TIPO_CG_TODOS, DEDUCIBLE_OPTIONS,
    ESTADO_CLASIF, tiposCostoGasto, clasificacionLabel, sectorLabel,
    tipoCostoGastoLabel, fmtMoneda,
} from '../../src/utils/f07Catalogos';
import { DTE_TYPE_LABELS, dteTypeLabel, dteAdmiteProveedor } from '../../src/utils/dteTypes';

describe('la matriz Costo/Gasto del manual', () => {
    it('con Costo sólo los tipos 4 a 7; con Gasto sólo 1 a 3', () => {
        expect(tiposCostoGasto('1').map(t => t.value)).toEqual(['4', '5', '6', '7']);
        expect(tiposCostoGasto('2').map(t => t.value)).toEqual(['1', '2', '3']);
    });

    it('acepta el número además de la cadena', () => {
        // El `value` del desplegable es texto pero el estado a veces trae número.
        expect(tiposCostoGasto(1).map(t => t.value)).toEqual(['4', '5', '6', '7']);
    });

    it('sin clasificación se ofrecen todos', () => {
        expect(tiposCostoGasto(null)).toHaveLength(TIPO_CG_TODOS.length);
        expect(tiposCostoGasto('')).toHaveLength(TIPO_CG_TODOS.length);
    });

    it('los siete tipos están repartidos y ninguno queda sin clase', () => {
        // Un tipo sin `clase` desaparecería de las DOS listas y nadie podría
        // elegirlo nunca — se ve sólo contando.
        expect(TIPO_CG_TODOS).toHaveLength(7);
        expect(TIPO_CG_TODOS.every(t => t.clase === 1 || t.clase === 2)).toBe(true);
        expect(tiposCostoGasto('1').length + tiposCostoGasto('2').length).toBe(7);
    });
});

describe('los códigos son los que el servidor hace cumplir', () => {
    it('clasificación: 1 y 2', () => {
        expect(CLASIFICACION_OPTIONS.map(o => o.value)).toEqual(['1', '2']);
    });
    it('sector: 1 a 4', () => {
        expect(SECTOR_OPTIONS.map(o => o.value)).toEqual(['1', '2', '3', '4']);
    });
    it('deducible: sí/no, y son cadenas — no booleanos', () => {
        // El campo viaja como texto al desplegable. Un booleano acá haría que
        // `value === String(v)` no encuentre nada y el rótulo saliera vacío.
        expect(DEDUCIBLE_OPTIONS.map(o => o.value)).toEqual(['si', 'no']);
    });
    it('los tres estados de clasificación existen y el libro sólo usa el confirmado', () => {
        expect(Object.keys(ESTADO_CLASIF).sort()).toEqual(['confirmada', 'pendiente', 'propuesta']);
        expect(ESTADO_CLASIF.propuesta.label).toMatch(/falta confirmar/i);
    });
});

describe('los rótulos', () => {
    it('traducen el código', () => {
        expect(clasificacionLabel('1')).toBe('Costo');
        expect(sectorLabel('4')).toBe('Servicios, profesiones, artes y oficios');
        expect(tipoCostoGastoLabel('7')).toBe('Mano de obra');
    });

    it('un código que no existe devuelve null, no una cadena vacía disfrazada', () => {
        // `null` deja que la pantalla decida qué poner. Una cadena vacía se
        // pintaría como una celda en blanco indistinguible de «sin dato».
        expect(clasificacionLabel('9')).toBe(null);
        expect(sectorLabel('99')).toBe(null);
        expect(tipoCostoGastoLabel(null)).toBe(null);
        expect(tipoCostoGastoLabel(undefined)).toBe(null);
    });

    it('acepta número tanto como cadena', () => {
        expect(clasificacionLabel(2)).toBe('Gasto');
        expect(sectorLabel(1)).toBe('Industria');
    });
});

describe('el dinero del anexo lleva centavos siempre', () => {
    it('un crédito fiscal sin centavos no es el mismo número', () => {
        expect(fmtMoneda(1234.5)).toBe('$1,234.50');
        expect(fmtMoneda(0)).toBe('$0.00');
        expect(fmtMoneda(null)).toBe('$0.00');
        expect(fmtMoneda('89.9')).toBe('$89.90');
    });
});

describe('tipos de DTE', () => {
    it('los códigos del Ministerio, con su nombre', () => {
        expect(dteTypeLabel('03')).toBe('Crédito Fiscal (CCF)');
        expect(dteTypeLabel('14')).toBe('Factura Sujeto Excluido');
        // La lista exacta, no un conteo: un conteo pasa igual si alguien
        // cambia un código por otro. Faltan 02, 10, 12 y 13 del catálogo de
        // Hacienda, y está bien — lo desconocido cae al código crudo.
        expect(Object.keys(DTE_TYPE_LABELS).sort())
            .toEqual(['01','03','04','05','06','07','08','09','11','14','15']);
    });

    it('un tipo desconocido muestra el código crudo — nunca esconde la fila', () => {
        expect(dteTypeLabel('99')).toBe('Tipo 99');
    });

    it('sin tipo se muestra el guión: nunca se supo qué era', () => {
        expect(dteTypeLabel(null)).toBe('—');
        expect(dteTypeLabel('')).toBe('—');
    });
});

describe('qué documento admite proveedor', () => {
    it.each(['01', '03', '05', '06', '14'])('el emisor de %s ES el proveedor', (t) => {
        expect(dteAdmiteProveedor(t)).toBe(true);
    });

    it.each(['07', '08', '09'])('en %s el emisor es un intermediario, no un proveedor', (t) => {
        // Sin esto la pantalla los contaba como «pendiente de emparejar» y
        // ofrecía un botón que no podía resolver nada: 143 documentos tipo 09
        // marcados como tarea imposible, creciendo ~2 por día.
        expect(dteAdmiteProveedor(t)).toBe(false);
    });

    it('un documento SIN tipo sí admite proveedor manual', () => {
        // Confirmado sin JSON: nunca se supo qué era, así que no se le puede
        // negar la asignación a mano.
        expect(dteAdmiteProveedor(null)).toBe(true);
        expect(dteAdmiteProveedor('')).toBe(true);
    });
});

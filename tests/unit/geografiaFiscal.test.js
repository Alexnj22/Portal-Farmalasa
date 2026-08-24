// La división territorial de El Salvador, y el IVA de un DTE.
//
// Las dos cosas terminan en un documento fiscal, y las dos tienen el mismo modo
// de falla: **un dato válido que se lee como ausente**.
//
// Desde la Ley Especial para la Reestructuración Municipal (vigente el
// 1-may-2024) el país tiene 14 departamentos, **44 municipios** y **262
// distritos** — los 262 son los municipios de antes, que conservaron su nombre y
// ahora cuelgan de uno de los 44.
//
// El sistema de origen rotula en MAYÚSCULA, sin tildes, y a veces **truncado**.
// Medido el 2026-08-01 sobre las 894 fichas con distrito: **cero coinciden
// exacto**, 687 (77%) difieren sólo en mayúsculas o tildes, y 207 son
// abreviaturas que ninguna normalización puede resolver. Sin conciliar, el
// formulario muestra el distrito VACÍO y la ficha parece incompleta cuando no lo
// está.

import { describe, it, expect } from 'vitest';
import {
    DEPARTAMENTOS, municipiosDe, distritosDe, departamentoDeMunicipio,
    canonDepartamento, canonMunicipio, canonDistrito, conciliarGeo, normalizarGeo,
} from '../../src/data/elSalvadorGeo';
import { ivaDelDte } from '../../src/utils/dteIva';
import { DEPARTAMENTOS_SV, departamentoLabel } from '../../src/utils/svCatalogs';

describe('los tres niveles', () => {
    it('son 14 departamentos y 44 municipios', () => {
        expect(DEPARTAMENTOS).toHaveLength(14);
        expect(DEPARTAMENTOS.flatMap(municipiosDe)).toHaveLength(44);
    });

    it('son 262 distritos: los municipios de antes', () => {
        const todos = DEPARTAMENTOS.flatMap(municipiosDe).flatMap(distritosDe);
        expect(todos).toHaveLength(262);
    });

    it('cada municipio sabe de qué departamento cuelga, sin una tabla paralela', () => {
        // El mapa inverso se arma del mismo dato: una tabla escrita a mano es
        // una tabla que se desincroniza.
        for (const dep of DEPARTAMENTOS)
            for (const mun of municipiosDe(dep))
                expect(departamentoDeMunicipio(mun)).toBe(dep);
    });

    it('lo que no existe devuelve vacío o null, nunca `undefined`', () => {
        expect(municipiosDe('Atlántida')).toEqual([]);
        expect(distritosDe('Atlántida')).toEqual([]);
        expect(departamentoDeMunicipio('Atlántida')).toBeNull();
    });
});

describe('conciliar la grafía del sistema de origen', () => {
    it('las mayúsculas y las tildes no impiden reconocerlo', () => {
        expect(canonDepartamento('CHALATENANGO')).toBe('Chalatenango');
        expect(canonMunicipio('CHALATENANGO SUR')).toBe('Chalatenango Sur');
        expect(canonDistrito('CHALATENANGO SUR', 'CONCEPCIÓN QUEZALTEPEQUE'))
            .toBe('Concepción Quezaltepeque');
    });

    it('lo que viene TRUNCADO necesita la tabla: ninguna regla lo deduce', () => {
        // Ninguna normalización saca «San Miguel de Mercedes» de «SN MIG
        // MERCEDES»: hace falta decirlo.
        expect(canonDistrito('CHALATENANGO SUR', 'SN MIG MERCEDES')).toBe('San Miguel de Mercedes');
        expect(canonDistrito('CHALATENANGO CENTRO', 'NVA CONCEPCION')).toBe('Nueva Concepción');
        expect(canonDistrito('CHALATENANGO SUR', 'SAN J CANCASQUE')).toBe('San José Cancasque');
    });

    it('un distrito que cambió de nombre se resuelve al vigente', () => {
        // Se llamaba «San José Las Flores» y quedó como «Las Flores».
        expect(canonDistrito('CHALATENANGO SUR', 'SAN JOSE FLORES')).toBe('Las Flores');
    });

    it('lo que NO reconoce se devuelve tal cual: no inventa ni descarta', () => {
        expect(canonDepartamento('Atlántida')).toBe('Atlántida');
        expect(canonDistrito('Chalatenango Sur', 'UN LUGAR QUE NO EXISTE'))
            .toBe('UN LUGAR QUE NO EXISTE');
    });

    it('una abreviatura que NO pertenece a ese municipio no se aplica', () => {
        // La tabla es global, pero un distrito sólo vale dentro del suyo:
        // aplicarla a ciegas mudaría la ficha de departamento.
        expect(canonDistrito('San Salvador Centro', 'SN MIG MERCEDES')).toBe('SN MIG MERCEDES');
    });

    it('la terna se concilia entera al cargar la ficha', () => {
        expect(conciliarGeo({ departamento: 'CHALATENANGO', municipio: 'CHALATENANGO SUR',
                              distrito: 'CONCEPCIÓN QUEZALTEPEQUE' }))
            .toEqual({ departamento: 'Chalatenango', municipio: 'Chalatenango Sur',
                       distrito: 'Concepción Quezaltepeque' });
    });

    it('sin nada, no revienta', () => {
        expect(conciliarGeo()).toEqual({ departamento: null, municipio: null, distrito: null });
    });
});

describe('la cascada no puede quedar en un estado imposible', () => {
    it('el MUNICIPIO manda sobre el departamento', () => {
        // Un municipio de Chalatenango dentro de San Salvador es una dirección
        // que no existe, y va a un documento fiscal.
        expect(normalizarGeo({ departamento: 'San Salvador', municipio: 'Chalatenango Sur' }))
            .toMatchObject({ departamento: 'Chalatenango', municipio: 'Chalatenango Sur' });
    });

    it('DEDUCE el departamento cuando falta pero el municipio está', () => {
        // Es el caso real de 92 fichas importadas sin departamento.
        expect(normalizarGeo({ municipio: 'Chalatenango Sur' }).departamento).toBe('Chalatenango');
    });

    it('un distrito que no es del municipio se cae', () => {
        expect(normalizarGeo({ municipio: 'Chalatenango Sur', distrito: 'Mejicanos' }).distrito)
            .toBeNull();
    });

    it('sin municipio no puede haber distrito', () => {
        expect(normalizarGeo({ departamento: 'Chalatenango', distrito: 'Mejicanos' }).distrito)
            .toBeNull();
    });

    it('un municipio que no existe se descarta, y con él el distrito', () => {
        expect(normalizarGeo({ municipio: 'Atlántida', distrito: 'X' }))
            .toMatchObject({ municipio: null, distrito: null });
    });

    it('un departamento que no existe se descarta', () => {
        expect(normalizarGeo({ departamento: 'Atlántida' }).departamento).toBeNull();
    });

    it('normalizar dos veces da lo mismo', () => {
        const una = normalizarGeo({ departamento: 'SAN SALVADOR', municipio: 'CHALATENANGO SUR',
                                    distrito: 'SAN JOSE FLORES' });
        expect(normalizarGeo(una)).toEqual(una);
    });
});

describe('el IVA de un DTE sale de `tributos`, no de `totalIva`', () => {
    // `resumen.totalIva` NO existe en el esquema del Ministerio de Hacienda.
    // Leerlo de ahí dejó **513 de 516 documentos de julio 2026 con el IVA en
    // NULL**, incluidos 415 CCF que sí lo traían, y la tarjeta «Crédito Fiscal
    // IVA» mostraba $36.82 en vez del monto real.
    it('lo saca del tributo con código 20', () => {
        expect(ivaDelDte({ resumen: { tributos: [{ codigo: '20', valor: 13 }] } })).toBe(13);
    });

    it('SÓLO el código 20: FOVIAL y COTRANS no son crédito fiscal', () => {
        // Sumar todos los tributos parece más general y no lo es: un documento
        // de combustible los trae y no dan crédito.
        expect(ivaDelDte({ resumen: { tributos: [
            { codigo: '20', valor: 13 }, { codigo: 'D1', valor: 5 }, { codigo: 'C8', valor: 2 },
        ] } })).toBe(13);
    });

    it('suma si el documento trae varios renglones del mismo tributo', () => {
        expect(ivaDelDte({ resumen: { tributos: [
            { codigo: '20', valor: 10 }, { codigo: '20', valor: 3 },
        ] } })).toBe(13);
    });

    it('`totalIva` se prueba primero, por si algún proveedor sí lo manda', () => {
        expect(ivaDelDte({ resumen: { totalIva: 26, tributos: [{ codigo: '20', valor: 13 }] } })).toBe(26);
    });

    it('un `totalIva` en cero NO gana: en consumidor final viene así y el IVA va en el precio', () => {
        expect(ivaDelDte({ resumen: { totalIva: 0, tributos: [{ codigo: '20', valor: 13 }] } })).toBe(13);
    });

    it('sin tributos usable cae al valor que ya extrajo el sync', () => {
        // Va al final —y no primero— porque el documento manda sobre la copia.
        expect(ivaDelDte({ resumen: { tributos: [] } }, 7.5)).toBe(7.5);
        expect(ivaDelDte(null, 7.5)).toBe(7.5);
    });

    it('sin nada devuelve null, no cero', () => {
        // Un 0 se sumaría al crédito fiscal como un dato averiguado.
        expect(ivaDelDte(null)).toBeNull();
        expect(ivaDelDte({ resumen: {} })).toBeNull();
    });
});

describe('el catálogo de departamentos de Hacienda (CAT-012)', () => {
    it('son los 14, por código de dos dígitos', () => {
        expect(Object.keys(DEPARTAMENTOS_SV)).toHaveLength(14);
        expect(DEPARTAMENTOS_SV['04']).toBe('Chalatenango');
        expect(DEPARTAMENTOS_SV['06']).toBe('San Salvador');
    });

    it('un código desconocido se MUESTRA, no se esconde', () => {
        // Esconderlo dejaría la ficha viéndose vacía sobre un dato que sí está.
        expect(departamentoLabel('99')).toBe('Depto. 99');
    });

    it('sin código no hay rótulo', () => {
        expect(departamentoLabel(null)).toBeNull();
        expect(departamentoLabel('')).toBeNull();
    });
});

// La planilla — la matemática que le paga a 49 personas.
//
// Nómina no tenía ni una prueba. Es el área donde un error no da error: paga
// mal, y el que cobra de menos lo descubre semanas después mirando su boleta —
// si la mira. No hay pantalla roja, no hay log, no hay alerta.
//
// Al escribir estas pruebas se encontró que la tabla de retención de renta era
// la ANTERIOR a la reforma de 2025 y además le faltaban las cuotas fijas. Con
// base gravada de $275,00 retenía $10,57 a alguien que por ley no paga nada.
// No le había pasado a nadie: no había ni un período generado ni un empleado
// con sueldo cargado. Lo que había era un defecto esperando la primera corrida.
//
// ── Qué se prueba y por qué ────────────────────────────────────────────────
// Los BORDES de cada tramo, no el medio. Un error de tabla casi nunca está en
// «$800 paga $100»: está en si $447,62 cae en el tramo II o en el III, y en si
// la cuota fija del tramo se está sumando. Por eso además de los valores hay una
// prueba de los SALTOS entre tramos: si alguien borra una cuota fija, el salto
// cambia y eso se ve al instante — que es exactamente el error que tenía el
// portal y que nada delataba.

import { describe, it, expect } from 'vitest';
import { calcRenta, calcPayrollEntry, TRAMOS_RENTA_QUINCENAL } from '../../src/store/slices/payrollSlice';

const emp = (base_salary) => ({ id: 'x', base_salary });

describe('retención de renta — Decreto Ejecutivo 10/2025, tabla quincenal', () => {
    // Los cuatro tramos, con sus cifras oficiales. Si la ley cambia, ESTA lista
    // es lo que hay que actualizar — y su fuente va escrita, no de memoria.
    it('la tabla del código es la del decreto vigente', () => {
        expect(TRAMOS_RENTA_QUINCENAL).toEqual([
            { hasta: 275.00,   cuotaFija: 0,      tasa: 0,    sobreExceso: 0 },
            { hasta: 447.62,   cuotaFija: 8.83,   tasa: 0.10, sobreExceso: 275.00 },
            { hasta: 1019.05,  cuotaFija: 30.00,  tasa: 0.20, sobreExceso: 447.62 },
            { hasta: Infinity, cuotaFija: 144.28, tasa: 0.30, sobreExceso: 1019.05 },
        ]);
    });

    it('no retiene nada hasta el mínimo exento de $275.00', () => {
        expect(calcRenta(0)).toBe(0);
        expect(calcRenta(100)).toBe(0);
        expect(calcRenta(274.99)).toBe(0);
        expect(calcRenta(275.00)).toBe(0);   // el borde EXACTO todavía es exento
    });

    it('un centavo por encima del exento entra al tramo II con su cuota fija', () => {
        // $8.83 + 10% de $0.01 = $8.831 → $8.83
        expect(calcRenta(275.01)).toBe(8.83);
        // Sin la cuota fija esto daría $0.00, que es el error que tenía el portal.
        expect(calcRenta(275.01)).toBeGreaterThan(0);
    });

    it('calcula cada tramo en su borde superior e inferior', () => {
        // Tramo II, tope: 8.83 + (447.62 − 275.00) × 0.10 = 8.83 + 17.262 = 26.09
        expect(calcRenta(447.62)).toBe(26.09);
        // Tramo III, piso: 30.00 + (447.63 − 447.62) × 0.20 = 30.00
        expect(calcRenta(447.63)).toBe(30.00);
        // Tramo III, tope: 30.00 + (1019.05 − 447.62) × 0.20 = 30.00 + 114.286 = 144.29
        expect(calcRenta(1019.05)).toBe(144.29);
        // Tramo IV, piso: 144.28 + (1019.06 − 1019.05) × 0.30 = 144.28
        expect(calcRenta(1019.06)).toBe(144.28);
    });

    it('los saltos entre tramos son los que la ley pone, y no otros', () => {
        // ── Esta prueba nació MAL y vale la pena que quede dicho ───────────
        // La primera versión exigía que los tramos EMPALMARAN —que el impuesto
        // al final de uno fuera casi el mismo que al empezar el siguiente— y
        // falló contra el código correcto. La premisa era mía y era falsa: la
        // tabla salvadoreña NO es continua. Un centavo por encima de $275,00
        // cuesta $8,83 de golpe, y un centavo por encima de $447,62 cuesta
        // $3,91 más. Es una tabla de RETENCIÓN —un anticipo— y el ajuste fino
        // se hace en el recálculo anual; los escalones son deliberados.
        //
        // Así que lo que se ancla es el salto MEDIDO en cada borde. Sigue
        // cazando lo que la de continuidad quería cazar —si alguien borra una
        // cuota fija, el salto cambia y esto falla— pero sin exigirle a la ley
        // una forma que no tiene.
        const salto = (x) => parseFloat((calcRenta(parseFloat((x + 0.01).toFixed(2))) - calcRenta(x)).toFixed(2));
        expect(salto(275.00),  'entrar al tramo II cuesta la cuota fija entera').toBe(8.83);
        expect(salto(447.62),  'del II al III').toBe(3.91);
        expect(salto(1019.05), 'del III al IV').toBe(-0.01);
    });

    it('una base negativa o basura no retiene ni rompe', () => {
        expect(calcRenta(-100)).toBe(0);
        expect(calcRenta(null)).toBe(0);
        expect(calcRenta(undefined)).toBe(0);
        expect(calcRenta(NaN)).toBe(0);
    });
});

describe('la quincena completa', () => {
    it('descuenta ISSS, AFP y renta sobre el salario ordinario', () => {
        // $800 al mes → $26.6667/día → 15 días = $400.00 ordinario
        const r = calcPayrollEntry(emp(800), 15);
        expect(r.ordinary_salary).toBe(400.00);
        expect(r.isss_deduction).toBe(12.00);        // 3% de 400
        expect(r.afp_deduction).toBe(29.00);         // 7.25% de 400
        // Base gravada 400 − 12 − 29 = 359.00 → tramo II
        // 8.83 + (359.00 − 275.00) × 0.10 = 8.83 + 8.40 = 17.23
        expect(r.renta_deduction).toBe(17.23);
        expect(r.net_pay).toBe(parseFloat((400 - (12 + 29 + 17.23)).toFixed(2)));
    });

    it('el ISSS tiene tope: no crece más allá de $500 de base quincenal', () => {
        // El tope existe por ley (cotizable máximo $1,000/mes). Sin él, un sueldo
        // alto pagaría ISSS proporcional y la boleta estaría mal por arriba.
        const medio = calcPayrollEntry(emp(2000), 15);   // ordinario $1,000
        const alto  = calcPayrollEntry(emp(6000), 15);   // ordinario $3,000
        expect(medio.isss_deduction).toBe(15.00);        // 3% de 500, ya topado
        expect(alto.isss_deduction).toBe(15.00);         // el mismo: no sube
    });

    it('un sueldo bajo no retiene renta', () => {
        // $600 al mes → $300.00 la quincena. Gravada: 300 − 9 − 21.75 = 269.25,
        // por debajo del exento. Con la tabla vieja pagaba $10.24.
        const r = calcPayrollEntry(emp(600), 15);
        expect(r.ordinary_salary).toBe(300.00);
        expect(r.renta_deduction).toBe(0);
    });

    it('sin sueldo cargado no inventa números', () => {
        // Hoy los 49 empleados están así: `base_salary` en null. La planilla
        // tiene que dar cero y no NaN — un NaN se propaga al neto y a la boleta.
        const r = calcPayrollEntry(emp(null), 15);
        expect(r.ordinary_salary).toBe(0);
        expect(r.renta_deduction).toBe(0);
        expect(Number.isNaN(r.net_pay)).toBe(false);
        expect(r.net_pay).toBe(0);
    });

    it('los días trabajados escalan lo ordinario, no las deducciones fijas', () => {
        const quincena = calcPayrollEntry(emp(900), 15);
        const mitad    = calcPayrollEntry(emp(900), 7);
        expect(mitad.ordinary_salary).toBeLessThan(quincena.ordinary_salary);
        // El ISSS y la AFP salen del ordinario REAL, no de la quincena completa:
        // a quien trabajó siete días no se le cobra sobre quince.
        expect(mitad.isss_deduction).toBeLessThan(quincena.isss_deduction);
        expect(mitad.afp_deduction).toBeLessThan(quincena.afp_deduction);
    });

    it('lo que no está sujeto a retención suma al neto sin pasar por las deducciones', () => {
        // Horas extra, recargo de feriado y viáticos van por fuera (Código de
        // Trabajo art. 169 y 190). Si entraran a la base gravada, el empleado
        // pagaría renta por su hora extra.
        const sin  = calcPayrollEntry(emp(800), 15);
        const con  = calcPayrollEntry(emp(800), 15, { viaticos: 50, bonifications: 25 });
        expect(con.renta_deduction).toBe(sin.renta_deduction);   // la base no se movió
        expect(con.isss_deduction).toBe(sin.isss_deduction);
        expect(con.net_pay).toBe(parseFloat((sin.net_pay + 75).toFixed(2)));
    });
});

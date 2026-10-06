/**
 * Cierre de período fiscal — la cadena del remanente (Art. 67 LIVA): cada mes
 * arranca del remanente a favor del anterior. Vivía en `CierrePeriodoView`; se
 * mudó el 2026-10-05 para que la app muestre la misma cadena.
 *
 * Lo que se CONGELA lo calcula `cerrar_periodo_fiscal` en el servidor; esto
 * sólo previsualiza, con la MISMA fórmula, para que la cadena se vea antes de
 * decidir. Los frenos (`puede_cerrarse`, `motivo_no_puede`) vienen del RPC y no
 * se re-deducen acá.
 */

/** El saldo de un período con el libro elegido y el remanente que entra. */
export function saldoDelPeriodo(p, usarDeclarable, entra) {
    const credito = Number(usarDeclarable ? p.credito_declarable : p.credito_fiscal) || 0;
    const saldo = Number(p.debito_fiscal || 0) - credito
        - Number(p.percepcion_pagada || 0) - Number(p.retencion_sufrida || 0) - entra;
    const r = Math.round(saldo * 100) / 100;
    return { credito, aPagar: r > 0 ? r : 0, remanente: r < 0 ? -r : 0 };
}

/**
 * La cadena. Un mes CERRADO conserva lo suyo congelado —es lo que se
 * declaró— y sólo los abiertos se recalculan con el libro elegido. El mes en
 * curso no le pasa remanente a nadie.
 */
export function cadenaDelRemanente(filas, usarDeclarable) {
    let entra = 0;
    return (filas || []).map((p) => {
        const cerrado = p.estado === 'cerrado';
        const base = cerrado
            ? { credito: Number(p.cong_credito || 0), aPagar: Number(p.cong_a_pagar || 0), remanente: Number(p.cong_remanente_sale || 0) }
            : saldoDelPeriodo(p, usarDeclarable, entra);
        const fila = { ...p, ...base, entra: cerrado ? Number(p.cong_entra || 0) : entra };
        if (!p.en_curso) entra = base.remanente;
        return fila;
    });
}

/** Cuántos cerrados y abiertos, y cuánto remanente quedó sin arrastrar en los abiertos. */
export function totalesDeLaCadena(cadena) {
    const abiertos = (cadena || []).filter((f) => !f.en_curso && f.estado !== 'cerrado');
    return {
        cerrados: (cadena || []).filter((f) => f.estado === 'cerrado').length,
        abiertos: abiertos.length,
        perdido: abiertos.filter((f) => f.remanente > 0).reduce((s, f) => s + f.remanente, 0),
    };
}

/** ¿El libro se movió después de cerrarlo? (la razón de congelar) */
export const derivoDelCierre = (fila) => fila.estado === 'cerrado'
    && (Math.abs(Number(fila.deriva_debito || 0)) > 0.005 || Math.abs(Number(fila.deriva_credito || 0)) > 0.005);

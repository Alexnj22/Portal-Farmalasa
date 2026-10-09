// Finalizar el efectivo contado: cuánto va al banco, cuánto en mano a
// administración y cuánto queda de remanente. Las cuentas vivían dentro de
// `components/bolsas/DepositoAlBanco.jsx`; están acá para que el portal y la app
// repartan con la MISMA regla (el porqué de cada una sigue en ese componente).
//
//     contado + lo que entró de afuera
//       − al banco    (exige banco)
//       − en mano     (exige a quién, y sólo administración)
//       = remanente   (siempre del Gerente General)

const num = (v) => Number(String(v ?? '').replace(',', '.')) || 0;
const redondo = (n) => Math.round(n * 100) / 100;

/** Lo contado en las bolsas que se van a cerrar. El total no se escribe: se suma. */
export const contadoDeBolsas = (bolsas) => (bolsas || []).reduce((a, b) => a + Number(b.contado || 0), 0);

/**
 * El reparto con los topes aplicados AL LEER: el estado guarda lo que la persona
 * tecleó y cada parte llega hasta lo que la otra deja libre. Cuando no caben las
 * dos, cede la que se tocó última (`ultimo`: 'banco' | 'efectivo').
 */
export function repartoDelDeposito({ contado, aporte, escritoBanco, escritoEfectivo, ultimo = 'banco' }) {
    const nAporte = num(aporte);
    const disponible = redondo(Number(contado || 0) + nAporte);
    const banco = num(escritoBanco);
    const efectivo = num(escritoEfectivo);
    const recortar = (n, tope) => Math.max(0, Math.min(n, redondo(tope)));
    let nMonto;
    let nEfectivo;
    if (ultimo === 'efectivo') {
        nMonto = recortar(banco, disponible);
        nEfectivo = recortar(efectivo, disponible - nMonto);
    } else {
        nEfectivo = recortar(efectivo, disponible);
        nMonto = recortar(banco, disponible - nEfectivo);
    }
    const reparto = redondo(nMonto + nEfectivo);
    const remanente = redondo(disponible - reparto);
    return {
        nAporte, disponible, nMonto, nEfectivo, reparto, remanente,
        escritoBanco: banco, escritoEfectivo: efectivo,
        bancoRecortado: banco - nMonto > 0.004,
        efectivoRecortado: efectivo - nEfectivo > 0.004,
        noAlcanza: remanente < 0,
        topeBanco: redondo(disponible - nEfectivo),
        topeEfectivo: redondo(disponible - nMonto),
    };
}

/** Lo que falta para poder cerrar: cada parte pide lo suyo sólo si lleva monto. */
export function faltasDelDeposito({ nMonto, nEfectivo, nAporte, banco, entregadoA, aporteNota }) {
    return {
        faltaNota: nAporte > 0 && !String(aporteNota || '').trim(),
        faltaBanco: nMonto > 0 && !banco,
        faltaQuien: nEfectivo > 0 && !entregadoA,
    };
}

/** Los días que cubre un depósito, dicho corto («17 ago» o «17 ago → 19 ago»). */
export function rangoDeDiasDelDeposito(d, corta) {
    if (!d?.dia_desde) return '—';
    return d.dia_desde === d.dia_hasta ? corta(d.dia_desde) : `${corta(d.dia_desde)} → ${corta(d.dia_hasta)}`;
}

/**
 * Los totales de la lista de cierres (`get_depositos`): lo que fue al banco, lo
 * que se entregó en mano y los depósitos al banco SIN su boleta. Escrito una vez
 * para el portal (`DepositosAlBanco`) y la app.
 *
 * Un cierre CORREGIDO no cuenta —sus bolsas volvieron a estar por cerrar— y uno
 * `ANTERIOR` tampoco: no registra ningún movimiento. El remanente NO se acumula
 * («ya no es responsabilidad ni control del portal, es efectivo del dueño»,
 * usuario 2026-08-26): un total de remanentes sería un saldo.
 */
export function totalesDeDepositos(lista) {
    return (lista || [])
        .filter((d) => !d.anulado_at && d.destino !== 'ANTERIOR')
        .reduce((a, d) => {
            const banco = Number(d.monto_deposito || 0);
            const sinBoleta = banco >= 0.01 && !d.comprobante_url;
            return {
                banco: a.banco + banco,
                efectivo: a.efectivo + Number(d.monto_efectivo || 0),
                sinBoleta: a.sinBoleta + (sinBoleta ? 1 : 0),
                sinBoletaMonto: a.sinBoletaMonto + (sinBoleta ? banco : 0),
            };
        }, { banco: 0, efectivo: 0, sinBoleta: 0, sinBoletaMonto: 0 });
}

/**
 * Los totales de la lista de conteos de bolsas (`get_conteos`): lo contado y las
 * bolsas que no cuadraron y todavía no tienen causa («sin resolver»; las ya
 * resueltas no son trabajo pendiente). Para el portal (`ConteosDeBolsas`) y la
 * app.
 */
export function totalesDeConteos(lista) {
    return (lista || []).reduce((a, c) => ({
        contado: a.contado + Number(c.total_contado || 0),
        abiertas: a.abiertas + Math.max(0, Number(c.descuadradas || 0) - Number(c.resueltas || 0)),
        justificado: a.justificado + Number(c.justificado || 0),
    }), { contado: 0, abiertas: 0, justificado: 0 });
}

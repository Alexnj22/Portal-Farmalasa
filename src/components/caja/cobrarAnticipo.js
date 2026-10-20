// Cobrar el anticipo de algo apartado o encargado (2026-10-20): la foto del
// comprobante si no fue en efectivo, el ingreso tipo APARTADO por `operar-caja`
// (que valida el monto y liga la reserva o el encargo) y la constancia impresa.
// Lo usan Mi caja y la tarjeta de Reservas del Inicio: escrito dos veces, uno
// terminaría cobrando sin la foto o sin el papel.
import { anotarIngreso, subirComprobante } from '@nucleo/data/bolsas';
import { datosDeFormaDePago, FORMAS_DE_PAGO } from '@nucleo/utils/formaDePago';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { imprimirConstanciaDeReserva } from '@nucleo/utils/reservaConstancia';

/**
 * Devuelve `{ ok: true, apartado, aviso?, papel? }` o `{ ok: false, error }`.
 * `papel` es el error de impresión, si lo hubo: el cobro ya quedó.
 */
export async function cobrarAnticipo({ sala, nombreSala, userId, quienAtiende, clave, monto, apartado, pago, papel }) {
    let fotoUrl = null;
    if (pago?.forma && pago.forma !== 'EFECTIVO' && pago.foto) {
        try { fotoUrl = await subirComprobante(pago.foto, { salaId: sala, userId }); } catch (e) { return { ok: false, error: e }; }
        if (!fotoUrl) return { ok: false, error: new Error('No se pudo subir la foto del comprobante.') };
    }
    const r = await anotarIngreso({
        sala, monto, clave, tipo: 'APARTADO', apartado, concepto: 'Anticipo', fotoUrl,
        ...datosDeFormaDePago(pago, fotoUrl),
    });
    if (r?.error) return { ok: false, error: r.error };
    const a = r?.apartado;
    if (!a) return { ok: false, error: new Error('El cobro no quedó ligado a la reserva. Revisa la lista del día.') };
    try {
        await imprimirConstanciaDeReserva({
            codigo: a.codigo, cliente: shortEmployeeName(papel?.cliente ?? ''), producto: papel?.producto,
            cantidad: papel?.cantidad, precio: papel?.precio, anticipo: Number(a.anticipo),
            metodo: FORMAS_DE_PAGO.find((f) => f.value === pago?.forma)?.label ?? 'Efectivo',
            venceAt: a.vence_at ?? null, sala: nombreSala, atendio: shortEmployeeName(quienAtiende ?? ''),
        }, { sala });
    } catch (e) {
        return { ok: true, apartado: a, aviso: r.aviso, papel: e };
    }
    return { ok: true, apartado: a, aviso: r.aviso };
}

// Cobrar el anticipo de algo apartado o encargado desde el teléfono — gemela
// de `src/components/caja/cobrarAnticipo.js`. Lo que cambia es sólo el
// dispositivo: la foto se sube con `subirFotos` y el papel sale por la cola de
// la caja de la sala (`imprimirEnLaSala`). El cobro (`anotarIngreso`, tipo
// APARTADO, que `operar-caja` vuelve a validar) y el papel
// (`construirConstanciaDeReserva`) son los del núcleo.
import { anotarIngreso } from '@nucleo/data/bolsas';
import { datosDeFormaDePago, FORMAS_DE_PAGO } from '@nucleo/utils/formaDePago';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { construirConstanciaDeEncargo, construirConstanciaDeReserva } from '@nucleo/utils/reservaConstancia';
import { fetchReglasDeReserva } from '@nucleo/data/reservas';
import { subirFotos } from '../formulario/Fotos';
import { imprimirEnLaSala } from '../imprimir';

/**
 * Devuelve `{ ok: true, apartado, aviso?, papel }` (papel = `{ ok, detalle }`
 * de la impresión: el cobro ya quedó aunque el papel no salga) o
 * `{ ok: false, error }`.
 */
export async function cobrarAnticipoEnLaApp({ sala, nombreSala, user, clave, monto, apartado, pago, papel }) {
  let fotoUrl = null;
  try {
    if (pago?.forma && pago.forma !== 'EFECTIVO' && pago.foto) {
      fotoUrl = (await subirFotos([pago.foto], { bucket: 'payment-proofs', carpeta: `bolsas/${sala}/${user?.id ?? 'anon'}` }))[0] ?? null;
      if (!fotoUrl) throw new Error('No se pudo subir la foto del comprobante. Revisa la conexión y vuelve a intentarlo.');
    }
  } catch (e) { return { ok: false, error: e }; }
  const r = await anotarIngreso({
    sala, monto, clave, tipo: 'APARTADO', apartado, concepto: 'Anticipo', fotoUrl, ...datosDeFormaDePago(pago, fotoUrl),
  });
  if (r?.error) return { ok: false, error: r.error };
  const a = r?.apartado;
  if (!a) return { ok: false, error: new Error('El cobro no quedó ligado a la reserva. Revisa la lista del día.') };
  // El pie del papel dice cuánto vale el saldo a favor según el reglamento vigente.
  const reglas = await fetchReglasDeReserva().catch(() => null);
  const hoja = await imprimirEnLaSala(construirConstanciaDeReserva({
    codigo: a.codigo, cliente: shortEmployeeName(papel?.cliente ?? ''), telefono: papel?.telefono ?? null,
    enCamino: a.traslado_desde ?? papel?.enCamino ?? null, producto: papel?.producto, cantidad: papel?.cantidad, precio: papel?.precio,
    renglones: papel?.renglones, anticipo: Number(a.anticipo), metodo: FORMAS_DE_PAGO.find((f) => f.value === pago?.forma)?.label ?? 'Efectivo',
    venceAt: a.vence_at ?? null, sala: nombreSala, atendio: shortEmployeeName(user?.name ?? ''), reglas,
  }), sala, `Reserva ${a.codigo}`);
  return { ok: true, apartado: a, aviso: r.aviso ?? null, papel: hoja };
}

/** El papel del encargo: no se cobró nada, pero el cliente se lleva su código. */
export function imprimirEncargoEnLaApp({ sala, nombreSala, user, codigo, cliente, producto, cantidad, nuevo }) {
  return imprimirEnLaSala(construirConstanciaDeEncargo({
    codigo, cliente: shortEmployeeName(cliente?.name ?? ''), telefono: cliente?.phone ?? null, producto, cantidad, nuevo,
    sala: nombreSala, atendio: shortEmployeeName(user?.name ?? ''),
  }), sala, `Encargo ${codigo}`);
}

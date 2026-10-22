// Lo que la tarjeta y el detalle de una reserva dicen IGUAL (2026-10-22). La
// lógica vive en el núcleo (`@nucleo/utils/reservasDeSala`) porque la app la
// usa también; este archivo sólo la re-exporta para sus importadores del portal.
export {
    TRASLADO, cuentasDeReserva, estadoDeReserva, formaDePagoLegible, renglonesDe, telefonoLegible,
} from '@nucleo/utils/reservasDeSala';

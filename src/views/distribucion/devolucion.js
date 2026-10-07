import { PackageCheck, ShieldAlert } from 'lucide-react';
import { DESTINOS_DEVOLUCION as DESTINOS } from '@nucleo/utils/distribucionFacturacion';

// La cuenta de una devolución vive en el núcleo (borrador 0017), para que la
// app nativa avise lo mismo antes de emitir. Acá sólo se le ponen los íconos.

const ICONO = { reingreso: PackageCheck, cuarentena: ShieldAlert };
export const DESTINOS_DEVOLUCION = DESTINOS.map(d => ({ ...d, icon: ICONO[d.value] }));
export { totalDevolucion } from '@nucleo/utils/distribucionFacturacion';

// El «Paquete del mes» de Torogoz en el teléfono: el MISMO paquete que baja el
// portal —qué archivos y con qué nombre lo decide el núcleo (`paqueteDelMes`)—
// comprimido y compartido por `compartirZip` (anotado como salida de datos,
// igual que en el portal).
import { useState } from 'react';
import { Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import { paqueteDelMes } from '@nucleo/data/distribucionPaquete';
import { mensajeDeDistribucion } from '@nucleo/data/distribucion';
import { compartirZip } from '../../../fiscal/zip';
import { BotonGrande } from '../../../formulario/Piezas';
import { fallo, trabajando, cerrarProgreso } from '../../../Progreso';

const PETROLEO = '#0f6e7d';

export async function compartirPaquete(mes) {
  trabajando('Armando el paquete…');
  const p = await paqueteDelMes(mes);
  cerrarProgreso();
  if (!p) { Alert.alert('Paquete del mes', 'Este mes no tiene nada que declarar.'); return; }
  if (p.sinSello) {
    await new Promise((resolve) => Alert.alert('Paquete del mes', `Ojo: ${p.sinSello} documentos sin sello de Hacienda quedaron fuera de los libros.`, [{ text: 'Seguir', onPress: resolve }]));
  }
  const compartido = await compartirZip({ entradas: p.entradas, nombre: p.nombre, modulo: 'distribucion', detalle: { mes, paquete: 'torogoz-mes' } });
  if (compartido) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

export default function BotonPaquete({ mes }) {
  const [armando, setArmando] = useState(false);
  return (
    <BotonGrande texto={armando ? 'Armando…' : 'Paquete del mes (ZIP)'} borde color={PETROLEO} deshabilitado={armando}
      onPress={async () => {
        setArmando(true);
        try { await compartirPaquete(mes); } catch (e) { fallo('No se pudo armar el paquete', mensajeDeDistribucion(e)); } finally { setArmando(false); }
      }} />
  );
}

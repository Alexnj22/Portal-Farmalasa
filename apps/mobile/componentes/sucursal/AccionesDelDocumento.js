// Subir, reemplazar o quitar un documento del expediente de la sala, desde el
// teléfono. Va por el MISMO `updateBranch` del portal: el archivo se versiona
// (el anterior pasa a `old/` y queda como HISTÓRICO en `branch_documents`) y
// en `settings` se guarda la URL formato-public, nunca una firmada. Qué
// renglón se sube y qué acepta el bucket lo decide el núcleo
// (`expedienteDeSucursal`), incluidos los tres de cada enfermera. Los
// documentos propios se agregan y editan en `sucursal/documento`.
import { Alert, Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useStaffStore } from '@nucleo/store/staffStore';
import { ajustesConArchivo, seQuitaDesdeLaApp, seSubeDesdeLaApp } from '@nucleo/utils/expedienteDeSucursal';
import { sucursalConCambios } from '@nucleo/utils/edicionDeSucursal';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { MARCA } from '../inicio/marca';
import { fallo, listo, trabajando } from '../Progreso';
import { elegirOrigen, leerComoArchivo } from './elegirArchivo';

function Accion({ texto, color, onPress }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button"
      style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', paddingHorizontal: 6, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
      <Text style={{ color, fontSize: 15, fontWeight: '600' }}>{texto}</Text>
    </Pressable>
  );
}

export default function AccionesDelDocumento({ b, d }) {
  const updateBranch = useStaffStore((s) => s.updateBranch);
  if (!seSubeDesdeLaApp(d.id)) return null;

  const guardar = async (archivo, titulo) => {
    const base = sucursalConCambios(b);
    const settings = ajustesConArchivo(base.settings, d.id, archivo);
    if (!settings) return;
    trabajando(archivo ? 'Subiendo el documento…' : 'Quitando el documento…');
    try {
      await updateBranch(b.id, { ...base, settings });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      listo(titulo, d.title);
    } catch (e) {
      fallo(archivo ? 'No se pudo subir' : 'No se pudo quitar', mensajeAmigable(e, 'Intenta de nuevo.'));
    }
  };

  const subir = async () => {
    const f = await elegirOrigen();
    if (!f) return;
    Alert.alert(d.url ? 'Reemplazar el documento' : 'Subir el documento',
      d.url ? `«${d.title}» se reemplaza; el anterior queda en el historial de la sucursal.` : `Se guarda «${d.title}» en el expediente de ${b.name}.`, [
        { text: 'Cancelar', style: 'cancel' },
        { text: d.url ? 'Reemplazar' : 'Subir', onPress: async () => {
          try {
            const archivo = await leerComoArchivo(f, d.id);
            if (archivo) await guardar(archivo, d.url ? 'Documento reemplazado' : 'Documento guardado');
          } catch (e) { fallo('No se pudo leer el archivo', e?.message || ''); }
        } },
      ]);
  };

  const quitar = () => Alert.alert('Quitar el documento', `«${d.title}» deja de estar en el expediente; queda en el historial de la sucursal.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Quitar', style: 'destructive', onPress: () => guardar(null, 'Documento quitado') },
  ]);

  return (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      <Accion texto={d.url ? 'Reemplazar' : 'Subir'} color={MARCA.azulClaro} onPress={subir} />
      {d.url && seQuitaDesdeLaApp(d.id) ? <Accion texto="Quitar" color={MARCA.rojo} onPress={quitar} /> : null}
    </View>
  );
}

// Las acciones del ciclo de una encuesta a clientes, NATIVO — las mismas del
// portal (`EncuestaDetalle`): Enviar a revisión, Aprobar, Devolver con cambios,
// Publicar, Cerrar ahora, Nueva versión, Archivar y Borrar (sólo un borrador o
// una plantilla en borrador), cada una con su permiso y
// su estado. Las funciones son las del núcleo (`data/encuestasClientes`), así
// que la base valida igual que desde el portal.
//
// Las notas opcionales y el motivo obligatorio se piden con el diálogo del
// sistema (`Alert.prompt`); lo irreversible (publicar, cerrar, archivar) pide
// confirmación.
import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import {
  archivarEncuesta, borrarEncuesta, cerrarEncuesta, duplicarEncuesta, enviarARevision, publicarEncuesta, revisarEncuesta,
} from '@nucleo/data/encuestasClientes';
import { encuestaBorrable } from '@nucleo/utils/encuestasClientes';
import { volver } from '../volver';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { fechaTexto } from '@nucleo/utils/fecha';
import { colorSistema } from '../Formulario';
import { MARCA } from '../inicio/marca';
import { fallo, listo } from '../Progreso';

// Qué botones le tocan a esta encuesta, con la misma regla del portal.
export function botonesDelCiclo(encuesta, { puedeEditar, puedeAprobar, sinProblemas = true }) {
  if (!encuesta) return [];
  const b = [];
  if (encuesta.es_plantilla) {
    if (puedeEditar) b.push({ k: 'usar', label: 'Crear encuesta con esta plantilla', color: MARCA.azul });
    if (encuestaBorrable(encuesta, puedeEditar)) b.push({ k: 'borrar', label: 'Borrar la plantilla', color: MARCA.rojo, borde: true });
    return b;
  }
  if (encuesta.estado === 'borrador' && puedeEditar) b.push({ k: 'enviar', label: 'Enviar a revisión', color: MARCA.azul, deshabilitado: !sinProblemas });
  if (encuesta.estado === 'en_revision' && puedeAprobar) {
    b.push({ k: 'aprobar', label: 'Aprobar', color: MARCA.verde });
    b.push({ k: 'rechazar', label: 'Devolver con cambios', color: MARCA.ambar, borde: true });
  }
  if (encuesta.estado === 'aprobada' && puedeEditar) b.push({ k: 'publicar', label: 'Publicar', color: MARCA.azul });
  if (encuesta.estado === 'publicada' && puedeEditar) b.push({ k: 'cerrar', label: 'Cerrar ahora', color: MARCA.rojo, borde: true });
  if (puedeEditar && encuesta.estado !== 'borrador') b.push({ k: 'version', label: 'Nueva versión', color: MARCA.azulClaro, borde: true });
  if (['borrador', 'aprobada', 'cerrada'].includes(encuesta.estado) && puedeEditar) b.push({ k: 'archivar', label: 'Archivar', color: colorSistema.texto2, borde: true });
  if (encuestaBorrable(encuesta, puedeEditar)) b.push({ k: 'borrar', label: 'Borrar el borrador', color: MARCA.rojo, borde: true });
  return b;
}

const pedirTexto = (titulo, mensaje, { obligatorio = false, boton = 'Aceptar' } = {}) => new Promise((resolve) => {
  Alert.prompt(titulo, mensaje, [
    { text: 'Cancelar', style: 'cancel', onPress: () => resolve(null) },
    { text: boton, onPress: (t) => {
      const v = String(t ?? '').trim();
      if (obligatorio && !v) { Alert.alert(titulo, 'Hace falta escribir el motivo.'); resolve(null); return; }
      resolve(v);
    } },
  ], 'plain-text');
});

const confirmar = (titulo, mensaje, boton, destructivo = false) => new Promise((resolve) => {
  Alert.alert(titulo, mensaje, [
    { text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
    { text: boton, style: destructivo ? 'destructive' : 'default', onPress: () => resolve(true) },
  ]);
});

/** Los botones del ciclo, apilados. `onHecho(nuevaId?)` recarga o abre la copia. */
export default function CicloDeEncuesta({ encuesta, sinProblemas = true, onHecho }) {
  const { hasPermission } = useAuth();
  const puedeEditar = hasPermission('encuestas_clientes', 'can_edit');
  const puedeAprobar = hasPermission('encuestas_clientes', 'can_approve');
  const [ocupado, setOcupado] = useState(false);
  const botones = botonesDelCiclo(encuesta, { puedeEditar, puedeAprobar, sinProblemas });
  if (!botones.length) return null;

  const correr = async (fn, exito) => {
    setOcupado(true);
    try {
      const r = await fn();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      listo(exito, encuesta.nombre);
      onHecho?.(r);
    } catch (e) {
      fallo('No se pudo completar', mensajeAmigable(e, 'Intenta de nuevo.'));
    } finally {
      setOcupado(false);
    }
  };

  const pulsar = async (k) => {
    Haptics.selectionAsync().catch(() => {});
    if (k === 'enviar') {
      const nota = await pedirTexto('Enviar a revisión', 'Gerencia recibe el aviso. Mientras la revisa, la encuesta no se puede editar. Nota para quien aprueba (opcional):', { boton: 'Enviar' });
      if (nota != null) correr(() => enviarARevision(encuesta.id, nota), 'Enviada a revisión');
    } else if (k === 'aprobar') {
      const c = await pedirTexto('Aprobar la encuesta', 'Quedará lista para publicarse tal como está. Comentario (opcional):', { boton: 'Aprobar' });
      if (c != null) correr(() => revisarEncuesta(encuesta.id, 'aprobar', c), 'Encuesta aprobada');
    } else if (k === 'rechazar') {
      const c = await pedirTexto('Devolver con cambios', 'Vuelve a borrador y quien la diseñó recibe tu comentario. ¿Qué hay que cambiar?', { obligatorio: true, boton: 'Devolver' });
      if (c) correr(() => revisarEncuesta(encuesta.id, 'rechazar', c), 'Encuesta devuelta');
    } else if (k === 'publicar') {
      const desde = encuesta.fecha_inicio ? ` desde el ${fechaTexto(encuesta.fecha_inicio, { day: 'numeric', month: 'long' })}` : ' hoy';
      if (await confirmar('Publicar la encuesta', `Empieza a recibir respuestas${desde}. Desde ahora sólo se puede cerrar.`, 'Publicar')) {
        correr(() => publicarEncuesta(encuesta.id), 'Encuesta publicada');
      }
    } else if (k === 'cerrar') {
      if (!(await confirmar('Cerrar la encuesta', 'Deja de recibir respuestas. No se puede reabrir: para repetirla, se duplica.', 'Cerrar', true))) return;
      const m = await pedirTexto('Cerrar la encuesta', 'Motivo (opcional):', { boton: 'Cerrar' });
      if (m != null) correr(() => cerrarEncuesta(encuesta.id, m), 'Encuesta cerrada');
    } else if (k === 'archivar') {
      if (await confirmar('Archivar la encuesta', 'Sale de la lista principal y queda en «Cerradas». No se borra nada.', 'Archivar')) {
        correr(() => archivarEncuesta(encuesta.id), 'Encuesta archivada');
      }
    } else if (k === 'borrar') {
      if (await confirmar(encuesta.es_plantilla ? 'Borrar la plantilla' : 'Borrar el borrador', 'Se borra con todas sus preguntas. No se puede deshacer.', 'Borrar', true)) {
        setOcupado(true);
        try {
          await borrarEncuesta(encuesta.id, encuesta.nombre);
          listo('Borrada', encuesta.nombre);
          volver('/encuestas-clientes');
        } catch (e) { fallo('No se pudo borrar', mensajeAmigable(e, 'Intenta de nuevo.')); }
        setOcupado(false);
      }
    } else if (k === 'version' || k === 'usar') {
      correr(() => duplicarEncuesta(encuesta.id), k === 'usar' ? 'Encuesta creada' : 'Versión nueva creada');
    }
  };

  return (
    <View style={{ marginHorizontal: 16, gap: 8 }}>
      {botones.map((b) => (
        <Pressable key={b.k} disabled={ocupado || b.deshabilitado} onPress={() => pulsar(b.k)} accessibilityRole="button"
          style={({ pressed }) => ({ minHeight: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18,
            backgroundColor: b.borde ? 'transparent' : b.color, borderWidth: b.borde ? 1.5 : 0, borderColor: b.color,
            opacity: ocupado || b.deshabilitado ? 0.45 : pressed ? 0.8 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
          <Text style={{ color: b.borde ? b.color : '#fff', fontSize: 16, fontWeight: '700' }}>{b.label}</Text>
        </Pressable>
      ))}
      {botones.some((b) => b.k === 'enviar' && b.deshabilitado) ? (
        <Text style={{ color: MARCA.ambar, fontSize: 13, marginHorizontal: 4 }}>Resuelve lo pendiente antes de enviarla.</Text>
      ) : null}
    </View>
  );
}

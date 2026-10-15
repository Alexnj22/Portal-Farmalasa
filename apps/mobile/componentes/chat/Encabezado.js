// Lo de arriba de la bandeja del chat, NATIVO — lo que el portal pone en el
// encabezado de `ChatClientesView`: el estado de la farmacia como lo ve el
// cliente (decide qué respuesta automática recibe quien escribe ahora), el
// feriado si lo hay, el promedio de calificaciones de 30 días, y los accesos a
// «Incumplimientos» (supervisión o quien edita el chat) y «Ajustes del chat»
// (quien edita). Los textos salen del núcleo (`textoDelEstado`,
// `resumenDeCalificaciones`), los mismos del portal.
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { fetchCalificacionesRecientes } from '@nucleo/data/chatClientes';
import { resumenDeCalificaciones } from '@nucleo/utils/chatClientes';
import { textoDelEstado } from '@nucleo/utils/horarioDelChat';
import { useRefrescoEnVivo } from '@nucleo/hooks/useRefrescoEnVivo';
import { Pildora } from '../avisos/Piezas';
import { MARCA } from '../inicio/marca';
import { colorSistema } from '../Formulario';
import Tocable from '../Tocable';

/** «Farmacia en línea · hasta las 10:00 p. m.» o «Fuera de horario · abre…», y el feriado. */
export function EstadoDeLaFarmacia({ estado }) {
  const linea = textoDelEstado(estado);
  if (!linea) return null;
  return (
    <>
      <Pildora texto={`${estado.abierta ? '●' : '☾'} ${linea.texto}`} color={linea.tono === 'success' ? MARCA.verde : colorSistema.texto2} />
      {linea.feriado ? <Pildora texto={`Feriado: ${linea.feriado}`} color={MARCA.ambar} /> : null}
    </>
  );
}

/** «★ 4.6 · 12 calificaciones en 30 días». Nada sin datos. */
export function ResumenDeCalificaciones() {
  const [resumen, setResumen] = useState(null);
  const leer = useCallback(async () => {
    try { setResumen(resumenDeCalificaciones(await fetchCalificacionesRecientes(30))); } catch { setResumen(null); }
  }, []);
  useEffect(() => { leer(); }, [leer]);
  // Reloj lento a propósito: el promedio de un mes no se mueve por minuto.
  useRefrescoEnVivo(leer, { ms: 300_000 });
  if (!resumen) return null;
  return <Pildora texto={`★ ${resumen.promedio.toFixed(1)} · ${resumen.cuantas} ${resumen.cuantas === 1 ? 'calificación' : 'calificaciones'} en 30 días`} color={MARCA.ambar} />;
}

function Acceso({ texto, ruta }) {
  return (
    <Tocable accessibilityRole="button" onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push(ruta); }}
      style={{ minHeight: 36, paddingHorizontal: 14, borderRadius: 18, justifyContent: 'center', backgroundColor: 'rgba(0,82,204,0.14)' }}>
      <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '700' }}>{texto}</Text>
    </Tocable>
  );
}

export default function Encabezado({ estado, veIncumplimientos, puedeEditar }) {
  return (
    <View style={{ marginHorizontal: 16, gap: 8 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <EstadoDeLaFarmacia estado={estado} />
        <ResumenDeCalificaciones />
      </View>
      {veIncumplimientos || puedeEditar ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {veIncumplimientos ? <Acceso texto="Incumplimientos" ruta="/chat-clientes/incumplimientos" /> : null}
          {puedeEditar ? <Acceso texto="Ajustes del chat" ruta="/chat-clientes/ajustes" /> : null}
        </View>
      ) : null}
    </View>
  );
}

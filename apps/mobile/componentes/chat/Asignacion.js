// Quién quedó asignado a una conversación y hasta dónde subió la espera
// (2026-10-14, migración `chat_asignacion_y_aviso_mayorista`).
//
// `asignada_a` es el primer empleado que contestó: no cambia si contesta otro y
// se libera al resolver; no bloquea a nadie, así que se dice como dato, no como
// candado. La escalera la sube un cron con la farmacia abierta: 15 min sin
// respuesta → aviso a la sala del asignado; 20 min → aviso a supervisión. Se
// muestra discreto, con su hora, para que quien abre sepa que ya avisaron.
import { Text, View } from 'react-native';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { hora12 } from '@nucleo/utils/hora';
import { asignadoDe, escaladaDe } from '@nucleo/utils/chatPersonal';
import Avatar from '../Avatar';
import { colorSistema } from '../Formulario';
import { MARCA } from '../inicio/marca';

/**
 * @param {object} conversacion  fila de `chat_conversaciones()`
 * @param {Map} equipo           employees por id
 * @param {boolean} [sinAsignar] mostrar «Sin asignar» cuando no hay (la conversación sí; la bandeja no)
 */
export default function Asignacion({ conversacion: c, equipo, sinAsignar = false }) {
  const id = asignadoDe(c);
  const quien = id ? equipo?.get(id) ?? { id } : null;
  const escalada = escaladaDe(c);
  if (!quien && !escalada && !sinAsignar) return null;
  const colorEscalada = escalada?.nivel === 'supervision' ? MARCA.rojo : MARCA.ambar;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
      {quien ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <Avatar empleado={quien} tamano={18} />
          <Text style={{ color: colorSistema.texto2, fontSize: 12 }} numberOfLines={1}>
            {'Asignado a '}<Text style={{ fontWeight: '700', color: colorSistema.texto }}>{shortEmployeeName(quien) || 'alguien del equipo'}</Text>
          </Text>
        </View>
      ) : sinAsignar ? (
        <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>Sin asignar</Text>
      ) : null}
      {escalada ? (
        <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: `${colorEscalada}26` }}>
          <Text style={{ color: colorEscalada, fontSize: 11, fontWeight: '700' }}>{`${escalada.texto} · ${hora12(escalada.at)}`}</Text>
        </View>
      ) : null}
    </View>
  );
}

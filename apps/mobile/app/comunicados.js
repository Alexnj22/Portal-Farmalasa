// Mis avisos (comunicados), NATIVO — `EmployeeAnnouncementsView`: los
// comunicados internos que le tocan a esta persona. «Sin leer» en el orden del
// mazo del portal (urgentes primero, del más viejo al más nuevo) y «Leídos»
// del mes con sus subfiltros (urgentes, global, sucursal, cargo, personal) y
// «Ver anteriores». Cada tarjeta trae lo mismo que la del portal: urgente,
// «Actualización» si cambió después de leerlo, el destino, el texto, el
// detalle de la solicitud que lo originó, la fecha y si fue editado.
//
// Marcar leído usa `markAnnouncementAsRead`, la MISMA del store (la escritura
// la hace el servidor). Como el mazo del portal, se puede deshacer: el aviso se
// aparta y la marca sale a los 5 s si no se toca «Deshacer».
//
// Qué le toca y cada pestaña salen del núcleo (`misComunicados`).
//
// Ojo: la pestaña «Avisos» de la app son las NOTIFICACIONES; esto es otra cosa
// (en el portal, `/mis-avisos`).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import {
  TIPO_DE_CONSTANCIA, aplicarFiltroDeLeidos, comunicadosDeLaPersona, comunicadosDeLaPestana,
  destinoDelComunicado, filtrosDeLeidos, hayLeidosViejos, loLeyoAntesDeEditarse, yaLoLeyo,
} from '@nucleo/utils/misComunicados';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { BotonGrande } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import { MenuDeFiltros } from '../componentes/Filtros';
import Segmentos from '../componentes/Segmentos';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';

const PESTANAS = [{ id: 'UNREAD', label: 'Sin leer' }, { id: 'READ', label: 'Leídos' }];
const corta = (d) => (d ? fechaTexto(d, { weekday: 'short', day: '2-digit', month: 'short' }) : null);
const DESTINO_COLOR = { GLOBAL: MARCA.azulClaro, BRANCH: MARCA.verde, ROLE: MARCA.violetaClaro };

function DetalleDeSolicitud({ meta }) {
  if (!meta?.requestType) return null;
  const aprobada = meta.status === 'APPROVED';
  const lineas = [];
  if (meta.requestType === 'SHIFT_CHANGE') {
    if (meta.targetEmployeeName) lineas.push(`Con: ${meta.targetEmployeeName}`);
    if (meta.date) lineas.push(corta(meta.date));
    if (meta.myShift || meta.targetShift) {
      const tuyo = meta.myShift && meta.myShift !== 'No especificado' ? meta.myShift : '—';
      const otro = meta.targetShift && meta.targetShift !== 'No especificado' ? meta.targetShift : '—';
      lineas.push(`Tu turno: ${tuyo} · El de ${meta.targetEmployeeName?.split(' ')[0] || 'tu compañero'}: ${otro}`);
    }
  } else if ((meta.requestType === 'VACATION' || meta.requestType === 'DISABILITY') && meta.startDate) {
    const rango = meta.endDate && meta.endDate !== meta.startDate ? `${corta(meta.startDate)} — ${corta(meta.endDate)}` : corta(meta.startDate);
    lineas.push(meta.requestType === 'DISABILITY' && meta.days ? `${rango} (${meta.days} días)` : rango);
  } else if (meta.requestType === 'PERMIT' && meta.permissionDates?.length) {
    lineas.push(meta.permissionDates.map(corta).join(' · '));
  } else if (meta.requestType === 'ADVANCE' && meta.amount) {
    lineas.push(formatMoney(meta.amount));
  } else if (meta.requestType === 'CERTIFICATE' && meta.certificateType) {
    lineas.push(TIPO_DE_CONSTANCIA[meta.certificateType] || meta.certificateType);
  }
  if (!lineas.length) return null;
  return (
    <View style={{ borderRadius: 12, padding: 10, gap: 3, backgroundColor: aprobada ? 'rgba(18,183,106,0.14)' : 'rgba(240,68,56,0.14)' }}>
      {lineas.map((l, i) => <Text key={i} style={{ color: colorSistema.texto, fontSize: 14, fontWeight: i ? '400' : '600' }}>{l}</Text>)}
    </View>
  );
}

function Tarjeta({ a, userId, onLeer }) {
  const leido = yaLoLeyo(a, userId);
  const urgente = a.priority === 'URGENT';
  return (
    <View style={{ marginHorizontal: 16 }}>
      <Vidrio radio={20} tinte={urgente && !leido ? 'rgba(240,68,56,0.16)' : undefined}>
        <View style={{ padding: 14, gap: 10 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: leido ? colorSistema.texto2 : urgente ? MARCA.rojo : MARCA.azulClaro }} />
            {urgente ? <Pildora texto="Urgente" color={MARCA.rojo} /> : null}
            {loLeyoAntesDeEditarse(a, userId) ? <Pildora texto="Actualización" color={MARCA.ambar} /> : null}
            <Pildora texto={destinoDelComunicado(a)} color={DESTINO_COLOR[a.targetType] || MARCA.violeta} />
          </View>
          <View style={{ gap: 4 }}>
            <Text style={{ color: leido ? colorSistema.texto2 : colorSistema.texto, fontSize: 18, fontWeight: '700' }}>{a.title}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 15, lineHeight: 21 }}>{a.message}</Text>
          </View>
          <DetalleDeSolicitud meta={a.metadata} />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <Text style={{ color: colorSistema.texto2, fontSize: 12, flex: 1 }}>
              {fechaTexto(a.date, { day: '2-digit', month: 'short', year: 'numeric' })}
              {a.editedAt ? ` · editado ${fechaTexto(a.editedAt, { day: '2-digit', month: 'short' })}` : ''}
            </Text>
            {leido ? <Pildora texto="Leído" color={MARCA.verde} /> : (
              <Pressable onPress={() => onLeer(a)} hitSlop={8} accessibilityRole="button"
                style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', paddingHorizontal: 6, transform: [{ scale: pressed ? 0.96 : 1 }] })}>
                <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '700' }}>Marcar leído</Text>
              </Pressable>
            )}
          </View>
        </View>
      </Vidrio>
    </View>
  );
}

export default function Comunicados() {
  const { user } = useAuth();
  const comunicados = useStaffStore((s) => s.announcements);
  const roles = useStaffStore((s) => s.roles);
  const marcar = useStaffStore((s) => s.markAnnouncementAsRead);
  const recargar = useStaffStore((s) => s.fetchBoot);
  const [pestana, setPestana] = useState('UNREAD');
  const [filtro, setFiltro] = useState('ALL');
  const [verViejos, setVerViejos] = useState(false);
  const [texto, setTexto] = useState('');
  const [apartados, setApartados] = useState([]); // [{ id, timer }] — la ventana de «Deshacer»
  const [recargando, setRecargando] = useState(false);
  const apartadosRef = useRef(apartados);
  useEffect(() => { apartadosRef.current = apartados; }, [apartados]);
  // Al salir, lo apartado se marca ya: que no vuelva como «sin leer».
  useEffect(() => () => {
    apartadosRef.current.forEach((p) => { clearTimeout(p.timer); if (user?.id) marcar(p.id, user.id); });
  }, [marcar, user?.id]);

  const mios = useMemo(() => comunicadosDeLaPersona(comunicados, user, roles || []), [comunicados, user, roles]);
  const dePestana = useMemo(() => comunicadosDeLaPestana(mios, pestana, user?.id, { verViejos }), [mios, pestana, user?.id, verViejos]);
  const filtros = useMemo(() => (pestana === 'READ' ? filtrosDeLeidos(dePestana) : []), [pestana, dePestana]);
  const lista = useMemo(() => {
    const ocultos = new Set(apartados.map((p) => p.id));
    return aplicarFiltroDeLeidos(dePestana, pestana === 'READ' ? filtro : 'ALL')
      .filter((a) => !ocultos.has(a.id))
      .filter((a) => !texto.trim() || tokenMatch(texto.trim(), a.title, a.message));
  }, [dePestana, pestana, filtro, apartados, texto]);
  const sinLeer = useMemo(() => comunicadosDeLaPestana(mios, 'UNREAD', user?.id).length, [mios, user?.id]);

  const leer = (a) => {
    if (!user?.id) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    const timer = setTimeout(() => {
      marcar(a.id, user.id);
      setApartados((prev) => prev.filter((p) => p.id !== a.id));
    }, 5000);
    setApartados((prev) => [...prev, { id: a.id, timer }]);
  };
  const deshacer = () => {
    const ultimo = apartados[apartados.length - 1];
    if (!ultimo) return;
    clearTimeout(ultimo.timer);
    setApartados((prev) => prev.slice(0, -1));
  };
  const leerTodos = () => Alert.alert('¿Marcar todos como leídos?', `Son ${lista.length} aviso${lista.length === 1 ? '' : 's'} sin leer.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Marcar', onPress: () => { lista.forEach((a) => marcar(a.id, user.id)); } },
  ]);

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Mis avisos', headerLargeTitle: true,
        headerSearchBarOptions: { placeholder: 'Buscar en los avisos', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto('') },
      }} />
      {pestana === 'READ' ? (
        <MenuDeFiltros grupos={[{ id: 'tipo', titulo: 'Mostrar', porDefecto: 'ALL', activa: filtro, onCambiar: setFiltro,
          opciones: filtros.map((f) => ({ id: f.key, label: `${f.label} · ${f.count}` })) }]} />
      ) : null}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await Promise.resolve(recargar?.({ force: true })).catch(() => {}); setRecargando(false); }} />}>
        <Segmentos opciones={PESTANAS.map((p) => ({ ...p, label: p.id === 'UNREAD' && sinLeer ? `Sin leer · ${sinLeer}` : p.label }))}
          activa={pestana} onCambiar={(v) => { setPestana(v); setFiltro('ALL'); }} />
        {apartados.length ? (
          <View style={{ marginHorizontal: 16 }}>
            <BotonGrande texto={`Deshacer · ${apartados.length} marcado${apartados.length === 1 ? '' : 's'}`} borde color={MARCA.azulClaro} onPress={deshacer} />
          </View>
        ) : null}
        {lista.map((a) => <Tarjeta key={a.id} a={a} userId={user?.id} onLeer={leer} />)}
        {!lista.length ? (
          <View style={{ alignItems: 'center', marginTop: 40, gap: 6, paddingHorizontal: 32 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '700' }}>{pestana === 'UNREAD' && !texto.trim() ? '¡Todo al día!' : 'Nada por aquí'}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 15, textAlign: 'center' }}>
              {pestana === 'UNREAD' && !texto.trim() ? 'Leíste todos tus avisos. Nada se te escapa.' : texto.trim() ? 'Ningún aviso con ese texto.' : 'No hay avisos leídos este mes.'}
            </Text>
          </View>
        ) : null}
        {pestana === 'UNREAD' && lista.length > 1 ? (
          <View style={{ marginHorizontal: 16 }}><BotonGrande texto="Marcar todos como leídos" borde color={MARCA.verde} onPress={leerTodos} /></View>
        ) : null}
        {pestana === 'READ' && !verViejos && hayLeidosViejos(mios, user?.id) ? (
          <View style={{ marginHorizontal: 16 }}><BotonGrande texto="Ver los de meses anteriores" borde color={MARCA.azulClaro} onPress={() => setVerViejos(true)} /></View>
        ) : null}
      </ScrollView>
    </>
  );
}

// Los kioscos de marcación de una sucursal, NATIVO — `FormDispositivos` del
// portal («Dispositivos Kiosco»): los equipos vinculados con su fecha, el cupo
// «N / 3» y Revocar. Vincular un equipo NO se hace acá: se hace iniciando
// sesión en la tablet de la sala, igual que en el portal.
//
// Revocar deja ese equipo sin poder marcar en el acto, así que pide
// confirmación, y si es el ÚLTIMO de la sala pide una segunda: la sucursal se
// queda sin dónde marcar hasta que alguien vincule otro.
// Revocar exige editar sucursales (`branches`), igual que el botón del portal
// en la ficha de la sucursal.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useStaffStore } from '@nucleo/store/staffStore';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchBranchKiosks } from '@nucleo/data/branches';
import { cupoDeKioscos, kioscosActivos } from '@nucleo/utils/kioscos';
import { fechaTexto } from '@nucleo/utils/fecha';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, Seccion } from '../../componentes/formulario/Piezas';
import { Insignia, Pildora } from '../../componentes/avisos/Piezas';
import { MARCA } from '../../componentes/inicio/marca';

// Un Alert envuelto en promesa: `true` sólo si se tocó el botón de acción.
const preguntar = (titulo, mensaje, boton) => new Promise((resolver) => {
  Alert.alert(titulo, mensaje, [
    { text: 'Cancelar', style: 'cancel', onPress: () => resolver(false) },
    { text: boton, style: 'destructive', onPress: () => resolver(true) },
  ], { cancelable: true, onDismiss: () => resolver(false) });
});

function Equipo({ k, primero, puedeRevocar, ocupado, onRevocar }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: primero ? 0 : 0.5, borderTopColor: colorSistema.separador, paddingTop: primero ? 0 : 10 }}>
      <Insignia icono="Monitor" color={MARCA.violetaClaro} tamano={40} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }} numberOfLines={1}>{k.device_name || 'Equipo sin nombre'}</Text>
        <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Vinculado: {fechaTexto(k.created_at)}</Text>
      </View>
      {puedeRevocar ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Revocar ${k.device_name || 'equipo'}`} disabled={ocupado} onPress={onRevocar}
          style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: MARCA.rojo,
            opacity: ocupado ? 0.5 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
          <Text style={{ color: MARCA.rojo, fontSize: 15, fontWeight: '700' }}>Revocar</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export default function Kioscos() {
  const { id } = useLocalSearchParams();
  const puedeRevocar = !!useAuth().hasPermission?.('branches', 'can_edit');
  const branches = useStaffStore((s) => s.branches);
  const revokeKioskDevice = useStaffStore((s) => s.revokeKioskDevice);
  const b = useMemo(() => (branches || []).find((x) => String(x.id) === String(id)), [branches, id]);
  const [lista, setLista] = useState(null);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(null);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(() => Promise.resolve(fetchBranchKiosks(id))
    .then(({ data, error: e }) => { if (e) throw e; setLista(data || []); setError(''); })
    .catch(() => { setLista((l) => l ?? []); setError('No se pudo cargar la lista de equipos.'); }), [id]);
  useEffect(() => { cargar(); }, [cargar]);

  const activos = useMemo(() => kioscosActivos(lista), [lista]);
  const cupo = cupoDeKioscos(lista);

  const revocar = async (k) => {
    const nombre = k.device_name || 'este equipo';
    const ultimo = activos.length === 1;
    const si = await preguntar(`¿Revocar «${nombre}»?`,
      'Ese equipo deja de poder marcar asistencia en el acto. Para volver a usarlo hay que vincularlo otra vez iniciando sesión en la tablet.', 'Revocar');
    if (!si) return;
    if (ultimo) {
      const seguro = await preguntar('Es el último equipo de la sala',
        `${b?.name ?? 'La sucursal'} se queda sin ningún kiosco: nadie podrá marcar ahí hasta que se vincule otro. ¿Revocarlo igual?`, 'Sí, revocar');
      if (!seguro) return;
    }
    setOcupado(k.id);
    const ok = await Promise.resolve(revokeKioskDevice(k.id, k.device_name)).catch(() => false);
    setOcupado(null);
    if (ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setLista((l) => (l || []).filter((x) => x.id !== k.id));
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setError('No se pudo revocar el kiosco.');
    }
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Kioscos', headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 4 }}>
          <Text style={{ color: colorSistema.texto, fontSize: 22, fontWeight: '800', flex: 1 }} numberOfLines={1}>{b?.name ?? 'Sucursal'}</Text>
          {lista ? <Pildora texto={`${cupo.rotulo} activos`} color={cupo.activos ? MARCA.verde : colorSistema.texto2} /> : null}
        </View>
        {error ? <Aviso tono="freno" texto={error} /> : null}
        {lista == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : (
          <Seccion titulo="Dispositivos aprobados"
            pie={cupo.lleno ? `La sala ya tiene ${cupo.limite} equipos: para vincular otro hay que revocar uno.` : 'Para vincular un equipo, inicia sesión en la tablet de la sucursal.'}>
            {activos.length ? activos.map((k, i) => (
              <Equipo key={k.id} k={k} primero={i === 0} puedeRevocar={puedeRevocar} ocupado={ocupado === k.id} onRevocar={() => revocar(k)} />
            )) : (
              <View style={{ alignItems: 'center', gap: 6, paddingVertical: 14 }}>
                <Insignia icono="Monitor" color={colorSistema.texto2} />
                <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>Ningún equipo conectado</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 14, textAlign: 'center' }}>Inicia sesión en la tablet de la sucursal para vincularla.</Text>
              </View>
            )}
          </Seccion>
        )}
      </ScrollView>
    </>
  );
}

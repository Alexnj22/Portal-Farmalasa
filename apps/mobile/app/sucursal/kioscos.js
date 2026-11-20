// Los equipos de una sucursal, NATIVO — `FormDispositivos` del portal
// («Dispositivos Kiosco»): los marcadores y el kiosco de caja vinculados, con
// su fecha, el cupo de cada tipo y Revocar.
//
// Vincular un equipo, como el portal (2026-11-17): quien tiene
// `kiosco_vincular` elige el tipo y manda un ticket a la ticketera de la
// sucursal (`emitirTicketDeVinculacion` + `construirTicketDeVinculacion`, el
// mismo papel del portal), por la cola de la sala (`imprimirEnLaSala`). El
// ticket se escanea en el equipo, sirve una vez y vence en 15 minutos. Queda en
// la bitácora como `KIOSCO_TICKET_EMITIDO`, igual que en el portal.
//
// Revocar deja ese equipo sin poder marcar en el acto, así que pide
// confirmación, y si es el ÚLTIMO de su tipo en la sala pide una segunda.
// Revocar exige editar sucursales (`branches`), igual que el botón del portal
// en la ficha de la sucursal.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { Presionable as Pressable } from '../../componentes/Tocable';
import Refrescar from '../../componentes/Refrescar';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useStaffStore } from '@nucleo/store/staffStore';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchBranchKiosks } from '@nucleo/data/branches';
import { emitirTicketDeVinculacion } from '@nucleo/data/kioskAuth';
import { construirTicketDeVinculacion } from '@nucleo/utils/ticketDeVinculacion';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { hora12 } from '@nucleo/utils/hora';
import { cupoDeKioscos, kioscosActivos, rotuloDeKiosco, tipoDeKiosco, TIPOS_DE_KIOSCO } from '@nucleo/utils/kioscos';
import { fechaTexto } from '@nucleo/utils/fecha';
import { imprimirEnLaSala } from '../../componentes/imprimir';
import Segmentos from '../../componentes/Segmentos';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Seccion, Cargando } from '../../componentes/formulario/Piezas';
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
      <Insignia icono={tipoDeKiosco(k) === TIPOS_DE_KIOSCO.CAJA ? 'Receipt' : 'Monitor'} color={MARCA.violetaClaro} tamano={40} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }} numberOfLines={1}>{k.device_name || 'Equipo sin nombre'}</Text>
        <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={1}>{rotuloDeKiosco(tipoDeKiosco(k))} · vinculado el {fechaTexto(k.created_at)}</Text>
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
  const { user, hasPermission } = useAuth();
  const puedeRevocar = !!hasPermission?.('branches', 'can_edit');
  const puedeVincular = !!hasPermission?.('kiosco_vincular');
  const appendAuditLog = useStaffStore((s) => s.appendAuditLog);
  const branches = useStaffStore((s) => s.branches);
  const revokeKioskDevice = useStaffStore((s) => s.revokeKioskDevice);
  const b = useMemo(() => (branches || []).find((x) => String(x.id) === String(id)), [branches, id]);
  const [lista, setLista] = useState(null);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(null);
  const [recargando, setRecargando] = useState(false);
  const [tipoTicket, setTipoTicket] = useState(TIPOS_DE_KIOSCO.CAJA);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(null);

  const cargar = useCallback(() => Promise.resolve(fetchBranchKiosks(id))
    .then(({ data, error: e }) => { if (e) throw e; setLista(data || []); setError(''); })
    .catch(() => { setLista((l) => l ?? []); setError('No se pudo cargar la lista de equipos.'); }), [id]);
  useEffect(() => { cargar(); }, [cargar]);

  // Los dos tipos: el kiosco de caja también es un equipo de la sucursal y se
  // desconecta desde aquí. El cupo es por tipo.
  const activos = useMemo(() => kioscosActivos(lista, null), [lista]);
  const cupoMarcadores = cupoDeKioscos(lista, TIPOS_DE_KIOSCO.MARCACION);
  const cupoCaja = cupoDeKioscos(lista, TIPOS_DE_KIOSCO.CAJA);
  const cupoElegido = tipoTicket === TIPOS_DE_KIOSCO.CAJA ? cupoCaja : cupoMarcadores;

  const imprimirTicket = async () => {
    setEnviando(true);
    setEnviado(null);
    setError('');
    try {
      const t = await emitirTicketDeVinculacion(id, tipoTicket);
      if (!t.ok) { setError(t.motivo); return; }
      const sala = b?.name || '';
      const r = await imprimirEnLaSala(construirTicketDeVinculacion({
        codigo: t.codigo, tipo: t.tipo, sala, nombre: t.device_name, venceAt: t.vence_at,
        emitidoPor: user ? shortEmployeeName(user) : '',
      }), id, `VINCULAR ${sala}`);
      appendAuditLog?.('KIOSCO_TICKET_EMITIDO', id, { tipo: t.tipo, vence_at: t.vence_at, impreso: !!r?.ok });
      if (!r?.ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        setError(r?.detalle || `La ticketera de ${sala || 'la sucursal'} no recibió el ticket.`);
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setEnviado({ tipo: t.tipo, vence: t.vence_at });
    } catch {
      setError('No se pudo enviar el ticket. Intenta de nuevo.');
    } finally {
      setEnviando(false);
    }
  };

  const revocar = async (k) => {
    const nombre = k.device_name || 'este equipo';
    const ultimo = activos.filter((x) => tipoDeKiosco(x) === tipoDeKiosco(k)).length === 1;
    const si = await preguntar(`¿Revocar «${nombre}»?`,
      'Ese equipo deja de funcionar en el acto. Para volver a usarlo hay que vincularlo otra vez con un ticket.', 'Revocar');
    if (!si) return;
    if (ultimo) {
      const caja = tipoDeKiosco(k) === TIPOS_DE_KIOSCO.CAJA;
      const seguro = await preguntar(caja ? 'Es el único kiosco de caja' : 'Es el último marcador de la sucursal',
        caja ? `${b?.name ?? 'La sucursal'} se queda sin kiosco de caja hasta que se vincule otro. ¿Revocarlo igual?`
          : `${b?.name ?? 'La sucursal'} se queda sin marcador. Nadie podrá marcar ahí hasta que se vincule otro. ¿Revocarlo igual?`, 'Sí, revocar');
      if (!seguro) return;
    }
    setOcupado(k.id);
    const ok = await Promise.resolve(revokeKioskDevice(k.id, k.device_name, k.branch_id)).catch(() => false);
    setOcupado(null);
    if (ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setLista((l) => (l || []).filter((x) => x.id !== k.id));
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setError('No se pudo revocar el marcador.');
    }
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Equipos', headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic"
        refreshControl={<Refrescar refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 4 }}>
          <Text style={{ color: colorSistema.texto, fontSize: 22, fontWeight: '800', flex: 1 }} numberOfLines={1}>{b?.name ?? 'Sucursal'}</Text>
        </View>
        {lista ? (
          <View style={{ flexDirection: 'row', gap: 6, marginHorizontal: 4, flexWrap: 'wrap' }}>
            <Pildora texto={`Marcadores ${cupoMarcadores.activos} de ${cupoMarcadores.limite}`} color={cupoMarcadores.lleno ? MARCA.ambar : MARCA.verde} />
            <Pildora texto={`Caja ${cupoCaja.activos} de ${cupoCaja.limite}`} color={cupoCaja.lleno ? MARCA.azulClaro : colorSistema.texto2} />
          </View>
        ) : null}
        {error ? <Aviso tono="freno" texto={error} /> : null}
        {puedeVincular && lista ? (
          <Seccion titulo="Vincular un equipo"
            pie="Sale un ticket en la caja de la sucursal. Se escanea en el equipo, sin iniciar sesión. Sirve una vez y vence en 15 minutos.">
            {/* seccion-en-linea: elección del tipo de equipo dentro del formulario */}
            <Segmentos margen={0} activa={tipoTicket} onCambiar={(v) => { setTipoTicket(v); setEnviado(null); }}
              opciones={[{ id: TIPOS_DE_KIOSCO.CAJA, label: 'Kiosco de caja' }, { id: TIPOS_DE_KIOSCO.MARCACION, label: 'Marcador' }]} />
            {cupoElegido.lleno ? (
              <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>
                {tipoTicket === TIPOS_DE_KIOSCO.CAJA ? 'La sucursal ya tiene su kiosco de caja.' : `La sucursal ya tiene ${cupoMarcadores.limite} marcadores.`} Para vincular otro, revoca uno.
              </Text>
            ) : null}
            <BotonGrande texto={enviando ? 'Enviando…' : 'Imprimir ticket en la sucursal'} deshabilitado={enviando || cupoElegido.lleno} onPress={imprimirTicket} />
            {enviado ? <Text style={{ color: MARCA.verde, fontSize: 14, fontWeight: "600" }}>Ticket enviado. Escanéalo antes de las {hora12(enviado.vence)}.</Text> : null}
          </Seccion>
        ) : null}
        {lista == null ? <Cargando /> : (
          <Seccion titulo="Dispositivos aprobados"
>
            {activos.length ? activos.map((k, i) => (
              <Equipo key={k.id} k={k} primero={i === 0} puedeRevocar={puedeRevocar} ocupado={ocupado === k.id} onRevocar={() => revocar(k)} />
            )) : (
              <View style={{ alignItems: 'center', gap: 6, paddingVertical: 14 }}>
                <Insignia icono="Monitor" color={colorSistema.texto2} />
                <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>Sin equipos vinculados</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 14, textAlign: 'center' }}>{puedeVincular ? 'Imprime un ticket y escanéalo en el equipo.' : 'Pide al supervisor el ticket para vincular el equipo.'}</Text>
              </View>
            )}
          </Seccion>
        )}
      </ScrollView>
    </>
  );
}

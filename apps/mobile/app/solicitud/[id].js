// Una solicitud, nativa: lo que abre tocarla en la bandeja o en un aviso — y
// donde se decide. Es el `ModalSolicitud` + `DetalleSolicitud` del portal.
//
// Decisión del usuario del 2026-09-30: «quitemos las aprobaciones desde ahí
// [la notificación], lo siento raro, y mejoremos la experiencia en lo nativo
// de la app». La notificación informa; esta pantalla muestra TODO y decide.
//
// De arriba abajo, el orden del portal:
//   1. quién la mandó y en manos de quién está (`PersonasDeSolicitud`);
//   2. el cuerpo por tipo —renglones con lote y vencimiento, fotos, la venta,
//      el MIN/MAX de hoy y el propuesto con sus ventas y su despacho, lo
//      aplicado, lo recibido, el rechazo y el historial— (`DetalleDeAviso`, el
//      mismo cuerpo que despliega la campana);
//   3. lo que el portal agrega fuera de la campana (`ExtrasDelDetalle`): el
//      motivo de anulación, el pago de antes y el nuevo, los PUNTOS de un cambio
//      de cliente y el motivo de quien la envió;
//   4. la decisión: qué entra y cuánto (`QueEntra`, la aprobación PARCIAL),
//      el motivo cuando hace falta, y los botones. Aprobar APLICA de una; sólo
//      rechazar es un paso aparte, porque exige escribir por qué.
//
// Las reglas son las del núcleo, iguales al portal: quién decide
// (`utils/accionesDeAviso`), qué es un parcial y qué índices viajan
// (`utils/decisionDeSolicitud`) y la decisión misma (`decidirSolicitud`).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Host, Icon } from '@expo/ui';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { cargarFilaDeAviso } from '@nucleo/data/solicitudDeAviso';
import { detalleDeMinMax, detalleDeSolicitud } from '@nucleo/utils/tarjetaDeSolicitud';
import { puedeDecidirAviso } from '@nucleo/utils/accionesDeAviso';
import { REQUEST_STATUS, REQUEST_TYPES, adaptarMinMax } from '@nucleo/store/slices/requestsSlice';
import { buscadorDePersonas, esParcial, fmtFechaHora } from '@nucleo/utils/movimientoTexto';
import { deQuienEs } from '@nucleo/utils/bandejaDeSolicitudes';
import {
  acotarCantidad, ajustesPosibles, cantidadesIniciales, esAbonoPorConfirmar, faltaMotivo,
  lineasDeDecision, resumenDeDecision, rotulosDeDecision, seleccionInicial,
} from '@nucleo/utils/decisionDeSolicitud';
import { nombreDelIconoDeTipo } from '@nucleo/constants/tipoIconos';
import { ERP_NAMES } from '@nucleo/constants/erp';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Campo } from '../../componentes/formulario/Piezas';
import { usePorDecidir } from '../../componentes/porDecidir';
import DetalleDeAviso from '../../componentes/avisos/DetalleDeAviso';
import PersonasDeSolicitud from '../../componentes/solicitudes/Personas';
import ExtrasDelDetalle from '../../componentes/solicitudes/ExtrasDelDetalle';
import QueEntra from '../../componentes/solicitudes/QueEntra';
import { cancelarPropia, decidirConAjustes } from '../../componentes/solicitudes/decidir';
import { ICONO } from '../../componentes/solicitudes/iconos';
import Vidrio from '../../componentes/Vidrio';
import { MARCA } from '../../componentes/inicio/marca';
import { iconoDe } from '../../tema/iconos';

const COLOR_ESTADO = { PENDING: MARCA.ambar, APPROVED: MARCA.verde, REJECTED: MARCA.rojo, CANCELLED: '#8E8E93' };

function Boton({ texto, color, relleno, onPress, deshabilitado, icono }) {
  return (
    <Pressable disabled={deshabilitado} onPress={onPress} accessibilityRole="button"
      style={({ pressed }) => ({ flex: 1, minHeight: 50, borderRadius: 25, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14,
        backgroundColor: relleno ? color : 'transparent', borderWidth: relleno ? 0 : 1.5, borderColor: color,
        opacity: deshabilitado ? 0.4 : pressed ? 0.8 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
      {icono ? <Host matchContents><Icon name={icono} size={16} color={relleno ? '#fff' : color} /></Host> : null}
      <Text style={{ color: relleno ? '#fff' : color, fontSize: 17, fontWeight: '700' }}>{texto}</Text>
    </Pressable>
  );
}

export default function Solicitud() {
  const { id } = useLocalSearchParams();
  const clave = String(id ?? '');
  const esMinMax = clave.startsWith('minmax:');
  const idReal = esMinMax ? clave.slice(7) : clave;
  const { user, hasPermission } = useAuth();
  const empleados = useStaffStore((s) => s.employees);
  const personasDeSolicitudes = useStaffStore((s) => s.personasDeSolicitudes);
  const resolverPersonas = useStaffStore((s) => s.resolverPersonasDeSolicitudes);
  const [fila, setFila] = useState(undefined);   // undefined = cargando, null = no está
  const [error, setError] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [recargando, setRecargando] = useState(false);
  const [rechazando, setRechazando] = useState(false);
  const [nota, setNota] = useState('');
  const [ajuste, setAjuste] = useState(null);   // { lineas, seleccion, cantidades }
  const [vuelta, setVuelta] = useState(0);      // remonta el cuerpo al recargar

  const cargar = useCallback(async () => {
    try {
      setError(null);
      setFila(await cargarFilaDeAviso({ metadata: { request_id: idReal, request_type: esMinMax ? 'MINMAX' : null } }));
    } catch (e) {
      setError(e?.message ?? String(e));
      setFila(null);
    }
  }, [idReal, esMinMax]);
  useEffect(() => { cargar(); }, [cargar]);

  // Un traslado tiene su propia pantalla (contestar con cantidades, recibir
  // anotando lo que faltó): ésta sólo sabría «enviar todo».
  useEffect(() => {
    if (fila?.type === 'INVENTORY_TRANSFER_REQUEST') router.replace({ pathname: '/traslado/[id]', params: { id: String(fila.id) } });
    if (fila?.type === 'INVENTORY_TRANSFER_PUSH') router.replace({ pathname: '/envio/[id]', params: { id: String(fila.id) } });
  }, [fila]);

  // Las dos personas pueden no estar en el maestro (los cargos `is_su` no se
  // listan): se piden aparte, sólo las que falten.
  useEffect(() => {
    if (!fila || !resolverPersonas) return;
    if (esMinMax) resolverPersonas([fila.requested_by_id], [fila.decided_by]);
    else resolverPersonas([fila.employee_id, fila.approver_id]);
  }, [fila, esMinMax, resolverPersonas]);

  const porId = useMemo(() => {
    const m = new Map();
    (empleados ?? []).forEach((e) => m.set(String(e.id), e));
    Object.entries(personasDeSolicitudes || {}).forEach(([k, p]) => { if (!m.has(k)) m.set(k, p); });
    return m;
  }, [empleados, personasDeSolicitudes]);

  // La solicitud en la forma común (la del portal): Min/Max por su adaptador.
  const req = useMemo(() => {
    if (!fila) return null;
    if (esMinMax) {
      const enElMaestro = buscadorDePersonas(empleados);
      return adaptarMinMax(fila, (sid) => ERP_NAMES[sid],
        (k) => enElMaestro(k) ?? (k ? (personasDeSolicitudes?.[String(k)] ?? null) : null));
    }
    return { ...fila, employee: porId.get(String(fila.employee_id)) ?? null, approver: porId.get(String(fila.approver_id)) ?? null };
  }, [fila, esMinMax, empleados, porId, personasDeSolicitudes]);

  // Qué entra y cuánto. Arranca con TODO marcado y completo, y vuelve a eso
  // cuando llega otra fila: el ajuste vale sólo para las líneas sobre las que
  // se hizo (sin un efecto que lo reponga un render tarde).
  const lineas = useMemo(() => (req ? lineasDeDecision(req) : []), [req]);
  const vigente = ajuste?.lineas === lineas ? ajuste
    : { lineas, seleccion: seleccionInicial(lineas), cantidades: cantidadesIniciales(lineas) };

  const tipo = req?.type;
  const estado = String(req?.status ?? 'PENDING').toUpperCase();
  const pendiente = estado === 'PENDING';
  const detalle = fila ? (esMinMax ? detalleDeMinMax(fila) : detalleDeSolicitud(fila)) : null;

  // El aviso que describe esta solicitud: con él se pregunta quién decide (la
  // misma regla que la campana) y se pinta el cuerpo.
  const aviso = useMemo(() => ({
    type: esMinMax ? 'MINMAX_PENDING' : 'REQUEST_PENDING',
    metadata: { request_type: esMinMax ? 'MINMAX' : tipo, request_id: idReal },
  }), [esMinMax, tipo, idReal]);
  const decidible = !!req && pendiente && puedeDecidirAviso(aviso, hasPermission);
  const { editable = false, conCantidad = false, porLinea = false } = req ? ajustesPosibles(req, { decidible, rechazando }) : {};
  const resumen = resumenDeDecision({ req, lineas, seleccion: vigente.seleccion, cantidades: vigente.cantidades, editable, conCantidad, porLinea });
  const rotulos = rotulosDeDecision(req, resumen.parcial);
  const sinMotivo = faltaMotivo({ rechazando, parcial: resumen.parcial, nota });
  const abono = esAbonoPorConfirmar(req);

  // Cancelar la propia: sólo pendiente y de quien la mandó. Min/Max vive en
  // otra tabla y su cancelación es otro camino (igual que en el portal).
  const esPropiaPendiente = !!req && pendiente && deQuienEs(req) === String(user?.id ?? '') && tipo !== 'MINMAX_CHANGE_REQUEST';

  const terminar = (ok) => {
    setOcupado(false);
    if (!ok) { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {}); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    usePorDecidir.getState().quitar(clave);
    router.back();
  };

  const decidir = async (modo) => {
    setOcupado(true);
    terminar(await decidirConAjustes({
      clave, modo, nota, userId: user?.id, contexto: detalle?.contexto ?? '',
      aceptadas: modo === 'approve' ? resumen.aceptadas : null,
    }));
  };

  const cancelar = () => Alert.alert('Cancelar solicitud', '¿Seguro que quieres cancelar esta solicitud? No se puede deshacer.', [
    { text: 'No', style: 'cancel' },
    { text: 'Sí, cancelar', style: 'destructive', onPress: async () => { setOcupado(true); terminar(await cancelarPropia(req.id)); } },
  ]);

  const alternar = (i) => {
    const s = new Set(vigente.seleccion);
    s.has(i) ? s.delete(i) : s.add(i);
    setAjuste({ ...vigente, seleccion: s });
  };
  const fijarCantidad = (i, n) => {
    const m = new Map(vigente.cantidades);
    m.set(i, acotarCantidad(lineas[i], n));
    setAjuste({ ...vigente, cantidades: m });
  };

  const titulo = REQUEST_TYPES[tipo]?.label ?? (esMinMax ? 'Ajuste de MIN·MAX' : 'Solicitud');
  const colorEstado = COLOR_ESTADO[estado] ?? '#8E8E93';
  const rotuloEstado = req && esParcial(req) ? 'Aprobada parcial' : (REQUEST_STATUS[estado]?.label ?? estado);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: titulo }} />
      <ScrollView style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setVuelta((v) => v + 1); setRecargando(false); }} />}>
        {fila === undefined ? (
          <Text style={{ color: colorSistema.texto2, textAlign: 'center', marginTop: 40 }}>Cargando…</Text>
        ) : !req ? (
          <Text style={{ color: colorSistema.texto2, textAlign: 'center', marginTop: 40 }}>{error ?? 'Esta solicitud ya no está disponible.'}</Text>
        ) : (
          <>
            {/* De qué se trata, cuándo entró y en qué estado está. */}
            <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
              <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: `${colorEstado}30`, alignItems: 'center', justifyContent: 'center' }}>
                <Host matchContents><Icon name={iconoDe(nombreDelIconoDeTipo(tipo))} size={22} color={colorEstado} /></Host>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '700' }}>{detalle?.contexto || titulo}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{fmtFechaHora(req.created_at)}</Text>
              </View>
              <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: `${colorEstado}2E` }}>
                <Text style={{ color: colorEstado, fontSize: 13, fontWeight: '700' }}>{rotuloEstado}</Text>
              </View>
            </View>

            <PersonasDeSolicitud req={req} empleadosPorId={porId} />

            <Vidrio radio={20}>
              <View style={{ padding: 12 }}>
                <DetalleDeAviso key={vuelta} n={aviso} />
              </View>
            </Vidrio>

            <ExtrasDelDetalle req={req} />

            {editable ? (
              <QueEntra esAbono={abono} lineas={lineas} seleccion={vigente.seleccion} cantidades={vigente.cantidades}
                porLinea={porLinea} conCantidad={conCantidad} aviso={resumen.aviso}
                parcial={resumen.parcial || resumen.nadaSeleccionado}
                onToggle={alternar} onCantidad={fijarCantidad} />
            ) : null}

            {/* El motivo se pide UNA vez, y sólo cuando la decisión no se
                explica sola: un rechazo o un parcial. */}
            {decidible && (rechazando || resumen.parcial) ? (
              <View style={{ gap: 6 }}>
                <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginLeft: 4 }}>
                  {rechazando ? (abono ? 'Por qué se devuelve' : 'Motivo de rechazo') : 'Por qué no entra todo'}
                  <Text style={{ color: MARCA.rojo }}> *</Text>
                </Text>
                <Campo value={nota} onChangeText={setNota} placeholder="Explica el motivo…" editable={!ocupado} style={{ minHeight: 80 }} />
              </View>
            ) : null}

            {decidible && !rechazando ? (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Boton texto={rotulos.aprobar} color={MARCA.verde} relleno icono={ICONO.marcado}
                  deshabilitado={ocupado || sinMotivo || resumen.nadaSeleccionado} onPress={() => decidir('approve')} />
                <Boton texto={rotulos.rechazar} color={MARCA.rojo} icono={ICONO.cancelar} deshabilitado={ocupado}
                  onPress={() => { Haptics.selectionAsync().catch(() => {}); setRechazando(true); }} />
              </View>
            ) : null}
            {decidible && rechazando ? (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Boton texto={rotulos.confirmarRechazo} color={MARCA.rojo} relleno deshabilitado={ocupado || sinMotivo} onPress={() => decidir('reject')} />
                <Boton texto="Volver" color={colorSistema.texto2} icono={ICONO.volver} deshabilitado={ocupado}
                  onPress={() => { setRechazando(false); setNota(''); }} />
              </View>
            ) : null}

            {esPropiaPendiente && !rechazando ? (
              <View style={{ flexDirection: 'row' }}>
                <Boton texto="Cancelar solicitud" color={MARCA.rojo} icono={ICONO.cancelar} deshabilitado={ocupado} onPress={cancelar} />
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </>
  );
}

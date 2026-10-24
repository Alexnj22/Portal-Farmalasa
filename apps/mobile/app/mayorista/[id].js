// La ficha de un cliente para Mayoristas, NATIVA — el `Detalle` de
// `views/mayoristas/MayoristasView.jsx`: sus números (promedio, a mayoreo,
// mayor factura, margen interno, regularidad, antigüedad), las compras por mes,
// su historial y lo que se puede hacer según el permiso y el estado (lo decide
// `accionesDeMayorista` del núcleo): proponerlo, aprobar o rechazar su
// solicitud (quien la pidió no puede), cambiar el precio o avisar el retiro.
// Mismas funciones del portal, con confirmación y anotado en la bitácora.
//
// Desde el 2026-10-19 (portal): quien aprueba decide al candidato directamente
// —aprobar o no aprobar, uno por uno, sin solicitud previa—; «no aprobar» no le
// avisa al cliente y lo saca de la lista. Rechazar una solicitud pide motivo y
// se le avisa. Bajar de Mayoreo Plus a Mayoreo y retirar rigen 15 días después
// del aviso (Condiciones §6) y hasta entonces se pueden cancelar. Quién decidió
// y quién propuso, con foto y nombre corto.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { ESTADOS, ORIGENES, PRECIOS, RANGOS, fetchDetalleMayorista, fetchMayoristas, proponerMayorista, resolverMayorista } from '@nucleo/data/mayoristas';
import { accionesDeMayorista, textoDeAccion } from '@nucleo/utils/mayoristas';
import { fechaTexto } from '@nucleo/utils/fecha';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../../componentes/formulario/Piezas';
import Segmentos from '../../componentes/Segmentos';
import Vidrio from '../../componentes/Vidrio';
import { ErrorConReintento } from '../../componentes/ListaPaginada';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../../componentes/Progreso';
import { mayoristaRecordado, recordarMayorista } from '../../componentes/mayoristas/elegido';
import { volver } from '../../componentes/volver';
import Avatar from '../../componentes/Avatar';

// Foto y nombre corto (canon del portal: `PersonaConFoto`).
function Persona({ id, nombre, detalle }) {
  if (!nombre) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Avatar empleado={{ id, name: nombre }} tamano={20} />
      <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${shortEmployeeName(nombre)}${detalle ? ` · ${detalle}` : ''}`}</Text>
    </View>
  );
}

// Aprobado o en revisión: su precio. Candidato (o no aprobado antes): el sugerido —«(5)» en el nombre = Mayoreo Plus—.
const precioInicial = (c) => (c ? (['aprobado', 'solicitado'].includes(c.estado) ? c.precio : c.precio_sugerido) : null);

function Numero({ titulo, valor, nota }) {
  return (
    <View style={{ width: '48%' }}>
      <Vidrio radio={16}>
        <View style={{ padding: 12, gap: 2 }}>
          <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '600' }} numberOfLines={2}>{titulo}</Text>
          <Text style={{ color: colorSistema.texto, fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] }} numberOfLines={1} adjustsFontSizeToFit>{valor}</Text>
          {nota ? <Text style={{ color: colorSistema.texto2, fontSize: 11 }} numberOfLines={2}>{nota}</Text> : null}
        </View>
      </Vidrio>
    </View>
  );
}

export default function Mayorista() {
  const { id } = useLocalSearchParams();
  const { user, hasPermission } = useAuth();
  const appendAuditLog = useStaffStore((s) => s.appendAuditLog);
  const [cliente, setCliente] = useState(() => mayoristaRecordado(id));
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  const [precio, setPrecio] = useState(() => precioInicial(mayoristaRecordado(id)) ?? 'mayoreo');
  const [nota, setNota] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const [detalle, filas] = await Promise.all([fetchDetalleMayorista(id), fetchMayoristas()]);
      const fila = (filas ?? []).find((f) => String(f.customer_id) === String(id)) ?? { customer_id: Number(id), nombre: detalle?.nombre };
      recordarMayorista(fila);
      setCliente(fila); setD(detalle); setError(null);
      setPrecio((p) => precioInicial(fila) ?? p);
    } catch (e) { setError(mensajeAmigable(e, 'No se pudo cargar el cliente.')); }
  }, [id]);
  useEffect(() => { cargar(); }, [cargar]);

  const acciones = accionesDeMayorista(cliente, {
    puedeProponer: hasPermission?.('mayoristas', 'can_edit'), puedeAprobar: hasPermission?.('mayoristas', 'can_approve'), userId: user?.id,
  });
  const est = cliente?.estado;
  // Quien aprueba decide al candidato directamente; proponer queda para quien no aprueba.
  const puedeProponer = acciones.proponer && !acciones.decidir;
  // Bajar de Mayoreo Plus a Mayoreo rige a los 15 días y se le avisa: pide motivo (§6).
  const esBajada = acciones.gestionar && cliente?.precio === 'mayoreo_plus' && precio === 'mayoreo';
  const meses = (d?.meses ?? []).slice(-7);

  const correr = (titulo, mensaje, boton, accion, fn, hecho, destructivo = false) => Alert.alert(titulo, mensaje, [
    { text: 'Cancelar', style: 'cancel' },
    { text: boton, style: destructivo ? 'destructive' : 'default', onPress: async () => {
      setOcupado(true); trabajando('Guardando…');
      try {
        await fn();
        Promise.resolve(appendAuditLog?.(`MAYORISTA_${accion.toUpperCase()}`, String(cliente.customer_id), { precio, nota, desde: 'app' })).catch(() => {});
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        listo(hecho);
        volver('/mayoristas');
      } catch (e) {
        fallo('No se pudo', mensajeAmigable(e, 'Intenta de nuevo.'));
      } finally { setOcupado(false); }
    } },
  ]);

  const nombre = cliente?.nombre ?? 'Cliente';
  const sub = [cliente?.documento, cliente?.telefono, est ? ESTADOS[est]?.label : null,
    est === 'aprobado' ? `${PRECIOS[cliente.precio]} · ${RANGOS[d?.rango ?? cliente.rango]?.nombre ?? 'Jade'}` : null].filter(Boolean).join(' · ');
  const conPrecio = puedeProponer || acciones.decidir || acciones.resolver || acciones.gestionar;
  const conAcciones = conPrecio || acciones.cancelar;

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: nombre }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }}
          refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
          {error && !cliente ? <ErrorConReintento mensaje={error} onReintentar={cargar} /> : null}
          {!cliente && !error ? <ActivityIndicator style={{ marginTop: 32 }} /> : null}
          {cliente ? (
            <>
              <View style={{ gap: 2 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 22, fontWeight: '800' }}>{nombre}</Text>
                {sub ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{sub}</Text> : null}
              </View>
              {cliente.ficha_completa === false ? <Aviso tono="freno" texto={cliente.falta_correo
                ? 'A una empresa o institución le falta el correo electrónico en su ficha (Condiciones §2.4). Hay que completarlo antes de aprobar.'
                : 'La ficha no está completa (documento o teléfono). Hay que completarla antes de aprobar.'} /> : null}
              {cliente.resuelto_por && est && est !== 'solicitado' ? (
                <View style={{ gap: 4 }}>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${est === 'aprobado' ? 'Última decisión' : ESTADOS[est]?.label}:${cliente.motivo && est !== 'aprobado' ? ` «${cliente.motivo}»` : ''}`}</Text>
                  <Persona id={cliente.resuelto_por_id} nombre={cliente.resuelto_por}
                    detalle={cliente.resuelto_at ? fechaTexto(cliente.resuelto_at, { day: 'numeric', month: 'short', year: 'numeric' }) : null} />
                </View>
              ) : null}
              {est === 'aprobado' && (cliente.retiro_programado || cliente.precio_programado_el) ? (
                <Aviso tono="cuidado" texto={`${cliente.retiro_programado
                  ? `Retiro avisado: deja de ser Cliente Mayorista el ${fechaTexto(cliente.retiro_programado, { day: 'numeric', month: 'long' })}.`
                  : `Bajada avisada: pasa a precio Mayoreo el ${fechaTexto(cliente.precio_programado_el, { day: 'numeric', month: 'long' })}.`} ${cliente.retiro_por_inactividad ? 'Es por seis meses sin compras (Condiciones §2.5): si vuelve a comprar antes, se cancela solo.' : 'Rige 15 días después del aviso (Condiciones §6); hasta entonces se puede cancelar.'}`} />
              ) : null}
              {est === 'solicitado' ? (
                <View style={{ gap: 4 }}>
                  <Aviso texto={`${ORIGENES[cliente.origen] ?? 'Solicitado'}${cliente.solicitado_at ? ` el ${fechaTexto(cliente.solicitado_at, { day: 'numeric', month: 'short' })}` : ''}${cliente.nota_solicitud ? ` — «${cliente.nota_solicitud}»` : ''}.${cliente.vence_respuesta ? ` Hay que responderle a más tardar el ${fechaTexto(cliente.vence_respuesta, { day: 'numeric', month: 'long' })} (cinco días hábiles).` : ''}${acciones.esSolicitante ? ' Tú la hiciste: la tiene que resolver otra persona.' : ''}`} />
                  <Persona id={cliente.solicitado_por_id} nombre={cliente.solicitado_por} detalle="Lo propuso" />
                </View>
              ) : null}

              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 }}>
                <Numero titulo="Promedio 3 meses" valor={formatMoney(cliente.prom_3m ?? 0)} nota={cliente.cumple ? 'Cumple el requisito: $100/mes o una factura de $500' : 'No cumple: $100/mes o una factura de $500'} />
                <Numero titulo="A mayoreo (6 meses)" valor={formatMoney(cliente.a_mayoreo ?? 0)} nota={`${cliente.facturas_mayoreo ?? 0} facturas`} />
                <Numero titulo="Mayor factura" valor={formatMoney(cliente.mayor_factura ?? 0)} />
                <Numero titulo="Margen (interno)" valor={cliente.margen != null ? `${cliente.margen} %` : '—'} nota="No se le menciona al cliente" />
                <Numero titulo="Regularidad" valor={`${cliente.meses_con_compra ?? 0} de 6 meses`} />
                <Numero titulo="Antigüedad" valor={cliente.primera_compra ? `desde ${fechaTexto(cliente.primera_compra, { month: 'short', year: 'numeric' })}` : '—'} />
              </View>

              <Seccion titulo="Compras por mes">
                {!d ? <ActivityIndicator /> : meses.length ? meses.map((m, i) => (
                  <View key={m.mes} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                    <Text style={{ color: colorSistema.texto2, fontSize: 14, width: 110 }}>{fechaTexto(m.mes, { month: 'long', year: 'numeric' })}</Text>
                    <View style={{ flex: 1, alignItems: 'flex-end' }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{formatMoney(m.total)}</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`a mayoreo ${formatMoney(m.a_mayoreo)} · ${m.facturas} fact.`}</Text>
                    </View>
                  </View>
                )) : <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Sin compras en los últimos meses.</Text>}
              </Seccion>

              {d?.historial?.length ? (
                <Seccion titulo="Historial">
                  {d.historial.map((h, i) => (
                    <View key={i} style={{ gap: 3, paddingVertical: 4 }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 14 }}>
                        <Text style={{ color: colorSistema.texto2 }}>{`${fechaTexto(h.cuando, { day: 'numeric', month: 'short', year: 'numeric' })} · `}</Text>
                        {`${textoDeAccion(h)}${h.nota ? ` — «${h.nota}»` : ''}`}
                      </Text>
                      <Persona id={h.por_id} nombre={h.por} />
                    </View>
                  ))}
                </Seccion>
              ) : null}

              {conAcciones ? (
                <Seccion titulo={conPrecio ? 'Precio y nota' : 'Nota'}>
                  {conPrecio ? <Segmentos margen={0} activa={precio} onCambiar={setPrecio} opciones={[{ id: 'mayoreo', label: 'Mayoreo' }, { id: 'mayoreo_plus', label: 'Mayoreo Plus' }]} /> : null}
                  <Campo value={nota} onChangeText={setNota} maxLength={300}
                    placeholder={acciones.resolver ? 'Motivo (obligatorio para rechazar: se le avisa al cliente)'
                      : acciones.gestionar ? 'Motivo (obligatorio para retirar o bajar a Mayoreo: se le avisa al cliente)'
                        : 'Nota (opcional, interna)'} />
                </Seccion>
              ) : null}

              {acciones.decidir ? (
                <View style={{ gap: 10 }}>
                  <BotonGrande texto={`Aprobar con ${PRECIOS[precio]}`} color={MARCA.verde} deshabilitado={ocupado || cliente.ficha_completa === false}
                    onPress={() => correr('Aprobar como mayorista', `${nombre} pasa a comprar con ${PRECIOS[precio]}.`, 'Aprobar', 'aprobado',
                      () => resolverMayorista(cliente.customer_id, 'aprobar', precio, nota), `Aprobado con ${PRECIOS[precio]}`)} />
                  <BotonGrande texto="No aprobar" borde color={MARCA.rojo} deshabilitado={ocupado}
                    onPress={() => correr('No aprobar', `${nombre} sale de los candidatos. No se le avisa: no pidió nada.`, 'No aprobar', 'descartado',
                      () => resolverMayorista(cliente.customer_id, 'descartar', null, nota), 'No aprobado: sale de los candidatos', true)} />
                </View>
              ) : null}
              {acciones.cancelar ? (
                <BotonGrande texto="Cancelar el cambio avisado" borde deshabilitado={ocupado}
                  onPress={() => correr('Cancelar el cambio avisado', cliente.retiro_programado ? 'Sigue siendo Cliente Mayorista.' : 'Se queda con Mayoreo Plus.', 'Cancelar el cambio', 'cambio_cancelado',
                    () => resolverMayorista(cliente.customer_id, 'cancelar_cambio', null, nota), 'Cambio cancelado')} />
              ) : null}

              {puedeProponer ? (
                <BotonGrande texto="Proponer como mayorista" deshabilitado={ocupado}
                  onPress={() => correr('Proponer como mayorista', `Se envía a Administración con ${PRECIOS[precio]}.`, 'Proponer', 'propuesto',
                    () => proponerMayorista(cliente.customer_id, precio, nota), 'Solicitud enviada a Administración')} />
              ) : null}
              {acciones.resolver ? (
                <View style={{ gap: 10 }}>
                  <BotonGrande texto={`Aprobar con ${PRECIOS[precio]}`} color={MARCA.verde} deshabilitado={ocupado || cliente.ficha_completa === false}
                    onPress={() => correr('Aprobar como mayorista', `${nombre} pasa a comprar con ${PRECIOS[precio]}.`, 'Aprobar', 'aprobado',
                      () => resolverMayorista(cliente.customer_id, 'aprobar', precio, nota), `Aprobado con ${PRECIOS[precio]}`)} />
                  <BotonGrande texto="Rechazar" borde color={MARCA.rojo} deshabilitado={ocupado || !nota.trim()}
                    onPress={() => correr('Rechazar la solicitud', `Se le avisa al cliente. Motivo: «${nota.trim()}».`, 'Rechazar', 'rechazado',
                      () => resolverMayorista(cliente.customer_id, 'rechazar', null, nota), 'Solicitud rechazada', true)} />
                </View>
              ) : null}
              {acciones.gestionar ? (
                <View style={{ gap: 10 }}>
                  <BotonGrande texto={esBajada ? 'Bajar a Mayoreo (en 15 días)' : 'Cambiar precio'}
                    deshabilitado={ocupado || precio === cliente.precio || (esBajada && !nota.trim()) || (esBajada && !!cliente.precio_programado)}
                    onPress={() => correr(esBajada ? 'Bajar a Mayoreo' : 'Cambiar el precio',
                      esBajada ? `Pasa a Mayoreo en 15 días y se le avisa. Motivo: «${nota.trim()}».` : `De ${PRECIOS[cliente.precio]} a ${PRECIOS[precio]}.`,
                      esBajada ? 'Avisar la bajada' : 'Cambiar', 'precio',
                      () => resolverMayorista(cliente.customer_id, 'cambiar_precio', precio, nota),
                      esBajada ? 'Bajada avisada: rige en 15 días' : `Precio cambiado a ${PRECIOS[precio]}`)} />
                  <BotonGrande texto="Retirar" borde color={MARCA.rojo} deshabilitado={ocupado || !nota.trim()}
                    onPress={() => correr('Avisar el retiro', `El retiro rige en 15 días. Motivo: «${nota.trim()}».`, 'Retirar', 'retiro',
                      () => resolverMayorista(cliente.customer_id, 'retirar', null, nota), 'Retiro avisado: rige en 15 días', true)} />
                </View>
              ) : null}
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

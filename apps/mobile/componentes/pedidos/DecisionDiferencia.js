// La decisión de una diferencia, NATIVA — el `DecisionDiferencia` del portal
// dentro de la tarjeta del renglón: toda diferencia tiene DOS salidas (se
// arregla en el sistema o con el producto en la mano), la propone la SALA,
// bodega acepta o contrapropone la otra, y sin acuerdo decide SUPERVISIÓN.
//
// De quién es el turno lo dice el núcleo (`turnoDe`), y la base lo vuelve a
// verificar: si algo no correspondía, rebota con su motivo. Proponer devolver
// un producto DAÑADO exige la foto (la base lo rechaza sin ella), y la foto se
// sube ANTES de proponer.
//
// También va acá lo que cierra el círculo después del acuerdo: confirmar que
// llegó (salidas «en la mano») y, para bodega, sacar el producto, probar sin
// mover y confirmar su entrada (`DevolucionBloque` del portal).
import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { ayudaPara, confirmarLlegadaDiferencia, opcionElegida, opcionesDe } from '@nucleo/data/diferencias';
import { moverDevoluciones, recibirDevoluciones, BUCKET_EVIDENCIA } from '@nucleo/data/devoluciones';
import { decidirDiferenciaYMover } from '@nucleo/data/accionesDeBodega';
import { turnoDe } from '@nucleo/utils/decisionDiferencia';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { colorSistema } from '../Formulario';
import { Campo } from '../formulario/Piezas';
import Segmentos from '../Segmentos';
import Fotos, { subirFotos } from '../formulario/Fotos';
import { MARCA } from '../inicio/marca';
import { fallo, listo } from '../Progreso';

const ESPERA = { sala: 'Esperando que la sala decida', bodega: 'Esperando la respuesta de bodega', supervision: 'Lo está viendo supervisión' };
const TITULO = { propuesta: 'La sala propone', contrapropuesta: 'Bodega propone la otra', escalada: 'Sin acuerdo', acordada: 'Acordado', confirmada: 'Resuelto' };
const ESTADO_DEV = { aceptada: 'Acordada, falta sacarlo', enviada: 'Salió, falta que entre', error: 'No salió', recibida: 'Entró', rechazada: 'Rechazada', solicitada: 'Pedida (circuito anterior)' };

function Boton({ texto, color = MARCA.azulClaro, lleno, onPress, deshabilitado }) {
  return (
    <Pressable disabled={deshabilitado} onPress={onPress}
      style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 14, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
        backgroundColor: lleno ? color : 'transparent', borderWidth: lleno ? 0 : 1.2, borderColor: color,
        opacity: deshabilitado ? 0.4 : pressed ? 0.7 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
      <Text style={{ color: lleno ? '#fff' : color, fontSize: 15, fontWeight: '700' }}>{texto}</Text>
    </Pressable>
  );
}
const Espera = ({ texto }) => <Text style={{ color: colorSistema.texto2, fontSize: 13, fontStyle: 'italic' }}>{`⏱ ${texto}`}</Text>;

const diasPara = (iso) => (iso ? Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000) : null);

export default function DecisionDiferencia({ item, catalogo, dev, pedidoId, sucId, esSala, esSupervision, onCambio }) {
  const { user } = useAuth();
  const opciones = opcionesDe(catalogo, item.error_tipo);
  const [tocada, setTocada] = useState(null);
  const elegida = (tocada && opciones.some((o) => o.valor === tocada)) ? tocada : (opciones[0]?.valor ?? '');
  const [nota, setNota] = useState('');
  const [fotos, setFotos] = useState([]);
  const [ocupado, setOcupado] = useState(false);
  const estado = item.resolucion_status ?? null;
  const turno = turnoDe(estado, { esSala, esSupervision });
  const op = opcionElegida(catalogo, item.error_tipo, item.resolucion_tipo);
  const aLaSala = dev?.sentido === 'a_sala';
  if (!opciones.length) return null;

  const anotar = (accion, extra = {}) => useStaffStore.getState().appendAuditLog?.(accion, pedidoId, { sucursal_id: sucId, item_id: item.id, desde: 'app', ...extra });

  const decidir = async (accion, tipo = null, texto = null, evidencia = []) => {
    setOcupado(true);
    try {
      const { data, movimiento } = await decidirDiferenciaYMover({ itemId: item.id, accion, tipo, nota: texto, evidencia });
      anotar(`PEDIDO_DIFERENCIA_${String(accion).toUpperCase()}`, { opcion: data?.opcion ?? tipo, estado: data?.estado });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      if (movimiento) {
        if (movimiento.ok) listo(movimiento.aLaSala ? 'Salió de bodega' : 'Salió de la sala', movimiento.aLaSala ? 'Falta confirmar la entrada en la sala.' : 'Falta que bodega confirme la entrada.');
        else fallo('Quedaron de acuerdo, pero no salió', movimiento.error ?? 'Se puede reintentar.');
      } else if (data?.estado === 'escalada') listo('Pasó a supervisión', 'No hubo acuerdo. Supervisión decide con qué salida se queda.');
      else listo('Listo', '');
      setNota(''); setFotos([]);
      onCambio?.();
    } catch (e) {
      fallo('Diferencia', mensajeAmigable(e));
    } finally {
      setOcupado(false);
    }
  };

  const necesitaFoto = (valor) => item.error_tipo === 'danado' && opcionElegida(catalogo, item.error_tipo, valor)?.mueve === 'devolucion';
  const proponer = async () => {
    if (necesitaFoto(elegida)) {
      if (!fotos.length) { fallo('Falta la foto', 'Para devolver un producto dañado, bodega necesita verlo.'); return; }
      setOcupado(true);
      let urls;
      try { urls = await subirFotos(fotos, { bucket: BUCKET_EVIDENCIA, carpeta: `inventario/${sucId}/${user?.id ?? 'anon'}` }); } catch (e) { setOcupado(false); fallo('Diferencia', mensajeAmigable(e)); return; }
      setOcupado(false);
      await decidir('proponer', elegida, nota || null, urls);
      return;
    }
    await decidir('proponer', elegida, nota || null);
  };

  const conDevolucion = async (fn, titulo, okTexto, accion) => {
    setOcupado(true);
    try {
      const r = await fn([dev.id], { simulacro: accion === 'PEDIDO_DEVOLUCION_PROBADA' });
      anotar(accion, { devolucion_id: dev.id, ok: r.ok === true });
      if (r.ok) {
        const h = r.hechas?.[0];
        listo(titulo, accion === 'PEDIDO_DEVOLUCION_PROBADA' && h
          ? `${h.producto ?? 'El producto'} · ${h.presentacion ?? 'sin presentación'} · ${(h.renglones ?? []).map((x) => `${x.cantidad} del lote ${x.lote ?? 'sin lote'}`).join(', ') || 'sin lotes'}`
          : okTexto);
      } else fallo(accion === 'PEDIDO_DEVOLUCION_PROBADA' ? 'La prueba encontró un problema' : 'No se pudo', r.fallos?.[0]?.error ?? r.error ?? 'Se puede reintentar.');
      onCambio?.();
    } catch (e) {
      fallo('Devolución', mensajeAmigable(e));
    } finally {
      setOcupado(false);
    }
  };

  const confirmarLlegada = () => Alert.alert('Confirmar llegada', 'Con el producto en la mano. No sale ningún traslado.', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Confirmar', onPress: async () => {
      setOcupado(true);
      try {
        const { error } = await confirmarLlegadaDiferencia(item.id);
        if (error) throw error;
        anotar('PEDIDO_DIFERENCIA_LLEGADA');
        listo('Diferencia cerrada', 'Queda la constancia de que llegó.');
        onCambio?.();
      } catch (e) { fallo('Diferencia', mensajeAmigable(e)); } finally { setOcupado(false); }
    } },
  ]);

  const rechazar = () => Alert.prompt('No estoy de acuerdo', 'Por qué no (lo lee supervisión).', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Rechazar', style: 'destructive', onPress: (m) => { if (String(m ?? '').trim()) decidir('rechazar', null, String(m).trim()); else fallo('Falta el motivo', 'Escríbelo para poder rechazar.'); } },
  ], 'plain-text');

  const opcionesSeg = opciones.map((o) => ({ id: o.valor, label: o.rotulo_corto ?? o.rotulo }));

  // ── Nadie propuso todavía ──
  if (estado === null) {
    if (turno !== 'yo') return <Espera texto={ESPERA.sala} />;
    const sel = opciones.find((o) => o.valor === elegida);
    return (
      <View style={{ gap: 8, borderTopWidth: 0.5, borderTopColor: colorSistema.separador, paddingTop: 8 }}>
        <Text style={{ color: colorSistema.texto2, fontSize: 11, fontWeight: '800', letterSpacing: 0.6 }}>CÓMO SE ARREGLA</Text>
        <Segmentos margen={0} opciones={opcionesSeg} activa={elegida} onCambiar={setTocada} />
        {sel ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}><Text style={{ fontWeight: '700', color: colorSistema.texto }}>{sel.rotulo}</Text>{` — ${ayudaPara(sel, { esSala, esSupervision }) ?? ''}`}</Text> : null}
        {necesitaFoto(elegida) ? <Fotos fotos={fotos} onCambiar={setFotos} max={3} /> : null}
        <Campo multiline={false} value={nota} onChangeText={setNota} placeholder="Nota (opcional)" />
        <Boton texto={ocupado ? 'Enviando…' : 'Proponer'} lleno color={MARCA.violetaClaro} deshabilitado={ocupado || !elegida} onPress={proponer} />
      </View>
    );
  }

  const laOtra = opciones.find((o) => o.valor !== item.resolucion_tipo);
  const dias = diasPara(item.resolucion_vence_at);
  return (
    <View style={{ gap: 8, borderTopWidth: 0.5, borderTopColor: colorSistema.separador, paddingTop: 8 }}>
      <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{op?.rotulo ?? '—'}</Text>
      <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{TITULO[estado] ?? estado}</Text>
      {estado !== 'confirmada' && op && ayudaPara(op, { esSala, esSupervision }) ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{ayudaPara(op, { esSala, esSupervision })}</Text> : null}
      {estado === 'escalada' && item.nota_rechazo ? <Text style={{ color: MARCA.rojo, fontSize: 13 }}>{`«${item.nota_rechazo}»`}</Text> : null}
      {estado === 'acordada' && dias !== null ? <Text style={{ color: dias <= 0 ? MARCA.ambar : colorSistema.texto2, fontSize: 13 }}>{dias > 0 ? `Quedan ${dias} día${dias === 1 ? '' : 's'} para que llegue` : 'Se venció el plazo. Hay que decidirla de nuevo.'}</Text> : null}

      {turno === 'yo' && (estado === 'propuesta' || estado === 'contrapropuesta') ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Boton texto="Aceptar" lleno color={MARCA.verde} deshabilitado={ocupado} onPress={() => decidir('aceptar')} />
          {estado === 'propuesta' && laOtra ? <Boton texto={`Proponer ${(laOtra.rotulo_corto ?? laOtra.rotulo).toLowerCase()}`} deshabilitado={ocupado} onPress={() => decidir('contraproponer', laOtra.valor, null)} /> : null}
          {estado === 'contrapropuesta' ? <Boton texto="Rechazar" color={MARCA.rojo} deshabilitado={ocupado} onPress={rechazar} /> : null}
        </View>
      ) : null}

      {estado === 'escalada' && turno === 'yo' ? (
        <View style={{ gap: 6 }}>
          <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '700' }}>CON CUÁL SE QUEDA</Text>
          <Segmentos margen={0} opciones={opcionesSeg} activa={item.resolucion_tipo ?? ''}
            onCambiar={(v) => Alert.alert('Decidir', opciones.find((o) => o.valor === v)?.rotulo ?? v, [{ text: 'Cancelar', style: 'cancel' }, { text: 'Decidir', onPress: () => decidir('supervisar', v, null) }])} />
        </View>
      ) : null}

      {estado === 'acordada' && op?.mueve === 'ninguno' ? (
        (op.cierra_con === 'llegada_sala' ? esSala : !esSala) || esSupervision
          ? <Boton texto="Confirmar llegada" lleno color={MARCA.verde} deshabilitado={ocupado} onPress={confirmarLlegada} />
          : <Espera texto={op.cierra_con === 'llegada_sala' ? 'Falta que la sala confirme que llegó' : 'Falta que bodega confirme que lo tiene'} />
      ) : null}

      {dev ? (
        <View style={{ gap: 6 }}>
          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Movimiento: ${ESTADO_DEV[dev.estado] ?? dev.estado} · ${dev.cantidad}`}</Text>
          {dev.error_msg ? <Text style={{ color: MARCA.rojo, fontSize: 12 }}>{dev.error_msg}</Text> : null}
          {(dev.estado === 'aceptada' || (dev.estado === 'error' && !dev.id_traslado && !dev.detalle?.revisar_a_mano)) && !esSala ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Boton texto={aLaSala ? 'Sacarlo de bodega' : 'Sacarlo de la sala'} lleno color={MARCA.violetaClaro} deshabilitado={ocupado}
                onPress={() => Alert.alert('Mover el producto', 'Sale el traslado en el sistema.', [{ text: 'Cancelar', style: 'cancel' }, { text: 'Mover', onPress: () => conDevolucion(moverDevoluciones, aLaSala ? 'Salió de bodega' : 'Salió de la sala', 'Falta confirmar la entrada.', 'PEDIDO_DEVOLUCION_MOVIDA') }])} />
              <Boton texto="Probar sin mover nada" deshabilitado={ocupado} onPress={() => conDevolucion(moverDevoluciones, 'La prueba pasó — no se movió nada', '', 'PEDIDO_DEVOLUCION_PROBADA')} />
            </View>
          ) : null}
          {(dev.estado === 'enviada' || dev.estado === 'error') && !esSala && dev.id_traslado ? (
            <Boton texto="Confirmar entrada" lleno color={MARCA.ambar} deshabilitado={ocupado}
              onPress={() => Alert.alert('Confirmar entrada', dev.viaja ? 'Confírmalo cuando tengas el producto en la mano.' : 'Como no viaja nada, se puede confirmar ya.', [{ text: 'Cancelar', style: 'cancel' }, { text: 'Confirmar', onPress: () => conDevolucion(recibirDevoluciones, 'Entró', 'La diferencia queda cerrada.', 'PEDIDO_DEVOLUCION_RECIBIDA') }])} />
          ) : null}
          {dev.estado === 'error' && dev.detalle?.revisar_a_mano ? <Text style={{ color: MARCA.rojo, fontSize: 12, fontWeight: '700' }}>{`Hay que revisarla a mano antes de volver a intentar — busca «${dev.clave}».`}</Text> : null}
        </View>
      ) : null}

      {turno !== 'yo' && ESPERA[turno] && estado !== 'acordada' && estado !== 'confirmada' ? <Espera texto={ESPERA[turno]} /> : null}
    </View>
  );
}

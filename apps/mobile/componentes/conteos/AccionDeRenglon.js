// Las dos acciones sobre UN renglón de conteo que no son contarlo, NATIVO:
//
// - `modo: 'lote'` — `EditLoteModal` del portal: el lote físico no es el del
//   renglón. Sólo corrige la ETIQUETA del conteo (`editarLoteConteoItem`), no
//   el inventario real ni contra qué se compara. Conteo abierto y por lote.
// - `modo: 'recuento'` — el recuento del supervisor entre finalizar y aprobar
//   (`recontarConteoItem`). La RPC exige can_approve, rechaza que lo haga quien
//   contó esa línea y conserva el primer conteo en el historial.
//
// El recuento pide confirmación antes de escribir: cambia la diferencia que
// se va a firmar. Corregir el lote no (2026-11-16, Bodega: «que sea práctico,
// sin tanto clic»): sólo cambia la etiqueta del conteo y se puede volver a
// corregir. El lote abre VACÍO para escribir el nuevo, con los lotes que ya
// conoce el inventario a un toque, y el vencimiento se pide por mes y año.
import { useEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, ScrollView, Text, View } from 'react-native';
import { Presionable as Pressable } from '../Tocable';
import { useStaffStore } from '@nucleo/store/staffStore';
import { cantidadValida, esLoteGenerico, formatoMesAno, mesAnoDeVence, reglaDeLoteYVence, venceDeMesAno } from '@nucleo/utils/conteoDeInventario';
import { fechaTexto } from '@nucleo/utils/fecha';
import * as Haptics from 'expo-haptics';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import ConAurora from '../ConAurora';
import EncabezadoDeHoja from '../EncabezadoDeHoja';
import { colorSistema } from '../Formulario';
import { BotonGrande, Campo, Seccion } from '../formulario/Piezas';
import { MARCA, tintaSobre } from '../inicio/marca';
import { fallo, listo } from '../Progreso';

export default function AccionDeRenglon({ item, modo, aCiegas = false, hermanos = [], producto = null, onCerrar, onHecho }) {
  const editarLote = useStaffStore((s) => s.editarLoteConteoItem);
  const recontar = useStaffStore((s) => s.recontarConteoItem);
  const fetchLotesConocidos = useStaffStore((s) => s.fetchLotesConocidosDelProducto);
  const [conocidos, setConocidos] = useState([]);
  const campoVence = useRef(null);
  const [lote, setLote] = useState('');
  const [vence, setVence] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!item) return;
    setLote('');
    setVence(mesAnoDeVence(item.fecha_vencimiento));
    setCantidad('');
    setNota('');
  }, [item]);

  // Los lotes que ya existen de este producto: los del inventario y los que
  // ya se anotaron en este conteo. Si no se pueden leer, no hay sugerencias.
  const esLote = modo === 'lote';
  useEffect(() => {
    if (!item || !esLote) return undefined;
    let vivo = true;
    setConocidos([]);
    Promise.resolve(fetchLotesConocidos(item.erp_product_id)).then((r) => { if (vivo) setConocidos(r ?? []); }).catch(() => {});
    return () => { vivo = false; };
  }, [item, esLote, fetchLotesConocidos]);
  const sugerencias = (() => {
    const m = new Map();
    for (const h of [...hermanos, ...conocidos]) {
      const l = String(h.lote ?? '').trim().toUpperCase();
      if (esLoteGenerico(l) || (h.id && h.id === item?.id)) continue;
      const clave = `${l}|${mesAnoDeVence(h.fecha_vencimiento)}`;
      if (!m.has(clave)) m.set(clave, { lote: l, vence: mesAnoDeVence(h.fecha_vencimiento) });
    }
    return [...m.values()].slice(0, 12);
  })();

  // Lo que pide el producto (la misma regla que aplica la base al guardar):
  // regulado → lote y vence; perecedero → sólo vence. Sin el dato, como antes.
  const conRegla = producto && (producto.regulado != null || producto.perecedero != null);
  const { pideLote, pideVence } = conRegla ? reglaDeLoteYVence(producto) : { pideLote: true, pideVence: false };
  const venceFecha = venceDeMesAno(vence);
  const loteOk = !pideLote || (lote.trim() !== '' && !esLoteGenerico(lote));
  const venceOk = pideVence ? !!venceFecha : (vence === '' || !!venceFecha);
  const valido = esLote ? loteOk && venceOk : cantidad !== '' && cantidadValida(cantidad);
  const queFalta = !esLote || valido ? null
    : !loteOk ? 'Falta el lote.' : vence.length === 5 ? 'Revisa el mes.' : pideVence ? 'Falta el vencimiento.' : null;

  const enviar = async () => {
    setGuardando(true);
    try {
      if (esLote) {
        // Sin lote que pedir, el renglón conserva el suyo: sólo cambia el vence.
        const r = await editarLote(item.id, { lote: pideLote ? lote.trim().toUpperCase() : (item.lote ?? ''), fechaVencimiento: venceFecha });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        listo(pideLote ? 'Lote corregido' : 'Vencimiento corregido', `Lote ${r.lote}${r.fecha_vencimiento ? ` · vence ${mesAnoDeVence(r.fecha_vencimiento)}` : ''}`);
        onHecho?.(item.id, { lote: r.lote, fecha_vencimiento: r.fecha_vencimiento });
      } else {
        const valor = Number(cantidad);
        const r = await recontar(item.id, { fisicoCantidad: valor, nota: nota.trim() || null });
        listo('Recuento guardado', `${item.product_nombre || 'Producto'}: ${valor}`);
        onHecho?.(item.id, {
          fisico_primer_conteo: r.fisico_primer_conteo, fisico_cantidad: valor, sistema_cantidad: r.sistema_cantidad,
          diferencia: r.diferencia, estado_item: valor === 0 && r.sistema_cantidad > 0 ? 'SIN_UBICAR' : 'CONTADO',
          recontado_at: new Date().toISOString(),
        }, { enCero: (r.en_cero ?? []).length > 0 });
      }
      onCerrar();
    } catch (e) {
      fallo(esLote ? 'No se corrigió el lote' : 'No se guardó el recuento', mensajeAmigable(e));
    } finally {
      setGuardando(false);
    }
  };

  const guardar = () => {
    if (!valido || guardando) return;
    if (esLote) {
      enviar();
    } else {
      Alert.alert('¿Guardar el recuento?', `La cantidad contada pasa a ${cantidad}. El primer conteo queda en el historial.`, [
        { text: 'Cancelar', style: 'cancel' }, { text: 'Guardar', onPress: enviar }]);
    }
  };

  return (
    <Modal visible={!!item} animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal onRequestClose={onCerrar}>
      <ConAurora>
        <EncabezadoDeHoja titulo={esLote ? (pideLote ? 'Corregir lote' : 'Corregir vence') : 'Recontar'}
          subtitulo={[item?.product_nombre, item?.presentacion, item?.lote ? `lote ${item.lote}` : null].filter(Boolean).join(' · ')}
          onCerrar={onCerrar} />
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 60 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
            {esLote ? (
              <>
                {conRegla ? (
                  <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '700' }}>
                    {pideLote ? 'Este producto pide lote y vencimiento.' : 'Este producto pide solo el vencimiento.'}
                  </Text>
                ) : null}
                {pideLote ? (<>
                <Seccion titulo="Lote nuevo">
                  <Campo multiline={false} value={lote} onChangeText={(v) => setLote(v.toUpperCase())} autoFocus
                    placeholder={esLoteGenerico(item?.lote) ? 'Escribe el lote' : `Ahora: ${item?.lote}`}
                    autoCapitalize="characters" autoCorrect={false} spellCheck={false} returnKeyType="next" submitBehavior="submit"
                    onSubmitEditing={() => campoVence.current?.focus()} style={{ fontSize: 20, fontWeight: '700' }} />
                </Seccion>
                {sugerencias.length ? (
                  <Seccion titulo="Ya registrados">
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      {sugerencias.map((x) => {
                        const elegido = lote === x.lote && vence === x.vence;
                        return (
                          <Pressable key={`${x.lote}|${x.vence}`} hitSlop={4}
                            onPress={() => { Haptics.selectionAsync().catch(() => {}); setLote(x.lote); setVence(x.vence); }}
                            style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 22,
                              backgroundColor: elegido ? MARCA.azul : `${MARCA.azulClaro}26`, opacity: pressed ? 0.6 : 1 })}>
                            <Text style={{ color: elegido ? tintaSobre(MARCA.azul) : colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{x.lote}</Text>
                            {x.vence ? <Text style={{ color: elegido ? tintaSobre(MARCA.azul) : colorSistema.texto2, fontSize: 12 }}>{`vence ${x.vence}`}</Text> : null}
                          </Pressable>
                        );
                      })}
                    </View>
                  </Seccion>
                ) : null}
                </>) : null}
                <Seccion titulo="Vence (mes y año)">
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <View style={{ width: 120 }}>
                      <Campo ref={campoVence} autoFocus={!pideLote} multiline={false} value={vence} keyboardType="number-pad" placeholder="MM/AA" maxLength={5}
                        onChangeText={(v) => setVence(formatoMesAno(v))} onSubmitEditing={guardar} onSiguiente={guardar}
                        style={{ fontSize: 20, fontWeight: '700', textAlign: 'center' }} />
                    </View>
                    <Text style={{ flex: 1, color: vence && !venceFecha && vence.length === 5 ? MARCA.rojo : colorSistema.texto2, fontSize: 15 }}>
                      {venceFecha ? fechaTexto(venceFecha, { month: 'long', year: 'numeric' }) : vence.length === 5 ? 'Mes inválido' : vence ? '' : pideVence ? 'Obligatorio' : 'Sin vencimiento'}
                    </Text>
                  </View>
                </Seccion>
                {queFalta ? <Text style={{ color: MARCA.ambar, fontSize: 14, fontWeight: '700' }}>{queFalta}</Text> : null}
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Solo corrige este conteo. El inventario no cambia.</Text>
              </>
            ) : (
              <>
                <Seccion titulo="Primer conteo">
                  <Text style={{ color: colorSistema.texto, fontSize: 16 }}>
                    {aCiegas && !item?.recontado_at
                      ? 'Conteo ciego. Verás el primer conteo y el sistema después de guardar el tuyo.'
                      : `Físico ${item?.fisico_cantidad ?? '—'}${item?.ver_sistema && item?.sistema_cantidad != null ? ` · sistema ${item.sistema_cantidad}` : ''}`}
                  </Text>
                </Seccion>
                <Seccion titulo="Recuento">
                  <Campo multiline={false} keyboardType="number-pad" value={cantidad} onChangeText={(v) => setCantidad(v.replace(/[^\d]/g, ''))}
                    placeholder="Cantidad encontrada" style={{ fontSize: 22, fontWeight: '700' }} />
                </Seccion>
                <Seccion titulo="Nota (opcional)">
                  <Campo value={nota} onChangeText={setNota} placeholder="Dónde apareció, qué se revisó" style={{ minHeight: 60 }} />
                </Seccion>
                {hermanos.length > 1 && !hermanos.some((h) => h.recontado_at)
                  ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Al guardar, los otros lotes de este producto quedan en 0 hasta que los recuentes. Vacío = 0.</Text>
                  : null}
              </>
            )}
            <BotonGrande texto={guardando ? 'Guardando…' : esLote ? 'Corregir el lote' : 'Guardar el recuento'} onPress={guardar} deshabilitado={!valido || guardando} />
          </ScrollView>
        </KeyboardAvoidingView>
      </ConAurora>
    </Modal>
  );
}

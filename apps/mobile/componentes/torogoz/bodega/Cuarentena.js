// En cuarentena, NATIVO — `CuarentenaModal` del portal en una hoja: lo devuelto
// que no volvió a la venta (dañado, vencido o dudoso). No cuenta en la
// existencia hasta que alguien decida: reingresar (la base exige que el lote no
// esté vencido), devolver al proveedor o destruir. Decide quien administra.
import { useState } from 'react';
import { Modal, ScrollView, Text, View } from 'react-native';
import { Presionable as Pressable } from '../../Tocable';
import Indicador from '../../Indicador';
import { resolverCuarentena, mensajeDeDistribucion } from '@nucleo/data/distribucion';
import { ACCIONES_CUARENTENA } from '@nucleo/utils/distribucionBodega';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { formatQty } from '@nucleo/utils/formatNumber';
import { useStaffStore } from '@nucleo/store/staffStore';
import ConAurora from '../../ConAurora';
import EncabezadoDeHoja from '../../EncabezadoDeHoja';
import { colorSistema } from '../../Formulario';
import { Campo, Seccion, Vacio } from '../../formulario/Piezas';
import { MARCA } from '../../inicio/marca';
import { fallo, listo } from '../../Progreso';
import { PETROLEO, confirmar } from './piezas';

const COLOR = { reingresada: PETROLEO, get devuelta_proveedor() { return MARCA.azulClaro; }, destruida: MARCA.rojo };

export default function Cuarentena({ filas, puedeResolver, onCerrar, onCambio }) {
  const [nota, setNota] = useState({});
  const [ocupado, setOcupado] = useState(null);
  const [hechas, setHechas] = useState(() => new Set());

  const resolver = async (q, a) => {
    const nombre = q.products?.nombre ?? `Producto ${q.product_id}`;
    const ok = await confirmar(`${a.label}: ${nombre}`, `${formatQty(q.unidades)} unidades${q.dist_lotes?.lote ? ` del lote ${q.dist_lotes.lote}` : ''}. ${a.toast}`,
      a.label, { destructivo: a.estado === 'destruida' });
    if (!ok) return;
    setOcupado(`${q.id}:${a.estado}`);
    try {
      await resolverCuarentena(q.id, a.estado, nota[q.id]);
      useStaffStore.getState().appendAuditLog?.('DISTRIBUCION_CUARENTENA', String(q.id), { estado: a.estado, unidades: q.unidades, nota: nota[q.id] || null, desde: 'app' });
      listo(a.label, a.toast);
      setHechas((s) => new Set(s).add(q.id));
      onCambio?.();
    } catch (e) {
      fallo('No se pudo resolver', mensajeDeDistribucion(e));
    } finally {
      setOcupado(null);
    }
  };

  const visibles = filas.filter((q) => !hechas.has(q.id));
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal onRequestClose={ocupado ? undefined : onCerrar}>
      <ConAurora>
        <EncabezadoDeHoja titulo="En cuarentena" onCerrar={onCerrar} ocupado={!!ocupado} />
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          <Text style={{ color: colorSistema.texto2, fontSize: 14, marginHorizontal: 4 }}>
            Lo devuelto que no volvió a la venta. No cuenta en la existencia hasta que se decide qué hacer.
          </Text>
          {visibles.length === 0 ? <Vacio enSeccion>Nada esperando decisión.</Vacio> : null}
          {visibles.map((q) => (
            <Seccion key={q.id}>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{q.products?.nombre ?? `Producto ${q.product_id}`}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                    {`${q.dist_lotes?.lote ? `Lote ${q.dist_lotes.lote} · ` : ''}${fechaNumerica(q.created_at)} · ${q.motivo}`}
                  </Text>
                </View>
                <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{`${formatQty(q.unidades)} u`}</Text>
              </View>
              {puedeResolver ? (
                <>
                  <Campo multiline={false} value={nota[q.id] ?? ''} placeholder="Nota (opcional)"
                    onChangeText={(t) => setNota((n) => ({ ...n, [q.id]: t }))} />
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {ACCIONES_CUARENTENA.map((a) => {
                      const esta = ocupado === `${q.id}:${a.estado}`;
                      return (
                        <Pressable key={a.estado} disabled={!!ocupado} onPress={() => resolver(q, a)} accessibilityRole="button"
                          style={({ pressed }) => ({ flex: 1, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5,
                            borderColor: COLOR[a.estado], opacity: ocupado && !esta ? 0.4 : pressed ? 0.7 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
                          {esta ? <Indicador /> : <Text style={{ color: COLOR[a.estado], fontSize: 14, fontWeight: '700' }}>{a.label}</Text>}
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              ) : null}
            </Seccion>
          ))}
          {!puedeResolver && visibles.length ? <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 4 }}>Lo decide quien administra la distribuidora.</Text> : null}
        </ScrollView>
      </ConAurora>
    </Modal>
  );
}

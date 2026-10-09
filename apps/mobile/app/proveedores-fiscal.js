// La revisión de deducibilidad de los proveedores, NATIVA — la pestaña
// «Deducibilidad» de `ProveedoresView` (`PanelDeducibilidad`): las fichas sin
// clasificación confirmada agrupadas POR REGLA y ordenadas por el crédito
// fiscal en juego. El libro de compras sólo usa las confirmadas.
//
//   · Propuestas del sistema: se ven los valores del anexo y se confirman (con
//     la posibilidad de sacar a alguno de la tanda).
//   · Las que la ley condiciona: primero se contesta la pregunta legal, y sólo
//     si da crédito se eligen costo/gasto, sector y tipo (F-07).
//   · «Giro demasiado genérico» no se decide en tanda: se revisa ficha por ficha.
//
// El agrupado, los títulos y las preguntas salen del núcleo
// (`deducibilidadPorRegla`), las escrituras también (`proveedores`).
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { confirmarClasificacionPropuesta, fetchClasificacionFiscalPendiente, resolverClasificacionPendiente } from '@nucleo/data/proveedores';
import { agruparPorRegla } from '@nucleo/utils/deducibilidadPorRegla';
import { CLASIFICACION_OPTIONS, SECTOR_OPTIONS, clasificacionLabel, fmtMoneda, sectorLabel, tipoCostoGastoLabel, tiposCostoGasto } from '@nucleo/utils/f07Catalogos';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';

const cuantos = (k) => (k === 1 ? 'el 1' : `los ${k}`);

function Boton({ texto, color = MARCA.azulClaro, lleno, onPress, deshabilitado }) {
  return (
    <Pressable disabled={deshabilitado} onPress={onPress}
      style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 14, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
        backgroundColor: lleno ? color : 'transparent', borderWidth: lleno ? 0 : 1.2, borderColor: color, opacity: deshabilitado ? 0.4 : pressed ? 0.7 : 1 })}>
      <Text style={{ color: lleno ? '#fff' : color, fontSize: 14, fontWeight: '700' }}>{texto}</Text>
    </Pressable>
  );
}

function Opciones({ titulo, opciones, valor, onCambiar }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: colorSistema.texto2, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 }}>{titulo}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {opciones.map((o) => (
          <Pressable key={o.value} onPress={() => onCambiar(o.value)}
            style={{ minHeight: 36, paddingHorizontal: 12, borderRadius: 18, justifyContent: 'center', backgroundColor: valor === o.value ? MARCA.azulClaro : 'rgba(127,127,127,0.16)' }}>
            <Text style={{ color: valor === o.value ? '#fff' : colorSistema.texto, fontSize: 13, fontWeight: '600' }}>{o.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function Tarjeta({ grupo, puede, onHecho }) {
  const [abierta, setAbierta] = useState(false);
  const [fuera, setFuera] = useState(() => new Set());
  const [respuesta, setRespuesta] = useState(null);
  const [anexo, setAnexo] = useState(() => grupo.pregunta?.aplica || {});
  const [ocupado, setOcupado] = useState(false);
  const esPropuesta = grupo.estado === 'propuesta';
  const pregunta = grupo.pregunta;
  const ids = grupo.rows.filter((r) => !fuera.has(r.id)).map((r) => r.id);
  const n = ids.length;
  const enTanda = !!pregunta && !pregunta.unoPorUno;
  const seleccionable = puede && (esPropuesta || respuesta !== null);

  const correr = async (fn, titulo) => {
    setOcupado(true);
    trabajando('Guardando…');
    try {
      const cambiados = await fn();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      listo(titulo, `${cambiados ?? n} proveedor${(cambiados ?? n) === 1 ? '' : 'es'}.`);
      onHecho();
    } catch (e) {
      fallo('No se pudo guardar', mensajeAmigable(e));
    } finally {
      setOcupado(false);
    }
  };
  const confirmarPropuesta = () => Alert.alert(grupo.titulo, `Confirmar ${cuantos(n)} como deducibles con la propuesta del sistema. Queda con tu nombre y la fecha, y desde ahí el libro de compras la usa.`, [
    { text: 'Cancelar', style: 'cancel' }, { text: 'Confirmar', onPress: () => correr(() => confirmarClasificacionPropuesta(ids), 'Clasificación confirmada') },
  ]);
  const resolver = () => Alert.alert(grupo.titulo, `Confirmar ${cuantos(n)} como ${respuesta ? 'deducibles' : 'NO deducibles'}.${respuesta ? '' : ' Su IVA no entra al libro de compras como crédito fiscal.'}`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Confirmar', onPress: () => correr(() => resolverClasificacionPendiente(ids, {
      iva_deducible: respuesta,
      f07_clasificacion: respuesta && anexo.f07_clasificacion ? Number(anexo.f07_clasificacion) : null,
      f07_sector: respuesta && anexo.f07_sector ? Number(anexo.f07_sector) : null,
      f07_tipo_costo_gasto: respuesta && anexo.f07_tipo_costo_gasto ? Number(anexo.f07_tipo_costo_gasto) : null,
      f07_tipo_operacion: respuesta ? 1 : null,
    }), 'Clasificación confirmada') },
  ]);

  return (
    <View style={{ marginHorizontal: 16 }}>
      <Vidrio radio={20}>
        <View style={{ padding: 14, gap: 8, borderLeftWidth: 3, borderLeftColor: esPropuesta ? MARCA.azulClaro : MARCA.ambar, borderRadius: 20 }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '800' }}>{grupo.titulo}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{grupo.baseLegal || 'Sin giro registrado en la ficha'}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`${grupo.rows.length} proveedor${grupo.rows.length === 1 ? '' : 'es'} · ${grupo.ccf} documento${grupo.ccf === 1 ? '' : 's'}`}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ color: colorSistema.texto, fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{fmtMoneda(grupo.credito)}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 10, fontWeight: '700' }}>CRÉDITO FISCAL</Text>
            </View>
          </View>
          {esPropuesta ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              <Pildora texto="Sí da crédito fiscal" color={MARCA.verde} />
              {[clasificacionLabel(grupo.f07.f07_clasificacion), sectorLabel(grupo.f07.f07_sector), tipoCostoGastoLabel(grupo.f07.f07_tipo_costo_gasto)].filter(Boolean)
                .map((t) => <Pildora key={t} texto={t} color={colorSistema.texto2} />)}
            </View>
          ) : null}
          {pregunta ? (
            <View style={{ gap: 4 }}>
              <Text style={{ color: MARCA.ambar, fontSize: 15, fontWeight: '800' }}>{pregunta.q}</Text>
              {grupo.nota ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{grupo.nota}</Text> : null}
              {grupo.dominante && grupo.rows.length > 1 && grupo.credito > 0 ? (
                <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`El más grande del grupo es ${grupo.dominante.nombre} — ${fmtMoneda(grupo.dominante.credito_fiscal)}, el ${Math.round((grupo.dominante.credito_fiscal / grupo.credito) * 100)}% de lo que está en juego.`}</Text>
              ) : null}
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {esPropuesta && puede ? <Boton texto={`Confirmar ${cuantos(n)}`} lleno deshabilitado={ocupado || !n} onPress={confirmarPropuesta} /> : null}
            {pregunta?.unoPorUno ? <Boton texto="Revisar uno por uno" onPress={() => setAbierta(true)} /> : null}
            {enTanda && puede && respuesta === null ? (
              <>
                <Boton texto={pregunta.si} color={MARCA.verde} onPress={() => { setRespuesta(true); setAnexo(pregunta.aplica || {}); }} />
                <Boton texto={pregunta.no} color={MARCA.rojo} onPress={() => setRespuesta(false)} />
              </>
            ) : null}
            <Boton texto={abierta ? 'Ocultar' : `Ver ${cuantos(grupo.rows.length)}`} color={colorSistema.texto2} onPress={() => setAbierta((a) => !a)} />
          </View>
          {respuesta !== null ? (
            <View style={{ gap: 10 }}>
              {respuesta ? (
                <>
                  <Opciones titulo="COSTO O GASTO" opciones={CLASIFICACION_OPTIONS} valor={anexo.f07_clasificacion || ''} onCambiar={(v) => setAnexo((a) => ({ ...a, f07_clasificacion: v, f07_tipo_costo_gasto: '' }))} />
                  <Opciones titulo="SECTOR" opciones={SECTOR_OPTIONS} valor={anexo.f07_sector || ''} onCambiar={(v) => setAnexo((a) => ({ ...a, f07_sector: v }))} />
                  {anexo.f07_clasificacion ? <Opciones titulo="TIPO DE COSTO O GASTO" opciones={tiposCostoGasto(anexo.f07_clasificacion)} valor={anexo.f07_tipo_costo_gasto || ''} onCambiar={(v) => setAnexo((a) => ({ ...a, f07_tipo_costo_gasto: v }))} /> : null}
                </>
              ) : <Aviso texto={`Quedan como no deducibles: su IVA no entra al libro de compras como crédito fiscal. Son ${fmtMoneda(grupo.credito)}.`} />}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <Boton texto={`Confirmar ${cuantos(n)} como ${respuesta ? 'deducibles' : 'no deducibles'}`} lleno deshabilitado={ocupado || !n || (respuesta && !anexo.f07_tipo_costo_gasto)} onPress={resolver} />
                <Boton texto="Cancelar" color={colorSistema.texto2} onPress={() => setRespuesta(null)} />
              </View>
            </View>
          ) : null}
          {abierta ? grupo.rows.map((r, i) => (
            <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
              {seleccionable ? (
                <Pressable hitSlop={8} onPress={() => setFuera((s) => { const x = new Set(s); if (x.has(r.id)) x.delete(r.id); else x.add(r.id); return x; })} style={{ minWidth: 36, minHeight: 44, justifyContent: 'center' }}>
                  <Text style={{ fontSize: 20, color: fuera.has(r.id) ? colorSistema.texto2 : MARCA.verde }}>{fuera.has(r.id) ? '○' : '●'}</Text>
                </Pressable>
              ) : null}
              <View style={{ flex: 1 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>{r.nombre}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 11 }} numberOfLines={1}>{[r.desc_actividad, `${r.ccf} docs`].filter(Boolean).join(' · ')}</Text>
              </View>
              <Text style={{ color: colorSistema.texto, fontSize: 13, fontWeight: '700' }}>{fmtMoneda(r.credito_fiscal)}</Text>
              <Pressable hitSlop={6} onPress={() => router.push({ pathname: '/proveedor/[id]', params: { id: String(r.id) } })} style={{ minHeight: 44, justifyContent: 'center' }}>
                <Text style={{ color: MARCA.azulClaro, fontSize: 13, fontWeight: '600' }}>Ficha</Text>
              </Pressable>
            </View>
          )) : null}
        </View>
      </Vidrio>
    </View>
  );
}

function Seccion({ titulo, t }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', marginHorizontal: 20, marginTop: 6 }}>
      <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 12, fontWeight: '800', letterSpacing: 0.5 }}>{titulo}</Text>
      <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`${t.provs} proveedores · ${fmtMoneda(t.credito)}`}</Text>
    </View>
  );
}

export default function DeducibilidadDeProveedores() {
  const { hasPermission } = useAuth();
  const puede = hasPermission('proveedores', 'can_edit');
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState(null);
  const [recargando, setRecargando] = useState(false);
  const cargar = useCallback(async () => {
    try { setFilas(await fetchClasificacionFiscalPendiente()); setError(null); } catch (e) { setError(mensajeAmigable(e)); setFilas((f) => f ?? []); }
  }, []);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));
  const { propuestas, condicionadas, sinGiro, totales } = useMemo(() => agruparPorRegla(filas ?? []), [filas]);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Deducibilidad', headerLargeTitle: true }} />
      <ScrollView style={{ flex: 1 }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingVertical: 8, paddingBottom: 48, gap: 12 }}
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {filas == null ? <ActivityIndicator style={{ marginTop: 30 }} /> : !filas.length ? (
          <View style={{ marginHorizontal: 16 }}><Aviso texto="Todo clasificado: cada proveedor tiene su deducibilidad confirmada. El libro de compras ya puede usarlas." /></View>
        ) : (
          <>
            <View style={{ marginHorizontal: 20, gap: 2 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 30, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{fmtMoneda(totales.credito)}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{`de crédito fiscal esperando una decisión, en ${totales.decisiones} decisiones. El libro de compras sólo usa las confirmadas.`}</Text>
            </View>
            {propuestas.length ? <><Seccion titulo="PROPUESTAS DEL SISTEMA" t={totales.prop} />{propuestas.map((g) => <Tarjeta key={g.key} grupo={g} puede={puede} onHecho={cargar} />)}</> : null}
            {condicionadas.length ? <><Seccion titulo="LAS QUE LA LEY CONDICIONA" t={totales.cond} />{condicionadas.map((g) => <Tarjeta key={g.key} grupo={g} puede={puede} onHecho={cargar} />)}</> : null}
            {sinGiro ? (
              <View style={{ marginHorizontal: 16 }}>
                <Aviso texto={`Sin giro registrado: ${sinGiro.rows.length} proveedores · ${sinGiro.ccf} documentos · ${fmtMoneda(sinGiro.credito)}. Nunca llegó un documento suyo con el giro, así que no hay regla que derivar: se clasifican desde su ficha.`} />
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </>
  );
}

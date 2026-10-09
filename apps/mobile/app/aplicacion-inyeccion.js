// Cobrar la aplicación de una inyección, NATIVO — `DialogoAplicacion` de «Mi
// caja». Cuatro modos, como el portal:
//   · Compró aquí: se elige la venta de la sala y cuántas se pagan de cada
//     inyección (o, con dos o más, «se mezclan en la misma jeringa»: se cobra
//     UNA por vez). Lo que va por mililitros pide cuánto se pone.
//   · Otra sucursal: se busca la venta por el número de comprobante del ticket.
//   · La trajo: qué inyección y cuántas (vale distinto).
//   · Ya la pagó: se marcan aplicadas las pendientes a nombre del cliente.
// Lo pagado y no aplicado queda PENDIENTE a nombre del cliente (obligatorio).
// El monto no se escribe: lo calcula el núcleo (`cuentaDelCobro`) y el servidor
// lo vuelve a calcular. La clave de envío evita cobrar dos veces.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { anotarIngreso, fetchTiposDeMovimiento } from '@nucleo/data/bolsas';
import { aplicarPendientes, buscarVentaPorComprobante, fetchAplicacionesPendientes, fetchInyeccionesParaCobrar, fetchPreciosDeAplicacion } from '@nucleo/data/inyecciones';
import { buscarClientes } from '@nucleo/data/customers';
import { aplicacionDelCobro, cuentaDelCobro, gruposDePendientes, itemsDelCobro, seleccionDeVenta, topeDeMezcla } from '@nucleo/utils/cobroDeAplicacion';
import { aplicacionesPorDosis, esPorMl, fmtMl, saldoDelRenglon } from '@nucleo/utils/inyeccionDosis';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Dato, Seccion } from '../componentes/formulario/Piezas';
import Segmentos from '../componentes/Segmentos';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';
import { comprobanteDelMovimiento } from '../componentes/cortes/papel';

const MODOS = [{ id: 'COMPRADA', label: 'Compró aquí' }, { id: 'OTRA', label: 'Otra sucursal' }, { id: 'TRAIDA', label: 'La trajo' }, { id: 'CANJEAR', label: 'Ya la pagó' }];
const factura = (c) => String(c || '').replace(/^0+/, '');

function Contador({ etiqueta, valor, min = 0, max = 99, onCambiar }) {
  const b = (t, n, off) => (
    <Pressable onPress={() => onCambiar(n)} disabled={off} accessibilityRole="button" accessibilityLabel={`${t} ${etiqueta}`}
      style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(127,127,127,0.18)', opacity: off ? 0.3 : pressed ? 0.6 : 1 })}>
      <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '700' }}>{t}</Text>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      {b('−', Math.max(min, valor - 1), valor <= min)}
      <Text style={{ color: colorSistema.texto, fontSize: 18, fontWeight: '800', minWidth: 28, textAlign: 'center', fontVariant: ['tabular-nums'] }}>{valor}</Text>
      {b('+', Math.min(max, valor + 1), valor >= max)}
    </View>
  );
}

function Venta({ v, activa, onElegir }) {
  const agotada = Number(v.disponibles) <= 0;
  return (
    <Pressable onPress={agotada ? undefined : onElegir} disabled={agotada} style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}>
      <Vidrio radio={16} interactivo={!agotada} tinte={activa ? 'rgba(52,120,246,0.18)' : undefined}>
        <View style={{ padding: 12, gap: 4, opacity: agotada ? 0.5 : 1 }}>
          <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{v.cliente || 'Sin nombre'}</Text>
          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
            {[`${fechaNumerica(v.fecha, { anio: false })} · ${hora12(v.hora)}`, v.sala && !v.propia ? v.sala : null, `Factura ${factura(v.correlativo)}`, v.vendedor_nombre ? shortEmployeeName({ name: v.vendedor_nombre }) : null].filter(Boolean).join(' · ')}
          </Text>
          {(v.renglones || []).map((r) => (
            <Text key={r.linea_num} style={{ color: colorSistema.texto2, fontSize: 13 }}>
              {`${r.descripcion}: ${r.disponibles <= 0 ? 'ya pagadas' : esPorMl(r) && r.dosis_ml == null ? `hasta ${r.disponibles} por pagar, según la dosis` : `${r.disponibles} de ${r.total} por pagar${esPorMl(r) ? ` · a ${fmtMl(r.dosis_ml)} ml` : ''}`}`}
            </Text>
          ))}
          {agotada && v.ultimo_cobro?.por ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`Cobró ${shortEmployeeName({ name: v.ultimo_cobro.por })}`}</Text> : null}
        </View>
      </Vidrio>
    </Pressable>
  );
}

export default function AplicacionInyeccion() {
  const { sala } = useLocalSearchParams();
  const { user, hasPermission } = useAuth();
  const puedeOperar = hasPermission('caja_vales', 'can_edit');
  const sucursales = useStaffStore((s) => s.branches);
  const nombreSala = (sucursales || []).find((b) => String(b.id) === String(sala))?.name ?? '';
  const [modo, setModo] = useState('COMPRADA');
  const [precios, setPrecios] = useState(null);
  const [tipo, setTipo] = useState(null);
  const [texto, setTexto] = useState('');
  const [ventas, setVentas] = useState(null);
  const [ventaId, setVentaId] = useState(null);
  const [ventaExterna, setVentaExterna] = useState(null);
  const [cuantas, setCuantas] = useState({});
  const [dosis, setDosis] = useState({});
  const [mezcla, setMezcla] = useState(false);
  const [enMezcla, setEnMezcla] = useState(() => new Set());
  const [vecesMezcla, setVecesMezcla] = useState(1);
  const [comprobante, setComprobante] = useState('');
  const [encontradas, setEncontradas] = useState(null);
  const [producto, setProducto] = useState('');
  const [cantidad, setCantidad] = useState(1);
  const [aplicarAhora, setAplicarAhora] = useState(1);
  const [aNombreDe, setANombreDe] = useState('');
  const [ficha, setFicha] = useState(null);
  const [buscaFicha, setBuscaFicha] = useState('');
  const [fichas, setFichas] = useState([]);
  const [pendientes, setPendientes] = useState(null);
  const [textoPend, setTextoPend] = useState('');
  const [cuantasCanje, setCuantasCanje] = useState({});
  const [enviando, setEnviando] = useState(false);
  const [clave] = useState(() => `app-aplicacion-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  useEffect(() => {
    Promise.resolve(fetchPreciosDeAplicacion()).then(setPrecios).catch((e) => fallo('No se pudo leer el precio de la aplicación', mensajeAmigable(e)));
    Promise.resolve(fetchTiposDeMovimiento()).then((t) => setTipo((t || []).find((x) => x.codigo === 'APLICACION') || null)).catch(() => {});
  }, []);
  useEffect(() => {
    if (modo !== 'COMPRADA' || !sala) return undefined;
    let vivo = true;
    const t = setTimeout(() => {
      Promise.resolve(fetchInyeccionesParaCobrar({ sala, buscar: texto })).then((d) => { if (vivo) setVentas(d || []); })
        .catch((e) => { if (vivo) { setVentas([]); fallo('No se pudieron cargar las ventas', mensajeAmigable(e)); } });
    }, texto ? 350 : 0);
    return () => { vivo = false; clearTimeout(t); };
  }, [modo, sala, texto]);
  const [vueltaPend, setVueltaPend] = useState(0);
  const cargarPendientes = () => setVueltaPend((n) => n + 1);
  useEffect(() => {
    if (modo !== 'CANJEAR') return undefined;
    let vivo = true;
    const t = setTimeout(() => {
      Promise.resolve(fetchAplicacionesPendientes({ buscar: textoPend }))
        .then((d) => { if (vivo) { setCuantasCanje({}); setPendientes(d); } })
        .catch((e) => { if (vivo) { setPendientes([]); fallo('No se pudieron cargar las pendientes', mensajeAmigable(e)); } });
    }, 350);
    return () => { vivo = false; clearTimeout(t); };
  }, [modo, textoPend, vueltaPend]);
  useEffect(() => {
    if (ficha || buscaFicha.trim().length < 3) return undefined;
    let vivo = true;
    const t = setTimeout(() => Promise.resolve(buscarClientes(buscaFicha, { select: 'id, name, dui, phone', limite: 6 })).then(({ data }) => { if (vivo) setFichas(data ?? []); }).catch(() => {}), 300);
    return () => { vivo = false; clearTimeout(t); };
  }, [buscaFicha, ficha]);

  const venta = useMemo(() => (ventaExterna?.id === ventaId ? ventaExterna : null) || (ventas || []).find((v) => v.id === ventaId) || null, [ventas, ventaId, ventaExterna]);
  const renglonDe = useCallback((l) => (venta?.renglones || []).find((r) => r.linea_num === Number(l)), [venta]);
  const veces = Math.min(vecesMezcla, topeDeMezcla(enMezcla, renglonDe, dosis));
  const items = useMemo(() => itemsDelCobro({ mezcla, enMezcla, veces, cuantas, ventaId, dosis, renglonDe }), [mezcla, enMezcla, veces, cuantas, ventaId, dosis, renglonDe]);
  const c = cuentaDelCobro({ modo, precios, items, mezcla, veces, cantidad, aplicarAhora, aNombreDe, venta, producto, sala });
  const grupos = useMemo(() => gruposDePendientes(pendientes), [pendientes]);
  const idsACanjear = grupos.flatMap((g) => g.ids.slice(0, cuantasCanje[g.clave] || 0));

  const elegirVenta = (v, externa = false) => {
    const sel = seleccionDeVenta(v);
    setVentaExterna(externa ? v : null); setVentaId(v.id);
    setCuantas(sel.cuantas); setDosis(sel.dosis); setMezcla(false); setEnMezcla(sel.enMezcla); setVecesMezcla(1); setAplicarAhora(1); setANombreDe(sel.aNombreDe);
  };
  const cambiarModo = (m) => { setModo(m); setVentaId(null); setVentaExterna(null); setCuantas({}); setMezcla(false); setEncontradas(null); };

  const buscarComp = async () => {
    trabajando('Buscando el comprobante…');
    try { setEncontradas(await buscarVentaPorComprobante({ sala, comprobante })); listo('Búsqueda lista'); }
    catch (e) { setEncontradas(null); fallo('No se pudo buscar el comprobante', mensajeAmigable(e)); }
  };

  const cobrar = () => Alert.alert(`¿Cobrar ${formatMoney(c.monto)}?`,
    `${c.total} ${c.total === 1 ? 'aplicación' : 'aplicaciones'}${c.quedan > 0 ? `; ${c.quedan} quedan pendientes a nombre de ${aNombreDe.trim()}` : ''}. Entra a la caja de ${nombreSala}.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Cobrar', onPress: async () => {
        setEnviando(true); trabajando('Cobrando…');
        const r = await anotarIngreso({
          sala, monto: c.monto, clave, tipo: 'APLICACION', concepto: tipo?.etiqueta || 'Aplicacion de inyeccion',
          aplicacion: aplicacionDelCobro({ origen: c.origen, items, producto, cantidad, ahora: c.ahora, quedan: c.quedan, aNombreDe, ficha }),
        }).catch((e) => ({ error: e }));
        setEnviando(false);
        if (r?.error) { fallo('No se pudo cobrar', mensajeAmigable(r.error)); return; }
        const papel = r?.movimiento ? await comprobanteDelMovimiento(r.movimiento, {
          etiqueta: tipo?.etiqueta || 'Aplicación de inyección',
          detalle: String(r.movimiento.detalle || r.movimiento.concepto || '').replace(/^Aplicacion de inyeccion · /, ''),
          persona: '', comoSeComprobo: null,
        }, sala, nombreSala, user?.name || '') : { ok: true };
        if (r?.aviso) fallo('Cobrado, con un pendiente', r.aviso);
        else if (!papel.ok) fallo('Cobrado, pero el comprobante no salió', papel.detalle);
        else listo(c.ahora > 0 ? 'Aplicación cobrada' : 'Aplicación cobrada', c.quedan > 0 ? 'Queda pendiente a nombre del cliente.' : undefined);
        router.back();
      } },
    ]);

  const canjear = () => Alert.alert(idsACanjear.length > 1 ? `¿Marcar ${idsACanjear.length} aplicadas?` : '¿Marcar aplicada?', 'Quedan como aplicadas por ti.', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Marcar', onPress: async () => {
      setEnviando(true); trabajando('Marcando…');
      try {
        const n = await aplicarPendientes(idsACanjear, sala);
        useStaffStore.getState().appendAuditLog?.('INYECCION_APLICADA', idsACanjear.join(','), { aplicaciones: n, sala, desde: 'app' });
        listo(n === 1 ? 'Aplicación marcada' : `${n} aplicaciones marcadas`);
      } catch (e) { fallo('No se pudieron marcar', mensajeAmigable(e)); }
      setEnviando(false);
      cargarPendientes();
    } },
  ]);

  if (!puedeOperar) return (<><Stack.Screen options={{ ...BARRA_NATIVA, title: 'Aplicación' }} /><View style={{ padding: 20 }}><Aviso tono="freno" texto="Cobrar aplicaciones es de quien opera la caja." /></View></>);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Aplicación de inyección' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? undefined : 'height'}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 14, paddingBottom: 48 }}
          contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          <Segmentos opciones={MODOS} activa={modo} onCambiar={cambiarModo} />
          <View style={{ marginHorizontal: 16, gap: 14 }}>
            {precios ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Comprada aquí ${formatMoney(precios.COMPRADA)} · traída ${formatMoney(precios.TRAIDA)} por aplicación`}</Text> : null}

            {(modo === 'COMPRADA' || modo === 'OTRA') && !venta ? (
              modo === 'COMPRADA' ? (
                <>
                  <Campo multiline={false} value={texto} onChangeText={setTexto} placeholder="Cliente, factura o inyección" />
                  {ventas == null ? <ActivityIndicator /> : !ventas.length ? <Aviso texto="Sin ventas con inyección por cobrar. Una venta recién hecha tarda hasta un minuto en llegar." />
                    : ventas.map((v) => <Venta key={v.id} v={v} activa={false} onElegir={() => elegirVenta(v)} />)}
                </>
              ) : (
                <>
                  <Campo multiline={false} value={comprobante} onChangeText={setComprobante} keyboardType="number-pad" placeholder="Número de comprobante del ticket" />
                  <BotonGrande texto="Buscar" borde deshabilitado={!comprobante.trim()} onPress={buscarComp} />
                  {encontradas && !encontradas.length ? <Aviso texto="No se encontró una venta con ese comprobante." /> : null}
                  {(encontradas || []).map((v) => (v.estado === 'ok'
                    ? <Venta key={v.id} v={v} activa={false} onElegir={() => elegirVenta(v, true)} />
                    : <Aviso key={v.id ?? v.correlativo} tono="cuidado" texto={`Factura ${factura(v.correlativo)} · ${v.sala}: ${v.estado === 'sin_inyeccion' ? 'esa venta no tiene inyecciones.' : v.estado === 'pagada' ? 'ya tiene todas sus aplicaciones pagadas.' : 'esa venta está anulada.'}`} />))}
                </>
              )
            ) : null}

            {venta && (modo === 'COMPRADA' || modo === 'OTRA') ? (
              <>
                <Venta v={venta} activa onElegir={() => {}} />
                <BotonGrande texto="Cambiar venta" borde onPress={() => { setVentaId(null); setVentaExterna(null); setCuantas({}); setMezcla(false); }} />
                {(venta.renglones || []).filter((r) => r.disponibles > 0).length >= 2 ? (
                  <Pressable onPress={() => setMezcla((m) => !m)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40, opacity: pressed ? 0.55 : 1 })}>
                    <Text style={{ color: mezcla ? MARCA.verde : colorSistema.texto2, fontSize: 20 }}>{mezcla ? '☑' : '☐'}</Text>
                    <Text style={{ color: colorSistema.texto, fontSize: 15 }}>Se mezclan en la misma jeringa</Text>
                  </Pressable>
                ) : null}
                <Seccion titulo="Qué se paga">
                  {(venta.renglones || []).filter((r) => r.disponibles > 0).map((r) => {
                    const saldo = saldoDelRenglon(r, dosis[r.linea_num]);
                    const porMl = esPorMl(r);
                    return (
                      <View key={r.linea_num} style={{ gap: 6 }}>
                        <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{r.descripcion}</Text>
                        <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>
                          {porMl && r.dosis_ml == null ? `${fmtMl(r.contenido_ml)} ml por unidad · elige cuánto se pone` : `${saldo?.disponibles ?? r.disponibles} por pagar${porMl && saldo ? ` · ${fmtMl(saldo.dosis)} ml cada una` : ''}`}
                        </Text>
                        {porMl && r.dosis_ml == null && (r.opciones_ml || []).length > 1 ? (
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                            {(r.opciones_ml || []).map((d) => {
                              const n = Math.floor(Number(r.unidades) * aplicacionesPorDosis(r.contenido_ml, d));
                              const activa = dosis[r.linea_num] != null && Number(dosis[r.linea_num]) === Number(d);
                              return (
                                <Pressable key={d} onPress={() => { setDosis((x) => ({ ...x, [r.linea_num]: d })); setCuantas((q) => ({ ...q, [r.linea_num]: Math.min(q[r.linea_num] || 0, n) })); }}
                                  style={({ pressed }) => ({ minHeight: 36, paddingHorizontal: 12, borderRadius: 18, justifyContent: 'center', backgroundColor: activa ? MARCA.azul : 'rgba(127,127,127,0.18)', opacity: pressed ? 0.6 : 1 })}>
                                  <Text style={{ color: activa ? '#fff' : colorSistema.texto, fontSize: 13, fontWeight: '700' }}>{`${fmtMl(d)} ml · ${n}`}</Text>
                                </Pressable>
                              );
                            })}
                          </View>
                        ) : null}
                        {mezcla ? (
                          <Pressable onPress={() => setEnMezcla((s) => { const x = new Set(s); if (x.has(r.linea_num)) x.delete(r.linea_num); else x.add(r.linea_num); return x; })}
                            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 36, opacity: pressed ? 0.55 : 1 })}>
                            <Text style={{ color: enMezcla.has(r.linea_num) ? MARCA.verde : colorSistema.texto2, fontSize: 18 }}>{enMezcla.has(r.linea_num) ? '☑' : '☐'}</Text>
                            <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Entra en la mezcla</Text>
                          </Pressable>
                        ) : <Contador etiqueta={r.descripcion} valor={cuantas[r.linea_num] || 0} max={saldo?.disponibles ?? r.disponibles} onCambiar={(n) => setCuantas((q) => ({ ...q, [r.linea_num]: n }))} />}
                      </View>
                    );
                  })}
                  {mezcla ? (enMezcla.size < 2 ? <Aviso tono="cuidado" texto="Elige al menos dos para mezclar." />
                    : <View style={{ gap: 4 }}><Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Aplicaciones mezcladas</Text><Contador etiqueta="aplicaciones mezcladas" valor={veces} min={1} max={Math.max(1, topeDeMezcla(enMezcla, renglonDe, dosis))} onCambiar={setVecesMezcla} /></View>) : null}
                  {c.faltaDosis ? <Aviso tono="cuidado" texto="Falta elegir cuánto se pone." /> : null}
                </Seccion>
              </>
            ) : null}

            {modo === 'TRAIDA' ? (
              <Seccion titulo="La trajo el cliente">
                <Campo multiline={false} value={producto} maxLength={40} onChangeText={setProducto} placeholder="Qué inyección (Neurobion 25000)" />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>Aplicaciones</Text><Contador etiqueta="aplicaciones" valor={cantidad} min={1} max={10} onCambiar={setCantidad} /></View>
                {ficha ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>{`Ficha: ${ficha.name}`}</Text>
                    <Pressable onPress={() => { setFicha(null); setBuscaFicha(''); }}><Text style={({ pressed }) => ({ color: MARCA.rojo, fontWeight: '700', opacity: pressed ? 0.55 : 1 })}>Quitar</Text></Pressable>
                  </View>
                ) : (
                  <>
                    <Campo multiline={false} value={buscaFicha} onChangeText={setBuscaFicha} placeholder="Ficha del cliente (opcional): nombre, DUI o teléfono" />
                    {buscaFicha.trim().length >= 3 ? fichas.map((f) => (
                      <Pressable key={f.id} onPress={() => setFicha(f)} style={({ pressed }) => ({ minHeight: 40, justifyContent: 'center', opacity: pressed ? 0.55 : 1 })}>
                        <Text style={{ color: colorSistema.texto, fontSize: 14 }}>{`${f.name}${f.dui ? ` · ${f.dui}` : ''}`}</Text>
                      </Pressable>
                    )) : null}
                  </>
                )}
              </Seccion>
            ) : null}

            {modo !== 'CANJEAR' && c.total > 0 ? (
              <Seccion titulo="El cobro">
                <Dato primero rotulo={`${c.total} ${c.total === 1 ? 'aplicación' : 'aplicaciones'}`} valor={c.monto == null ? '—' : formatMoney(c.monto)} fuerte />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>Se aplican ahora</Text><Contador etiqueta="se aplican ahora" valor={c.ahora} max={c.total} onCambiar={setAplicarAhora} /></View>
                {c.quedan > 0 ? <Campo multiline={false} value={aNombreDe} maxLength={80} onChangeText={setANombreDe} placeholder={`A nombre de (quedan ${c.quedan}): nombre del cliente`} /> : null}
              </Seccion>
            ) : null}
            {modo !== 'CANJEAR' ? <BotonGrande texto={enviando ? 'Cobrando…' : c.monto != null && c.total > 0 ? `Cobrar ${formatMoney(c.monto)}` : 'Cobrar'} color={MARCA.verde} deshabilitado={enviando || !c.valido} onPress={cobrar} /> : null}

            {modo === 'CANJEAR' ? (
              <>
                <Campo multiline={false} value={textoPend} onChangeText={setTextoPend} placeholder="Cliente, factura o inyección" />
                {pendientes == null ? <ActivityIndicator /> : !grupos.length ? <Aviso texto="Sin aplicaciones pagadas por aplicar." /> : grupos.map(({ clave: k, muestra: p, ids }) => (
                  <Seccion key={k} titulo={`${p.producto}${p.dosis_ml != null ? ` · ${fmtMl(p.dosis_ml)} ml` : ''}`}>
                    <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                      {[p.cliente, p.correlativo ? `Factura ${factura(p.correlativo)}` : null, p.venta_sala || p.sala, p.mezclada ? 'mezclada' : null, `${ids.length} por aplicar`].filter(Boolean).join(' · ')}
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>Se aplican ahora</Text>
                      <Contador etiqueta={p.producto} valor={cuantasCanje[k] || 0} max={ids.length} onCambiar={(n) => setCuantasCanje((x) => ({ ...x, [k]: n }))} /></View>
                  </Seccion>
                ))}
                <BotonGrande texto={idsACanjear.length > 1 ? `Marcar ${idsACanjear.length} aplicadas` : 'Marcar aplicada'} color={MARCA.verde} deshabilitado={enviando || !idsACanjear.length} onPress={canjear} />
              </>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

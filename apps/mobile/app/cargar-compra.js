// Cargar compra, NATIVO — la vista del portal (`CargarCompraView`): las
// facturas de compra que llegaron por correo y todavía no se cargaron, y la
// lista de productos de proveedor «por confirmar».
//
// El portal ARMA la compra desde el documento (producto, cantidad, costo, lote
// y vencimiento) y dice de dónde salió cada dato; todavía no registra nada en
// el sistema. Lo único que escribe es el DICCIONARIO: confirmar que el código
// de un proveedor es nuestro producto, o apartar un renglón que no es un
// producto (un flete, un descuento). Las consultas son las del núcleo
// (`cargarCompra`), las mismas del portal.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { apartarRenglon, barrerDocumentos, confirmarProducto, fetchDocumentosSinCargar, fetchProductosPorConfirmar } from '@nucleo/data/cargarCompra';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import Segmentos from '../componentes/Segmentos';
import Vidrio from '../componentes/Vidrio';
import BuscadorProducto from '../componentes/compras/BuscadorProducto';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando, cerrarProgreso } from '../componentes/Progreso';

const PERIODOS = [{ id: '30', label: 'Último mes' }, { id: '60', label: 'Últimos 2 meses' }, { id: '180', label: 'Últimos 6 meses' }];
const ESTADOS = [{ id: 'pendientes', label: 'Sin resolver' }, { id: 'apartados', label: 'No son productos' }, { id: 'resueltos', label: 'Confirmados' }, { id: 'todos', label: 'Todos' }];
const ORIGEN = { codigo_barras: ['Código de barras', MARCA.verde], aprendido: ['Ya confirmado', MARCA.verde], parecido: ['Por parecido', MARCA.ambar] };
const plural = (n, uno, muchos) => `${n} ${Number(n) === 1 ? uno : muchos}`;
const fmtFecha = (iso) => fechaNumerica(iso, { anio: 'corto', vacio: '—' });
const POR_PAGINA = 40;

function Cuenta({ rotulo, valor, sub, color }) {
  return (
    <View style={{ flex: 1 }}>
      <Vidrio radio={18}>
        <View style={{ padding: 12, gap: 2 }}>
          <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '600' }}>{rotulo}</Text>
          <Text style={{ color: color ?? colorSistema.texto, fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] }} numberOfLines={1} adjustsFontSizeToFit>{valor ?? '—'}</Text>
          {sub ? <Text style={{ color: colorSistema.texto2, fontSize: 11 }} numberOfLines={1}>{sub}</Text> : null}
        </View>
      </Vidrio>
    </View>
  );
}

function Facturas({ busca, dias }) {
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState('');
  const [hasta, setHasta] = useState(POR_PAGINA);
  const cargar = useCallback(async () => {
    const { filas: f, error: e } = await fetchDocumentosSinCargar(Number(dias));
    setError(e?.message ?? '');
    setFilas(f ?? []);
  }, [dias]);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));
  useEffect(() => { setHasta(POR_PAGINA); }, [busca, dias]); // eslint-disable-line react-hooks/set-state-in-effect -- volver a la primera tanda al cambiar el filtro
  const visibles = useMemo(() => (busca.trim() ? (filas ?? []).filter((f) => tokenMatch(busca, f.emisor_nombre, f.proveedor_ficha, f.codigo_generacion)) : (filas ?? [])), [filas, busca]);
  const t = useMemo(() => (filas ?? []).reduce((a, f) => ({ monto: a.monto + Number(f.monto_total || 0), renglones: a.renglones + Number(f.renglones || 0), viejos: a.viejos + (Number(f.dias_desde) > 15 ? 1 : 0) }), { monto: 0, renglones: 0, viejos: 0 }), [filas]);
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', gap: 8, marginHorizontal: 16 }}>
        <Cuenta rotulo="Sin cargar" valor={filas?.length} sub={`${t.renglones} renglones`} />
        <Cuenta rotulo="Monto" valor={filas ? formatMoney(t.monto) : null} sub="que esperan" color={MARCA.ambar} />
        <Cuenta rotulo="+15 días" valor={filas ? t.viejos : null} sub="documentos" color={t.viejos ? MARCA.ambar : undefined} />
      </View>
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      <View style={{ marginHorizontal: 16 }}><Aviso texto="El portal arma la compra desde el documento y dice de dónde salió cada dato. Todavía no registra nada en el sistema: es para revisarla. Lo que queda guardado es cada producto que confirmes." /></View>
      {filas == null ? <ActivityIndicator /> : !visibles.length ? <Text style={{ color: colorSistema.texto2, textAlign: 'center', marginTop: 30 }}>Sin facturas esperando carga en este período.</Text> : (
        <View style={{ marginHorizontal: 16 }}>
          <Vidrio radio={22}>
            <View style={{ paddingVertical: 4 }}>
              {visibles.slice(0, hasta).map((f, i) => (
                <Pressable key={f.document_id} onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push({ pathname: '/propuesta-compra/[id]', params: { id: String(f.document_id), proveedor: f.proveedor_ficha ?? f.emisor_nombre, fecha: f.fecha_emision ?? '', total: String(f.monto_total ?? '') } }); }}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, minHeight: 56,
                    borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, backgroundColor: pressed ? 'rgba(127,127,127,0.15)' : 'transparent' })}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{f.proveedor_ficha ?? f.emisor_nombre}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 12 }} numberOfLines={1}>{[fmtFecha(f.fecha_emision), plural(f.renglones, 'renglón', 'renglones'), !f.tiene_pdf ? 'sin archivo impreso' : null].filter(Boolean).join(' · ')}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(f.monto_total)}</Text>
                    {f.dias_desde > 15 ? <Pildora texto={`${f.dias_desde} días`} color={MARCA.ambar} /> : <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`${f.dias_desde} d`}</Text>}
                  </View>
                </Pressable>
              ))}
            </View>
          </Vidrio>
          {visibles.length > hasta ? <View style={{ marginTop: 10 }}><BotonGrande texto={`Ver más (${visibles.length - hasta})`} borde onPress={() => setHasta((h) => h + POR_PAGINA)} /></View> : null}
        </View>
      )}
    </View>
  );
}

function PorConfirmar({ busca, estado, puedeEditar }) {
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState('');
  const [abierto, setAbierto] = useState(null);
  const [ocupado, setOcupado] = useState(null);
  const [hasta, setHasta] = useState(POR_PAGINA);
  const cargar = useCallback(async () => {
    const { filas: f, error: e } = await fetchProductosPorConfirmar(estado);
    setError(e?.message ?? '');
    setFilas(f ?? []);
  }, [estado]);
  useEffect(() => { setFilas(null); cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga al cambiar el estado
  useEffect(() => { setHasta(POR_PAGINA); }, [busca, estado]); // eslint-disable-line react-hooks/set-state-in-effect -- volver a la primera tanda al cambiar el filtro
  const visibles = useMemo(() => (busca.trim() ? (filas ?? []).filter((f) => tokenMatch(busca, f.proveedor, f.descripcion, f.codigo_proveedor, f.sugerido_nombre)) : (filas ?? [])), [filas, busca]);
  const t = useMemo(() => {
    const r = { preguntas: 0, renglones: 0, sinCandidato: 0 };
    for (const f of filas ?? []) {
      if (estado === 'pendientes' && (f.resuelto || f.ignorado)) continue;
      r.preguntas++; r.renglones += Number(f.renglones || 0); if (!f.sugerido_product_id) r.sinCandidato++;
    }
    return r;
  }, [filas, estado]);

  const barrer = async () => {
    trabajando('Leyendo los documentos…');
    for (let vuelta = 0; vuelta < 30; vuelta++) {
      const { resultado, error: e } = await barrerDocumentos({ dias: 90, tanda: 40 });
      if (e) { fallo('No se pudo actualizar', String(e?.message ?? e)); return; }
      trabajando(`Leídos ${resultado.leidos} · quedan ${resultado.restantes}`);
      if (resultado.leidos === 0 || resultado.restantes === 0) break;
    }
    cerrarProgreso();
    await cargar();
  };
  const confirmar = (f, producto) => Alert.alert('Confirmar el producto', `«${f.descripcion}» de ${f.proveedor} es ${producto.nombre}. Resuelve las ${plural(f.renglones, 'línea', 'líneas')} donde aparece, hoy y en adelante.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Confirmar', onPress: async () => {
      setOcupado(f.id);
      const { error: e } = await confirmarProducto(f.emisor_nit, f.llave, producto.id, { proveedor: f.proveedor, producto: producto.nombre, renglones: f.renglones, desde: 'app' });
      setOcupado(null);
      if (e) { fallo('No se pudo confirmar', String(e?.message ?? e)); return; }
      listo('Confirmado', producto.nombre); setAbierto(null); await cargar();
    } },
  ]);
  const apartar = (f, deshacer) => Alert.alert(deshacer ? 'Devolver a la lista' : 'No es un producto', deshacer ? 'Vuelve a la cola de por confirmar.' : `«${f.descripcion}» deja de preguntarse (un flete, un servicio, un descuento).`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: deshacer ? 'Devolver' : 'Apartar', onPress: async () => {
      setOcupado(f.id);
      const { error: e } = await apartarRenglon(f.id, deshacer, { proveedor: f.proveedor, codigo: f.codigo_proveedor, descripcion: f.descripcion, renglones: f.renglones, desde: 'app' });
      setOcupado(null);
      if (e) { fallo('No se pudo', String(e?.message ?? e)); return; }
      await cargar();
    } },
  ]);

  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', gap: 8, marginHorizontal: 16 }}>
        <Cuenta rotulo={ESTADOS.find((e) => e.id === estado)?.label} valor={filas ? t.preguntas : null} sub="productos distintos" />
        <Cuenta rotulo="Renglones" valor={filas ? t.renglones : null} sub="que destraban" />
        {estado === 'pendientes' ? <Cuenta rotulo="Sin candidato" valor={filas ? t.sinCandidato : null} sub="a mano" color={t.sinCandidato ? MARCA.ambar : undefined} /> : null}
      </View>
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      <View style={{ marginHorizontal: 16 }}>
        <Aviso texto={estado === 'apartados' ? 'Lo marcado como que no es un producto. Si fue un error, «Devolver a la lista» lo pone otra vez a la cola.' : 'Cada línea es un producto de un proveedor: confirmarla resuelve todas las facturas donde aparece, las de hoy y las que vengan.'} />
      </View>
      {puedeEditar ? <View style={{ marginHorizontal: 16 }}><BotonGrande texto="Actualizar la lista" borde onPress={barrer} /></View> : null}
      {filas == null ? <ActivityIndicator /> : !visibles.length ? <Text style={{ color: colorSistema.texto2, textAlign: 'center', marginTop: 30, marginHorizontal: 24 }}>{estado === 'pendientes' ? 'Sin productos por confirmar. Si llegaron facturas nuevas, toca «Actualizar la lista».' : 'Nada en esta lista.'}</Text> : (
        visibles.slice(0, hasta).map((f) => {
          const o = ORIGEN[f.sugerido_origen];
          return (
            <View key={f.id} style={{ marginHorizontal: 16, opacity: f.ignorado ? 0.65 : 1 }}>
              <Vidrio radio={20}>
                <View style={{ padding: 14, gap: 6 }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{f.sugerido_nombre ?? '— sin candidato —'}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{f.descripcion}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{[f.proveedor, f.codigo_proveedor ? `código ${f.codigo_proveedor}` : null, `${plural(f.renglones, 'renglón', 'renglones')} en ${plural(f.documentos, 'factura', 'facturas')}`].filter(Boolean).join(' · ')}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {f.ignorado ? <Pildora texto="Apartado" color={colorSistema.texto2} /> : null}
                    {f.resuelto ? <Pildora texto="Confirmado" color={MARCA.verde} /> : null}
                    {!f.resuelto && !f.ignorado && o ? <Pildora texto={`${o[0]}${f.sugerido_origen === 'parecido' && f.sugerido_similitud != null ? ` · ${Math.round(f.sugerido_similitud * 100)}%` : ''}`} color={o[1]} /> : null}
                  </View>
                  {puedeEditar ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
                      {!f.resuelto && !f.ignorado && f.sugerido_product_id ? <Accion texto="Es correcto" color={MARCA.verde} ocupado={ocupado === f.id} onPress={() => confirmar(f, { id: f.sugerido_product_id, nombre: f.sugerido_nombre })} /> : null}
                      {!f.ignorado ? <Accion texto={f.resuelto ? 'Es otro' : f.sugerido_product_id ? 'Es otro' : 'Elegir'} ocupado={ocupado === f.id} onPress={() => setAbierto(abierto === f.id ? null : f.id)} /> : null}
                      {!f.resuelto && !f.ignorado ? <Accion texto="No es un producto" color={colorSistema.texto2} ocupado={ocupado === f.id} onPress={() => apartar(f, false)} /> : null}
                      {f.ignorado ? <Accion texto="Devolver a la lista" ocupado={ocupado === f.id} onPress={() => apartar(f, true)} /> : null}
                    </View>
                  ) : null}
                  {abierto === f.id ? <BuscadorProducto onElegir={(p) => confirmar(f, p)} onCancelar={() => setAbierto(null)} /> : null}
                </View>
              </Vidrio>
            </View>
          );
        })
      )}
      {visibles.length > hasta ? <View style={{ marginHorizontal: 16 }}><BotonGrande texto={`Ver más (${visibles.length - hasta})`} borde onPress={() => setHasta((h) => h + POR_PAGINA)} /></View> : null}
    </View>
  );
}

function Accion({ texto, color = MARCA.azulClaro, onPress, ocupado }) {
  return (
    <Pressable disabled={ocupado} onPress={onPress} style={({ pressed }) => ({ minHeight: 40, justifyContent: 'center', opacity: ocupado ? 0.4 : pressed ? 0.6 : 1 })}>
      <Text style={{ color, fontSize: 14, fontWeight: '700' }}>{texto}</Text>
    </Pressable>
  );
}

export default function CargarCompra() {
  const { hasPermission } = useAuth();
  const puedeEditar = hasPermission('compras', 'can_edit') || hasPermission('facturas_compra', 'can_edit');
  const [tab, setTab] = useState('facturas');
  const [busca, setBusca] = useState('');
  const [dias, setDias] = useState('30');
  const [estado, setEstado] = useState('pendientes');
  const grupos = tab === 'facturas'
    ? [{ id: 'periodo', titulo: 'Período', activa: dias, porDefecto: '30', onCambiar: setDias, opciones: PERIODOS }]
    : [{ id: 'estado', titulo: 'Estado', activa: estado, porDefecto: 'pendientes', onCambiar: setEstado, opciones: ESTADOS }];
  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Cargar compra', headerLargeTitle: true,
        headerSearchBarOptions: { placeholder: tab === 'facturas' ? 'Proveedor o número' : 'Proveedor, producto o código', onChangeText: (e) => setBusca(e.nativeEvent.text) } }} />
      <MenuDeFiltros grupos={grupos} />
      <ScrollView style={{ flex: 1 }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingVertical: 8, paddingBottom: 48, gap: 12 }} keyboardShouldPersistTaps="handled">
        <Segmentos activa={tab} onCambiar={setTab} opciones={[{ id: 'facturas', label: 'Facturas' }, { id: 'confirmar', label: 'Por confirmar' }]} />
        <FiltrosActivos grupos={grupos} />
        {tab === 'facturas' ? <Facturas busca={busca} dias={dias} /> : <PorConfirmar busca={busca} estado={estado} puedeEditar={puedeEditar} />}
      </ScrollView>
    </>
  );
}

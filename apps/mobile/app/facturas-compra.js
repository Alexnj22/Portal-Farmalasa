// Facturas de compra, NATIVO — los documentos tributarios que llegan por correo
// (`FacturasCompraView`, pestaña Documentos), mes por mes. Busca por proveedor,
// número, código de generación y por lo que se compró (`items_text`), con el
// mismo `tokenMatch` del portal.
//
// Tocar una abre su ficha (`factura-compra/[id]`) con LOS PRODUCTOS y el PDF:
// es justo lo que el teléfono no dejaba ver (reporte de sala del 2026-08-20).
// Revisión, vincular proveedor, buscar correos y descargar el paquete siguen en
// el portal.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { fetchPurchaseDteDocuments } from '@nucleo/data/facturasCompra';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { dteTypeLabel } from '@nucleo/utils/dteTypes';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto, mesSV, rangoDelMes } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import Kpi, { FilaDeKpis } from '../componentes/inicio/Kpi';
import { useAuth } from '@nucleo/context/AuthContext';
import Vidrio from '../componentes/Vidrio';
import PasoDeMes from '../componentes/PasoDeMes';
import { MARCA } from '../componentes/inicio/marca';
import { guardarDocumentos } from '../componentes/compras/documentos';

const POR_PAGINA = 40;

export default function FacturasCompra() {
  // El total de la cabecera es de quien tiene `facturas_compra_ver_montos`,
  // como las tarjetas del portal.
  const verMontos = useAuth().hasPermission('facturas_compra_ver_montos');
  const [mes, setMes] = useState(mesSV);
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState(null);
  const [texto, setTexto] = useState('');
  const [estado, setEstado] = useState('todos');
  const [tipo, setTipo] = useState('todos');
  const [mostrar, setMostrar] = useState(POR_PAGINA);
  const [recargando, setRecargando] = useState(false);
  const [desde, hasta] = useMemo(() => rangoDelMes(mes), [mes]);

  const cargar = useCallback(async () => {
    try {
      const d = await fetchPurchaseDteDocuments(desde, hasta);
      guardarDocumentos(d);
      setFilas(d); setError(null);
    } catch (e) { setError(mensajeAmigable(e)); setFilas([]); }
  }, [desde, hasta]);
  useEffect(() => { setFilas(null); setMostrar(POR_PAGINA); cargar(); }, [cargar]);
  useEffect(() => { setMostrar(POR_PAGINA); }, [texto, estado, tipo]);

  const tipos = useMemo(() => [...new Set((filas || []).map((r) => r.tipo_dte).filter(Boolean))].sort(), [filas]);
  const visibles = useMemo(() => (filas || []).filter((r) => {
    if (estado === 'anulado' && !r.invalidado) return false;
    if (estado === 'vigente' && r.invalidado) return false;
    if (tipo !== 'todos' && r.tipo_dte !== tipo) return false;
    const q = texto.trim();
    if (q && !tokenMatch(q, r.proveedor_nombre, r.proveedor_alias, r.supplier_nombre, r.emisor_nombre, r.emisor_nit, r.numero_control, r.codigo_generacion, r.items_text, dteTypeLabel(r.tipo_dte), r.invalidado ? 'invalidado anulado' : null)) return false;
    return true;
  }).sort((a, b) => String(b.fecha_emision).localeCompare(String(a.fecha_emision))), [filas, estado, tipo, texto]);
  const total = visibles.filter((r) => !r.invalidado).reduce((s, r) => s + Number(r.monto_total || 0), 0);
  const anulados = visibles.filter((r) => r.invalidado).length;

  const grupos = [
    { id: 'estado', titulo: 'Estado', activa: estado, porDefecto: 'todos', onCambiar: setEstado,
      opciones: [{ id: 'todos', label: 'Todos' }, { id: 'vigente', label: 'Sin anular' }, { id: 'anulado', label: 'Anulados por el proveedor' }] },
    { id: 'tipo', titulo: 'Tipo de documento', activa: tipo, porDefecto: 'todos', onCambiar: setTipo,
      opciones: [{ id: 'todos', label: 'Todos' }, ...tipos.map((t) => ({ id: t, label: dteTypeLabel(t) }))] },
  ];

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Facturas de compra', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Proveedor, número o producto', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <MenuDeFiltros grupos={grupos} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <PasoDeMes mes={mes} onCambiar={setMes} />
        <FiltrosActivos grupos={grupos} />
        {filas ? (
          <FilaDeKpis>
            <Kpi icono="FileText" rotulo="Documentos" valor={visibles.length.toLocaleString('es-SV')} color={MARCA.azul} apoyo={anulados ? `${anulados} anulado${anulados === 1 ? '' : 's'}` : 'ninguno anulado'} />
            {verMontos ? <Kpi icono="DollarSign" rotulo="Monto" valor={formatMoney(total)} color={MARCA.violeta} apoyo="sin los anulados" /> : null}
          </FilaDeKpis>
        ) : null}
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {filas == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : visibles.slice(0, mostrar).map((r) => {
          const proveedor = r.proveedor_alias || r.proveedor_nombre || r.supplier_nombre || r.emisor_nombre || 'Sin proveedor';
          return (
            <Pressable key={r.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push({ pathname: '/factura-compra/[id]', params: { id: String(r.id), fecha: r.fecha_emision } }); }}
              style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
              <Vidrio radio={18} interactivo tinte={r.invalidado ? 'rgba(240,68,56,0.10)' : undefined}>
                <View style={{ padding: 12, gap: 4 }}>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }} numberOfLines={2}>{proveedor}</Text>
                    <Text style={{ color: r.invalidado ? colorSistema.texto2 : colorSistema.texto, fontSize: 16, fontWeight: '800', textDecorationLine: r.invalidado ? 'line-through' : 'none' }}>{formatMoney(r.monto_total)}</Text>
                  </View>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={1}>
                    {[fechaTexto(r.fecha_emision, { day: 'numeric', month: 'short' }), dteTypeLabel(r.tipo_dte), r.numero_control ? `…${String(r.numero_control).slice(-6)}` : null].filter(Boolean).join(' · ')}
                  </Text>
                  {r.items_text ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={1}>{r.items_text}</Text> : null}
                  {r.invalidado || !r.proveedor_id || (r.notas_credito || []).length ? (
                    <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                      {r.invalidado ? <Pildora texto="Invalidado" color={MARCA.rojo} /> : null}
                      {!r.proveedor_id ? <Pildora texto="Sin vincular" color={MARCA.ambar} /> : null}
                      {(r.notas_credito || []).length ? <Pildora texto={`${r.notas_credito.length} nota${r.notas_credito.length === 1 ? '' : 's'} de crédito`} color={MARCA.azulClaro} /> : null}
                    </View>
                  ) : null}
                </View>
              </Vidrio>
            </Pressable>
          );
        })}
        {filas && visibles.length > mostrar ? <View style={{ marginHorizontal: 16 }}><BotonGrande texto="Ver más" borde onPress={() => setMostrar((n) => n + POR_PAGINA)} /></View> : null}
        {filas && !visibles.length && !error ? (
          <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>
            {texto ? 'Ninguna factura con esa búsqueda' : 'Sin facturas este mes'}
          </Text>
        ) : null}
      </ScrollView>
    </>
  );
}

// Facturas de compra, NATIVO — los documentos tributarios que llegan por correo
// (`FacturasCompraView`, pestaña Documentos), mes por mes. Busca por proveedor,
// número, código de generación y por lo que se compró (`items_text`), con el
// mismo `tokenMatch` del portal.
//
// Tocar una abre su ficha (`factura-compra/[id]`) con LOS PRODUCTOS y el PDF:
// es justo lo que el teléfono no dejaba ver (reporte de sala del 2026-08-20).
// Tarjetas del portal (`tarjetasDeDocumentosDeCompra`, núcleo): total, crédito
// IVA (las notas de crédito restan), compras netas, invalidados y sin
// proveedor —estos dos filtran al tocarlos—, todas con
// `facturas_compra_ver_montos`. Insignias: invalidado (con fecha y motivo),
// «Sin JSON», nota que corrige a otro documento. Orden por fecha, proveedor,
// tipo o monto. Desde la ficha de un proveedor llega con `busca` (su NIT).
// La pestaña Revisión y «Buscar correos» son `factura-compra/revision`. El ZIP
// del período y detectar el código dentro de un PDF siguen en el portal.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { compartirZipDeFacturas } from '../componentes/compras/zipDeFacturas';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { fetchPurchaseDteDocuments } from '@nucleo/data/facturasCompra';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { tarjetasDeDocumentosDeCompra } from '@nucleo/utils/tarjetasDeCompras';
import { dteAdmiteProveedor } from '@nucleo/utils/dteTypes';
import { dteTypeLabel } from '@nucleo/utils/dteTypes';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto, mesSV, rangoDelMes } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { useMasAlFinal } from '../componentes/ListaPaginada';
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
import { cerrarProgreso, fallo, trabajando } from '../componentes/Progreso';

const POR_PAGINA = 40;

export default function FacturasCompra() {
  // El total de la cabecera es de quien tiene `facturas_compra_ver_montos`,
  // como las tarjetas del portal.
  const { hasPermission } = useAuth();
  const verMontos = hasPermission('facturas_compra_ver_montos');
  const verRevision = hasPermission('facturas_compra', 'can_edit') || hasPermission('facturas_compra_abrir');
  const puedeZip = hasPermission('facturas_compra_descargar');
  const { busca } = useLocalSearchParams();
  const [mes, setMes] = useState(mesSV);
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState(null);
  const [texto, setTexto] = useState(() => (busca ? String(busca) : ''));
  const [orden, setOrden] = useState('fecha');
  const [soloSinProv, setSoloSinProv] = useState(false);
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
  useEffect(() => { setMostrar(POR_PAGINA); }, [texto, estado, tipo, orden, soloSinProv]);

  const tipos = useMemo(() => [...new Set((filas || []).map((r) => r.tipo_dte).filter(Boolean))].sort(), [filas]);
  const visibles = useMemo(() => (filas || []).filter((r) => {
    if (estado === 'anulado' && !r.invalidado) return false;
    if (estado === 'vigente' && r.invalidado) return false;
    if (tipo !== 'todos' && r.tipo_dte !== tipo) return false;
    if (soloSinProv && (r.proveedor_id || !dteAdmiteProveedor(r.tipo_dte))) return false;
    const q = texto.trim();
    if (q && !tokenMatch(q, r.proveedor_nombre, r.proveedor_alias, r.supplier_nombre, r.emisor_nombre, r.emisor_nit, r.numero_control, r.codigo_generacion, r.items_text, dteTypeLabel(r.tipo_dte), r.invalidado ? 'invalidado anulado' : null)) return false;
    return true;
  }).sort((a, b) => {
    if (orden === 'proveedor') return String(a.proveedor_alias || a.proveedor_nombre || a.emisor_nombre || '').localeCompare(String(b.proveedor_alias || b.proveedor_nombre || b.emisor_nombre || ''), 'es');
    if (orden === 'tipo') return String(a.tipo_dte).localeCompare(String(b.tipo_dte)) || String(b.fecha_emision).localeCompare(String(a.fecha_emision));
    if (orden === 'monto') return Number(b.monto_total || 0) - Number(a.monto_total || 0);
    return String(b.fecha_emision).localeCompare(String(a.fecha_emision));
  }), [filas, estado, tipo, texto, orden, soloSinProv]);
  // El ZIP del período (JSON + PDF de lo que se ve, y lo pendiente de revisión).
  const zipDelMes = () => Alert.alert('ZIP del mes', `${visibles.length} documentos con sus JSON y PDF, más lo pendiente de revisión. Se descarga en el teléfono: con muchos documentos tarda.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Armar', onPress: async () => {
      trabajando('Bajando los archivos…');
      try {
        const r = await compartirZipDeFacturas(visibles.map((d) => d.id), { onProgress: (p) => trabajando(`Bajando ${p.hechos} de ${p.total}…`), contexto: { mes } });
        cerrarProgreso();
        if (r.fallidos.length) fallo('Faltaron archivos', `${r.fallidos.length} no se pudieron incluir (van listados dentro del ZIP).`);
      } catch (e) { fallo('No se pudo armar el ZIP', mensajeAmigable(e)); }
    } },
  ]);
  // Las tarjetas cuentan el período del tipo elegido, como el portal (no la búsqueda).
  const t = useMemo(() => tarjetasDeDocumentosDeCompra((filas || []).filter((r) => tipo === 'todos' || r.tipo_dte === tipo)), [filas, tipo]);

  const grupos = [
    { id: 'estado', titulo: 'Estado', activa: estado, porDefecto: 'todos', onCambiar: setEstado,
      opciones: [{ id: 'todos', label: 'Todos' }, { id: 'vigente', label: 'Sin anular' }, { id: 'anulado', label: 'Anulados por el proveedor' }] },
    { id: 'tipo', titulo: 'Tipo de documento', activa: tipo, porDefecto: 'todos', onCambiar: setTipo,
      opciones: [{ id: 'todos', label: 'Todos' }, ...tipos.map((x) => ({ id: x, label: dteTypeLabel(x) }))] },
    { id: 'orden', titulo: 'Ordenar', activa: orden, porDefecto: 'fecha', onCambiar: setOrden,
      opciones: [{ id: 'fecha', label: 'Más recientes' }, { id: 'proveedor', label: 'Proveedor' }, { id: 'tipo', label: 'Tipo' }, { id: 'monto', label: 'Mayor monto' }] },
  ];

  // Al llegar abajo se pinta la página siguiente sola; «Ver más» queda de respaldo.
  const alFinal = useMasAlFinal(() => setMostrar((n) => n + POR_PAGINA), !!filas && visibles.length > mostrar);

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
      <ScrollView {...alFinal} style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <PasoDeMes mes={mes} onCambiar={setMes} />
        <FiltrosActivos grupos={grupos} />
        {verRevision ? <View style={{ marginHorizontal: 16 }}><BotonGrande texto="Revisión y correos" borde onPress={() => router.push('/factura-compra/revision')} /></View> : null}
        {puedeZip && filas?.length ? <View style={{ marginHorizontal: 16 }}><BotonGrande texto={`ZIP del mes (${visibles.length})`} borde onPress={zipDelMes} /></View> : null}
        {filas && verMontos ? (
          <>
            <FilaDeKpis>
              <Kpi icono="FileText" rotulo="Total compras" valor={formatMoney(t.totalCompras)} color={MARCA.azul} apoyo={`${(filas || []).length.toLocaleString('es-SV')} documentos`} />
              <Kpi icono="Receipt" rotulo="Crédito IVA" valor={formatMoney(t.creditoFiscal)} color={MARCA.verde} apoyo="excluye invalidados" />
            </FilaDeKpis>
            <FilaDeKpis>
              <Kpi icono="TrendingUp" rotulo="Compras netas" valor={formatMoney(t.comprasNetas)} color={MARCA.violeta} apoyo="tras notas de crédito" />
              <Kpi icono="Ban" rotulo="Invalidados" valor={String(t.invalidadosCount)} color={t.invalidadosCount ? MARCA.rojo : MARCA.verde}
                apoyo={t.invalidadosCount ? formatMoney(t.invalidadosMonto) : 'sin invalidados'}
                onPress={t.invalidadosCount ? () => setEstado(estado === 'anulado' ? 'todos' : 'anulado') : undefined} />
            </FilaDeKpis>
          </>
        ) : null}
        {filas ? (
          <FilaDeKpis>
            {!verMontos ? <Kpi icono="FileText" rotulo="Documentos" valor={visibles.length.toLocaleString('es-SV')} color={MARCA.azul} apoyo={`${t.invalidadosCount} invalidados`} /> : null}
            <Kpi icono="UserX" rotulo="Sin proveedor" valor={String(t.sinProveedorCount)} color={t.sinProveedorCount ? MARCA.ambar : MARCA.verde} pide={soloSinProv}
              apoyo={soloSinProv ? 'filtrando · tocar para quitar' : 'pendiente de emparejar'}
              onPress={t.sinProveedorCount ? () => setSoloSinProv((v) => !v) : undefined} />
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
                    <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{proveedor}</Text>
                    {verMontos ? <Text style={{ color: r.invalidado ? colorSistema.texto2 : r.tipo_dte === '05' ? MARCA.rojo : colorSistema.texto, fontSize: 16, fontWeight: '800', textDecorationLine: r.invalidado ? 'line-through' : 'none' }}>{`${r.tipo_dte === '05' ? '−' : ''}${formatMoney(r.monto_total)}`}</Text> : null}
                  </View>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                    {[fechaTexto(r.fecha_emision, { day: 'numeric', month: 'short' }), dteTypeLabel(r.tipo_dte), r.numero_control ? `…${String(r.numero_control).slice(-6)}` : null].filter(Boolean).join(' · ')}
                  </Text>
                  {r.invalidado && r.invalidado_motivo ? <Text style={{ color: MARCA.rojo, fontSize: 12 }}>{r.invalidado_motivo}</Text> : null}
                  {r.items_text ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={2}>{r.items_text}</Text> : null}
                  {r.invalidado || !r.proveedor_id || !r.json_path || r.documento_relacionado || (r.notas_credito || []).length ? (
                    <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                      {r.invalidado ? <Pildora texto={`Invalidado${r.invalidado_at ? ` · ${fechaTexto(String(r.invalidado_at).slice(0, 10), { day: 'numeric', month: 'short' })}` : ''}`} color={MARCA.rojo} /> : null}
                      {!r.proveedor_id && dteAdmiteProveedor(r.tipo_dte) ? <Pildora texto="Sin vincular" color={MARCA.ambar} /> : null}
                      {!r.json_path ? <Pildora texto="Sin JSON" color={colorSistema.texto2} /> : null}
                      {r.documento_relacionado ? <Pildora texto={`Corrige ${dteTypeLabel(r.documento_relacionado.tipo_dte)}`} color={MARCA.violetaClaro} /> : null}
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

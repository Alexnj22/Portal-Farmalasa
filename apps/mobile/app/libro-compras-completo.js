// Libro de compras completo, NATIVO — `LibroComprasCompletoView` para
// consultarlo: qué compró la farmacia de verdad en el mes (lo registrado más
// los documentos que llegaron del proveedor y nunca se registraron) y, en
// «Declarable», qué de eso puede reclamarse como crédito fiscal y por qué no
// cuenta lo que no cuenta. Tocar un documento que llegó por correo lo abre.
//
// Los totales salen del núcleo (`libroComprasCompleto`), los mismos del portal;
// los montos, sólo con `libro_compras_completo_ver_montos`. Descargar el CSV
// sigue en el portal.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchLibroComprasCompleto, fetchLibroComprasDeclarable } from '@nucleo/data/libroComprasCompleto';
import { filasDeLaPestana, totalesDeclarable, totalesDelLibro } from '@nucleo/utils/libroComprasCompleto';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto, mesSV, rangoDelMes } from '@nucleo/utils/fecha';
import { ordenDeSala } from '@nucleo/constants/erp';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import PasoDeMes from '../componentes/PasoDeMes';
import Segmentos from '../componentes/Segmentos';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Kpi, { FilaDeKpis } from '../componentes/inicio/Kpi';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';

const TOPE = 150;

export default function LibroComprasCompleto() {
  const { getScope, hasPermission } = useAuth();
  const sucursales = useStaffStore((s) => s.branches);
  const verMontos = hasPermission('libro_compras_completo_ver_montos');
  const todas = getScope?.('libro_compras_completo') === 'ALL';
  const [mes, setMes] = useState(mesSV);
  const [sala, setSala] = useState('ALL');
  const [pestana, setPestana] = useState('todos');
  const [texto, setTexto] = useState('');
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState('');
  const [recargando, setRecargando] = useState(false);
  const esDecl = pestana === 'declarable';
  const m = (n) => (verMontos ? formatMoney(n || 0) : '—');

  const cargar = useCallback(async () => {
    setError('');
    const [desde, hasta] = rangoDelMes(mes);
    const data = esDecl ? await fetchLibroComprasDeclarable(desde, hasta) : await fetchLibroComprasCompleto(desde, hasta, sala === 'ALL' ? null : sala);
    if (data === null) { setError('No se pudo leer el libro.'); setFilas([]); } else setFilas(data);
  }, [mes, sala, esDecl]);
  useEffect(() => { setFilas(null); cargar(); }, [cargar]);

  const t = useMemo(() => totalesDelLibro(filas), [filas]);
  const td = useMemo(() => (esDecl ? totalesDeclarable(filas) : null), [filas, esDecl]);
  const vistas = useMemo(() => filasDeLaPestana(filas, pestana)
    .filter((r) => !texto.trim() || tokenMatch(texto.trim(), r.proveedor, r.documento_completo, r.nit)), [filas, pestana, texto]);
  const nombreSala = (id) => (sucursales || []).find((b) => String(b.id) === String(id))?.name ?? '';
  const grupos = todas && !esDecl ? [{ id: 'sala', titulo: 'Sucursal', activa: sala, porDefecto: 'ALL', onCambiar: setSala,
    opciones: [{ id: 'ALL', label: 'Todas' }, ...[...(sucursales || [])].sort((a, b) => ordenDeSala(a.id) - ordenDeSala(b.id)).map((b) => ({ id: String(b.id), label: b.name }))] }] : [];

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Libro de compras', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Proveedor, NIT o documento', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      {grupos.length ? <MenuDeFiltros grupos={grupos} /> : null}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        {grupos.length ? <FiltrosActivos grupos={grupos} /> : null}
        <PasoDeMes mes={mes} onCambiar={setMes} />
        <Segmentos activa={pestana} onCambiar={setPestana} opciones={[{ id: 'todos', label: 'Todos' }, { id: 'sin_compra', label: 'Sin registrar' }, { id: 'declarable', label: 'Declarable' }]} />
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {filas && !esDecl ? (
          <FilaDeKpis>
            <Kpi icono="BookOpen" rotulo="Documentos" valor={String(t.docs)} color={MARCA.azul} apoyo={`crédito ${m(t.credito)}`} />
            <Kpi icono="SearchX" rotulo="Sin registrar" valor={String(t.sinCompra)} color={t.sinCompra ? MARCA.ambar : MARCA.verde} apoyo={`crédito ${m(t.creditoSinCompra)}`} />
          </FilaDeKpis>
        ) : null}
        {filas && td ? (
          <>
            <FilaDeKpis>
              <Kpi icono="Percent" rotulo="Crédito declarable" valor={m(td.credito)} color={MARCA.verde} apoyo={`${td.docs} documentos`} />
              <Kpi icono="Lock" rotulo="No cuentan" valor={String(td.sinCuenta)} color={td.sinCuenta ? MARCA.ambar : MARCA.verde} apoyo={td.trabado ? `trabado ${m(td.trabado)}` : 'nada trabado'} />
            </FilaDeKpis>
            {td.motivos.size ? (
              <View style={{ marginHorizontal: 16, gap: 4 }}>
                {[...td.motivos.entries()].sort((a, b) => b[1] - a[1]).map(([mot, k]) => <Text key={mot ?? 'x'} style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${k} · ${mot ?? 'Sin motivo'}`}</Text>)}
              </View>
            ) : null}
            {td.repRenglones ? <View style={{ marginHorizontal: 16 }}><Aviso tono="cuidado" texto={`${Math.round(td.repDocs)} documento(s) aparecen repetidos en el libro (${td.repRenglones} renglones): ${m(td.repCredito)} de crédito contado de más.`} /></View> : null}
          </>
        ) : null}
        {filas == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : vistas.length ? (
          <View style={{ marginHorizontal: 16 }}>
            <Vidrio radio={20}>
              <View style={{ padding: 12, gap: 10 }}>
                {vistas.slice(0, TOPE).map((r, i) => {
                  const abre = !!r.json_path && r.dte_id;
                  const repetido = Number(r.veces_en_el_libro || 1) > 1;
                  return (
                    <Pressable key={`${r.dte_id ?? ''}-${r.documento_completo}-${i}`} disabled={!abre}
                      onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push({ pathname: '/factura-compra/[id]', params: { id: String(r.dte_id), fecha: r.fecha } }); }}
                      style={{ gap: 4, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, paddingTop: i ? 10 : 0 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{r.proveedor || 'Sin proveedor'}</Text>
                        <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{m(r.total)}</Text>
                      </View>
                      <Text style={{ color: colorSistema.texto2, fontSize: 12 }} numberOfLines={1}>
                        {[r.fecha ? fechaTexto(r.fecha, { day: 'numeric', month: 'short' }) : null, r.documento_tipo, !esDecl && todas ? nombreSala(r.branch_id) : null, `crédito ${m(r.credito_fiscal)}`].filter(Boolean).join(' · ')}
                      </Text>
                      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                        {!esDecl && r.origen !== 'registrada' ? <Pildora texto="Sin registrar" color={MARCA.ambar} /> : null}
                        {esDecl ? <Pildora texto={r.computa_credito ? 'Cuenta' : 'No cuenta'} color={r.computa_credito ? MARCA.verde : MARCA.ambar} /> : null}
                        {repetido ? <Pildora texto={`Repetido ×${r.veces_en_el_libro}`} color={MARCA.rojo} /> : null}
                      </View>
                      {esDecl && !r.computa_credito && r.motivo ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{r.motivo}</Text> : null}
                    </Pressable>
                  );
                })}
                {vistas.length > TOPE ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`Se muestran ${TOPE} de ${vistas.length}. Busca para acotar.`}</Text> : null}
              </View>
            </Vidrio>
          </View>
        ) : <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>Sin documentos este mes</Text>}
        <View style={{ marginHorizontal: 16, marginTop: 8 }}>
          <BotonGrande texto="Descargar el libro (portal)" borde color={MARCA.azulClaro}
            onPress={() => router.push({ pathname: '/portal', params: { ruta: '/libro-compras-completo', nombre: 'Libro de compras' } })} />
        </View>
      </ScrollView>
    </>
  );
}

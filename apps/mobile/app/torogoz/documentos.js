// Torogoz › Facturación, NATIVO — el `TabDocumentos` del portal: el control con
// Hacienda. Arriba el semáforo que contesta de una vez «¿está todo bien con
// Hacienda?», con «Reenviar pendientes» y el aviso de contingencia; debajo, lo
// que pide acción (tocar un número filtra), la cubeta en el segmentado y el
// tipo de documento en el menú. Cada documento dice si tiene código y sello;
// al tocarlo se abre con su lista de chequeo y el botón de lo que toca.
//
// Los grupos, la cubeta y los textos salen del núcleo
// (`distribucionFacturacion`), los mismos del portal.
//
// ⚠ «Reenviar pendientes», «Enviar aviso de contingencia» y «Enviar correos»
// le hablan a Hacienda y al cliente DE VERDAD: en el entorno de pruebas esas
// funciones no están, así que no se pueden probar ahí. Cada una pide confirmar.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchDocumento, fetchDocumentos, enviarContingencia, mensajeDeDistribucion, reintentarDocumento } from '@nucleo/data/distribucion';
import { CUBETAS_FACTURACION, ESTADO_DOCUMENTO, TIPO_DOCUMENTO } from '@nucleo/utils/distribucionComun';
import {
  DIAS_DE_FACTURACION, documentosDeLaCubeta, faltaElCertificado, filaDeHacienda, gruposDeFacturacion,
  resumenDeContingencia, resumenDelReenvio, semaforoDeFacturacion,
} from '@nucleo/utils/distribucionFacturacion';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaNumerica, hoySV, sumarDias } from '@nucleo/utils/fecha';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande } from '../../componentes/formulario/Piezas';
import { Pildora } from '../../componentes/avisos/Piezas';
import { FiltrosActivos, MenuDeFiltros } from '../../componentes/Filtros';
import Segmentos from '../../componentes/Segmentos';
import Kpi, { FilaDeKpis } from '../../componentes/inicio/Kpi';
import Vidrio from '../../componentes/Vidrio';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../../componentes/Progreso';
import { enviarDocumentoPorCorreo } from '../../componentes/torogoz/fiscal/papel';
import { ACCIONES_DE_DINERO, SeHaceEnElPortal } from '../../componentes/torogoz/soloConsulta';
import { useMasAlFinal } from '../../componentes/ListaPaginada';

const PETROLEO = '#0f6e7d';
const POR_PAGINA = 50;
const COLOR_NIVEL = { ok: MARCA.verde, pendiente: MARCA.ambar, error: MARCA.rojo, info: colorSistema.texto2 };

function Documento({ d }) {
  const f = filaDeHacienda(d, ESTADO_DOCUMENTO);
  return (
    <Pressable style={{ marginHorizontal: 16 }} accessibilityRole="button"
      onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push(`/torogoz/documento/${d.id}`); }}>
      {({ pressed }) => (
        <Vidrio radio={20} interactivo>
          <View style={{ padding: 14, gap: 8, transform: [{ scale: pressed ? 0.98 : 1 }] }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }} numberOfLines={1}>{d.dist_clientes?.nombre ?? '—'}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                  {`${TIPO_DOCUMENTO[d.tipo]?.largo ?? d.tipo}${d.ambiente === '00' ? ' · prueba' : ''} · ${fechaNumerica(d.fec_emi)}`}
                </Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 12, fontFamily: 'Menlo' }} numberOfLines={1}>{d.numero_control}</Text>
              </View>
              <Text style={{ color: colorSistema.texto, fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(d.total_pagar)}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <Pildora texto={f.rotulo} color={COLOR_NIVEL[f.nivel]} />
              <Text style={{ color: f.codigo ? MARCA.verde : MARCA.rojo, fontSize: 13, fontWeight: '600' }}>{`${f.codigo ? '✓' : '✗'} Código`}</Text>
              <Text style={{ color: f.sello ? MARCA.verde : MARCA.rojo, fontSize: 13, fontWeight: '600' }}>{`${f.sello ? '✓' : '✗'} Sello`}</Text>
              {d.intentos > 1 ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${d.intentos} envíos`}</Text> : null}
            </View>
          </View>
        </Vidrio>
      )}
    </Pressable>
  );
}

export default function Facturacion() {
  const { hasPermission } = useAuth();
  const puedeVender = !!hasPermission?.('distribucion', 'can_edit');
  const [docs, setDocs] = useState(null);
  const [error, setError] = useState(null);
  const [cubeta, setCubeta] = useState('accion');
  const [sub, setSub] = useState('');
  const [tipo, setTipo] = useState('');
  const [texto, setTexto] = useState('');
  const [cuantos, setCuantos] = useState(POR_PAGINA);
  // Al acercarse al final se pinta la página siguiente sola; «Ver más» queda de respaldo.
  const alFinal = useMasAlFinal(() => setCuantos((n) => n + POR_PAGINA));
  const [recargando, setRecargando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [avisoFirma, setAvisoFirma] = useState('');
  const pedido = useRef(0);

  const cargar = useCallback(async () => {
    const mio = ++pedido.current;
    try {
      const r = await fetchDocumentos({ desde: sumarDias(hoySV(), -DIAS_DE_FACTURACION) });
      if (mio === pedido.current) { setDocs(r); setError(null); }
    } catch {
      if (mio === pedido.current) setError('No se pudieron cargar los documentos. Revisa la conexión e intenta de nuevo.');
    }
  }, []);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));
  useEffect(() => { setCuantos(POR_PAGINA); }, [cubeta, sub, tipo, texto]);

  const g = useMemo(() => gruposDeFacturacion(docs ?? []), [docs]);
  const semaforo = semaforoDeFacturacion(g);
  const visibles = useMemo(() => {
    const q = texto.trim();
    return documentosDeLaCubeta(docs ?? [], g, { cubeta, sub, tipo,
      coincide: q ? (d) => tokenMatch(q, d.dist_clientes?.nombre, d.numero_control, d.codigo_generacion) : null });
  }, [docs, g, cubeta, sub, tipo, texto]);

  const anotar = (accion, detalle) => useStaffStore.getState().appendAuditLog?.(accion, null, { ...detalle, via: 'app' });

  // Manda, de a uno, todo lo que quedó sin sello. Se detiene si falta el certificado.
  const reenviarPendientes = () => {
    const lista = g.porEnviar;
    if (!lista.length) return;
    Alert.alert('¿Reenviar a Hacienda?', `${lista.length} documento${lista.length === 1 ? '' : 's'} sin sello se mandan otra vez, de a uno.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Reenviar', onPress: async () => {
        setOcupado(true); setAvisoFirma('');
        const cuenta = { sellado: 0, rechazado: 0, pendiente: 0, error: 0 };
        for (const [i, d] of lista.entries()) {
          trabajando(`Reenviando ${i + 1} de ${lista.length}…`);
          try {
            const r = await reintentarDocumento(d.id);
            if (r?.estado === 'sellado') cuenta.sellado += 1;
            else if (r?.estado === 'rechazado') cuenta.rechazado += 1;
            else cuenta.pendiente += 1;
            if (faltaElCertificado(r)) { setAvisoFirma(r.aviso); break; }
          } catch { cuenta.error += 1; }
        }
        anotar('DISTRIBUCION_DTE_REENVIO_EN_BLOQUE', { total: lista.length, ...cuenta });
        setOcupado(false);
        if (cuenta.rechazado || cuenta.error) fallo('Reenvío terminado', resumenDelReenvio(cuenta));
        else listo('Reenvío terminado', resumenDelReenvio(cuenta));
        cargar();
      } },
    ]);
  };

  const avisoContingencia = () => {
    Alert.alert('¿Enviar el aviso de contingencia?', `Le avisa a Hacienda de los ${g.sinAvisoDeContingencia.length} documentos emitidos sin poder transmitirlos, y después los manda.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Enviar', onPress: async () => {
        setOcupado(true); trabajando('Enviando el aviso…');
        try {
          const r = await enviarContingencia();
          anotar('DISTRIBUCION_CONTINGENCIA_AVISO', { avisos: r?.avisos?.length ?? 0, sellados: r?.sellados });
          const a = resumenDeContingencia(r);
          if (a.bien) listo(a.titulo, a.texto); else fallo(a.titulo, a.texto);
        } catch (e) {
          fallo('No se pudo enviar el aviso', mensajeDeDistribucion(e));
        } finally { setOcupado(false); cargar(); }
      } },
    ]);
  };

  const enviarCorreos = () => {
    const lista = g.enviables;
    if (!lista.length) return;
    Alert.alert('¿Enviar los correos?', `${lista.length} cliente${lista.length === 1 ? '' : 's'} reciben su documento sellado (PDF y JSON).`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Enviar', onPress: async () => {
        setOcupado(true);
        let ok = 0, mal = 0;
        for (const [i, d] of lista.entries()) {
          trabajando(`Enviando ${i + 1} de ${lista.length}…`);
          try { await enviarDocumentoPorCorreo(await fetchDocumento(d.id)); ok += 1; }
          catch (e) {
            mal += 1;
            if (/configurar el correo/i.test(e?.message ?? '')) { setAvisoFirma(mensajeDeDistribucion(e)); break; }
          }
        }
        anotar('DISTRIBUCION_DTE_CORREO_EN_BLOQUE', { total: lista.length, ok, mal });
        setOcupado(false);
        const resumen = `${ok} enviados${mal ? ` · ${mal} no se pudieron` : ''}`;
        if (mal) fallo('Correos enviados', resumen); else listo('Correos enviados', resumen);
        cargar();
      } },
    ]);
  };

  const filtrar = (s) => { setCubeta('accion'); setSub((v) => (v === s ? '' : s)); };
  const grupos = [{ id: 'tipo', titulo: 'Tipo de documento', activa: tipo, porDefecto: '', onCambiar: setTipo,
    opciones: [{ id: '', label: 'Todos los tipos' }, ...Object.entries(TIPO_DOCUMENTO).map(([id, t]) => ({ id, label: t.largo }))] }];
  const colorSemaforo = COLOR_NIVEL[semaforo.nivel];

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Facturación', headerLargeTitle: true,
        headerSearchBarOptions: { placeholder: 'Cliente, número de control o código', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto('') },
      }} />
      <MenuDeFiltros grupos={grupos} />
      <ScrollView {...alFinal} style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <FiltrosActivos grupos={grupos} />
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {docs ? (
          <View style={{ marginHorizontal: 16 }}>
            <Vidrio radio={22} tinte={`${colorSemaforo}26`}>
              <View style={{ padding: 16, gap: 10 }}>
                <Text style={{ color: colorSemaforo, fontSize: 20, fontWeight: '800' }}>{semaforo.titulo}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{semaforo.detalle}</Text>
                {/* Contingencia y reenvío le hablan a Hacienda: en sólo consulta, desde el portal. */}
                {!ACCIONES_DE_DINERO && puedeVender && (g.sinAvisoDeContingencia.length || g.porEnviar.length) ? (
                  <SeHaceEnElPortal texto="Reenviarlos a Hacienda y el aviso de contingencia se hacen desde el portal." />
                ) : null}
                {ACCIONES_DE_DINERO && puedeVender && g.sinAvisoDeContingencia.length ? (
                  <BotonGrande texto={`Enviar aviso de contingencia (${g.sinAvisoDeContingencia.length})`} color={PETROLEO} deshabilitado={ocupado} onPress={avisoContingencia} />
                ) : null}
                {ACCIONES_DE_DINERO && puedeVender && g.porEnviar.length ? (
                  <BotonGrande texto={`Reenviar pendientes (${g.porEnviar.length})`} color={PETROLEO} deshabilitado={ocupado} onPress={reenviarPendientes} />
                ) : null}
              </View>
            </Vidrio>
          </View>
        ) : null}
        {docs && g.sinEntregar.length ? (
          <View style={{ marginHorizontal: 16, gap: 8 }}>
            <Aviso tono="cuidado" texto={`${g.sinEntregar.length} documento${g.sinEntregar.length === 1 ? '' : 's'} sellado${g.sinEntregar.length === 1 ? '' : 's'} todavía no le ${g.sinEntregar.length === 1 ? 'llegó' : 'llegaron'} al cliente por correo${g.sinEntregar.length > g.enviables.length ? ` (${g.sinEntregar.length - g.enviables.length} sin correo en la ficha)` : ''}.`} />
            {puedeVender && g.enviables.length ? <BotonGrande borde color={PETROLEO} texto={`Enviar correos (${g.enviables.length})`} deshabilitado={ocupado} onPress={enviarCorreos} /> : null}
          </View>
        ) : null}
        {avisoFirma ? <View style={{ marginHorizontal: 16 }}><Aviso tono="cuidado" texto={`${avisoFirma} Sin el certificado de la empresa no se puede firmar: hay que cargar las credenciales de Hacienda.`} /></View> : null}
        {docs ? (
          <>
            <FilaDeKpis>
              <Kpi icono="Clock" rotulo="Sin sello" valor={String(g.porEnviar.length)} color={MARCA.ambar} pide={g.porEnviar.length > 0}
                apoyo="Firmar o reenviar" onPress={() => filtrar('por_enviar')} />
              <Kpi icono="AlertTriangle" rotulo="Rechazados" valor={String(g.rechazados.length)} color={MARCA.rojo} pide={g.rechazados.length > 0}
                apoyo="Corregir y facturar" onPress={() => filtrar('rechazados')} />
            </FilaDeKpis>
            <FilaDeKpis>
              <Kpi icono="Ban" rotulo="Invalidaciones" valor={String(g.invalidaciones.length)} color={MARCA.ambar} pide={g.invalidaciones.length > 0}
                apoyo="Por enviar o rechazadas" onPress={() => filtrar('invalidaciones')} />
              <Kpi icono="CheckCircle2" rotulo="Sellados" valor={String(g.sellados.length)} color={MARCA.verde}
                apoyo={`${formatMoney(g.vendido, { decimales: 0 })} · ${DIAS_DE_FACTURACION} días`} onPress={() => { setCubeta('sellados'); setSub(''); }} />
            </FilaDeKpis>
          </>
        ) : null}
        <Segmentos activa={cubeta} onCambiar={(v) => { setCubeta(v); setSub(''); }} opciones={CUBETAS_FACTURACION.map((c) => ({ id: c.key, label: c.label }))} />
        {docs ? (
          <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>
            {`${visibles.length} documento${visibles.length === 1 ? '' : 's'}${sub ? ` · ${sub === 'por_enviar' ? 'sin sello' : sub}` : ''}`}
          </Text>
        ) : null}
        {docs == null && !error ? <ActivityIndicator style={{ marginTop: 24 }} /> : visibles.slice(0, cuantos).map((d) => <Documento key={d.id} d={d} />)}
        {visibles.length > cuantos ? (
          <View style={{ marginHorizontal: 16 }}>
            <BotonGrande borde color={PETROLEO} texto={`Ver ${Math.min(POR_PAGINA, visibles.length - cuantos)} más · quedan ${visibles.length - cuantos}`} onPress={() => setCuantos((n) => n + POR_PAGINA)} />
          </View>
        ) : null}
        {docs && !visibles.length ? (
          <View style={{ alignItems: 'center', paddingTop: 32, gap: 6, marginHorizontal: 24 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600' }}>
              {texto || tipo ? 'Sin resultados' : cubeta === 'accion' ? 'Sin pendientes' : 'Sin documentos'}
            </Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 14, textAlign: 'center' }}>
              {texto || tipo ? 'Ningún documento coincide con la búsqueda o el filtro.' : cubeta === 'accion' ? 'Todo lo facturado está recibido por Hacienda.' : 'Se crean al facturar un pedido.'}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}

// Mis facturas (2026-10-07; rehecha 2026-10-09): las facturas de consumidor
// final y los créditos fiscales, con su documento electrónico.
//
// - Por defecto, este mes y el anterior (El Salvador); «Todo» trae el resto.
// - Las anuladas salen, marcadas, y con sus documentos.
// - Cada nota de crédito va DEBAJO de la factura que corrige.
// - El PDF se ve DENTRO de la app (vista web en una hoja, en iPhone).
// - «Descargar» entrega el PDF y el JSON de una vez: la hoja de compartir de
//   iOS recibe un solo archivo, así que van juntos en un .zip (`lib/zip.js`).
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { WebView } from 'react-native-webview';
import * as WebBrowser from 'expo-web-browser';
import * as FS from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import { Cargando, Pantalla, Tarjeta, Texto, Vacio } from '../componentes/ui';
import Segmentos from '../componentes/Segmentos';
import { colorSistema } from '../componentes/sistema';
import Icono from '../componentes/Icono';
import { useSesion } from '../lib/sesion';
import { dolares, fecha } from '../lib/formato';
import { armarZip, base64ABytes, bytesABase64 } from '../lib/zip';
import { suave, useTema } from '../tema/tema';

const TIPO = {
  consumidor_final: { texto: 'Consumidor final', sf: 'doc.text.fill', archivo: 'Factura' },
  credito_fiscal: { texto: 'Crédito fiscal', sf: 'building.2.fill', archivo: 'Credito-fiscal' },
  nota_credito: { texto: 'Nota de crédito', sf: 'arrow.uturn.backward.circle.fill', archivo: 'Nota-de-credito' },
};

const PERIODOS = [
  { valor: 'reciente', rotulo: 'Este mes y el anterior' },
  { valor: 'todo', rotulo: 'Todo' },
];
const ESTADOS = [['todas', 'Todas'], ['vigentes', 'Vigentes'], ['anuladas', 'Anuladas'], ['con_nota', 'Con nota de crédito']];
const VACIO = {
  todas: 'Aquí aparecen las facturas de tus compras.',
  vigentes: 'No hay facturas vigentes en este periodo.',
  anuladas: 'No hay facturas anuladas en este periodo.',
  con_nota: 'Ninguna factura de este periodo tiene nota de crédito.',
};
const pasaFiltro = (f, filtro) => (
  filtro === 'vigentes' ? !f.anulada
    : filtro === 'anuladas' ? f.anulada
      : filtro === 'con_nota' ? f.notas?.length > 0 || f.tipo === 'nota_credito'
        : true
);

const tipoDe = (f) => TIPO[f.tipo] ?? TIPO.consumidor_final;
const nombreArchivo = (f) => `${tipoDe(f).archivo}-${String(f.numero ?? f.fecha ?? f.id).replace(/[^A-Za-z0-9-]/g, '')}`;
const enIphone = Platform.OS === 'ios';

export default function Facturas() {
  const pedir = useSesion((s) => s.pedir);
  const [periodo, setPeriodo] = useState('reciente');
  const [porPeriodo, setPorPeriodo] = useState({});
  const [filtro, setFiltro] = useState('todas');
  const [refrescando, setRefrescando] = useState(false);
  const [ocupada, setOcupada] = useState(null);
  const [visor, setVisor] = useState(null);
  const d = porPeriodo[periodo];
  const cargar = useCallback(async () => {
    const r = await pedir('mis_facturas', { periodo });
    setPorPeriodo((ant) => ({ ...ant, [periodo]: r?.ok || !ant[periodo]?.ok ? r : ant[periodo] }));
  }, [pedir, periodo]);
  // De a 30 (2026-10-09): al acercarse al final se pide la siguiente página
  // desde la última factura mostrada (cursor), y se suma a la lista.
  const [masCargando, setMasCargando] = useState(false);
  const pidiendo = useRef(false);
  const cargarMas = useCallback(async () => {
    const actual = porPeriodo[periodo];
    if (pidiendo.current || !actual?.ok || !actual.siguiente) return;
    pidiendo.current = true; setMasCargando(true);
    try {
      const r = await pedir('mis_facturas', { periodo, antes: actual.siguiente });
      if (r?.ok) {
        setPorPeriodo((ant) => {
          const previo = ant[periodo];
          if (!previo?.ok || previo.siguiente !== actual.siguiente) return ant;
          const vistos = new Set(previo.facturas.map((f) => String(f.id)));
          return { ...ant, [periodo]: { ...previo, siguiente: r.siguiente, facturas: [...previo.facturas, ...r.facturas.filter((f) => !vistos.has(String(f.id)))] } };
        });
      }
    } finally { pidiendo.current = false; setMasCargando(false); }
  }, [pedir, periodo, porPeriodo]);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));
  const refrescar = async () => { setRefrescando(true); await cargar(); setRefrescando(false); };

  // La dirección de un documento: la que vino con la lista o, si no estaba
  // guardado (o la firma ya venció), una nueva.
  const pedirUrl = async (f, formato) => {
    const r = await pedir('factura_documento', { id: f.id, formato });
    if (!r?.ok) throw new Error(r?.mensaje ?? 'El documento todavía no está disponible. Intenta más tarde.');
    return r.url;
  };
  const bajar = async (f, formato) => {
    const destino = `${FS.cacheDirectory}${nombreArchivo(f)}.${formato}`;
    const lista = formato === 'pdf' ? f.pdf : f.json;
    let r = await FS.downloadAsync(lista ?? await pedirUrl(f, formato), destino);
    if (r.status !== 200 && lista) r = await FS.downloadAsync(await pedirUrl(f, formato), destino);
    if (r.status !== 200) throw new Error('El documento todavía no está disponible. Intenta más tarde.');
    return r.uri;
  };
  const conEspera = async (clave, fn) => {
    Haptics.selectionAsync().catch(() => {});
    setOcupada(clave);
    try { await fn(); } catch (e) {
      Alert.alert('No se pudo abrir', e?.message && !/network|fetch/i.test(e.message) ? e.message : 'Revisa tu conexión e intenta de nuevo.');
    } finally { setOcupada(null); }
  };

  const verPdf = (f) => conEspera(`${f.id}pdf`, async () => {
    const url = f.pdf ?? await pedirUrl(f, 'pdf');
    // En iPhone la vista web muestra el PDF; en Android no sabe, y ahí se usa
    // el visor del sistema.
    if (enIphone) setVisor({ f, url });
    else await WebBrowser.openBrowserAsync(url);
  });
  const compartirJson = (f) => conEspera(`${f.id}json`, async () => {
    const uri = await bajar(f, 'json');
    await Share.share({ url: uri, title: nombreArchivo(f) });
  });
  const compartirPdf = async (f) => {
    const uri = await bajar(f, 'pdf');
    await Share.share({ url: uri, title: nombreArchivo(f) });
  };
  // Los dos documentos de una vez. Si sólo uno está disponible, va ése solo.
  const descargarAmbos = (f) => conEspera(`${f.id}ambos`, async () => {
    const [pdf, json] = await Promise.allSettled([bajar(f, 'pdf'), bajar(f, 'json')]);
    const listos = [[pdf, 'pdf'], [json, 'json']].filter(([r]) => r.status === 'fulfilled').map(([r, ext]) => [r.value, ext]);
    if (!listos.length) throw pdf.reason ?? json.reason;
    if (listos.length === 1) { await Share.share({ url: listos[0][0], title: nombreArchivo(f) }); return; }
    const nombre = nombreArchivo(f);
    const archivos = await Promise.all(listos.map(async ([uri, ext]) => ({
      nombre: `${nombre}.${ext}`,
      bytes: base64ABytes(await FS.readAsStringAsync(uri, { encoding: FS.EncodingType.Base64 })),
    })));
    const destino = `${FS.cacheDirectory}${nombre}.zip`;
    await FS.writeAsStringAsync(destino, bytesABase64(armarZip(archivos)), { encoding: FS.EncodingType.Base64 });
    await Share.share({ url: destino, title: nombre });
  });
  const acciones = { verPdf, compartirJson, descargarAmbos };

  const cuerpo = !d ? <Cargando />
    : !d.ok ? <Vacio titulo="No se pudieron cargar">{d.mensaje ?? 'Revisa tu conexión.'}</Vacio>
      : (() => {
        const lista = d.facturas.filter((f) => pasaFiltro(f, filtro));
        return (
          <>
            {!lista.length ? <Vacio titulo={filtro === 'todas' ? 'Sin facturas' : 'Nada por aquí'}>{VACIO[filtro]}</Vacio> : null}
            {lista.map((f) => <Factura key={f.id} f={f} ocupada={ocupada} acciones={acciones} />)}
            {d.siguiente ? (
              <Pressable onPress={cargarMas} disabled={masCargando} accessibilityRole="button"
                style={({ pressed }) => ({ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, minHeight: 44, borderRadius: 999, opacity: pressed ? 0.6 : 1 })}>
                {masCargando ? <ActivityIndicator /> : null}
                <Texto nivel={2} estilo={{ fontSize: 14, fontWeight: '600' }}>{masCargando ? 'Cargando más…' : 'Ver más facturas'}</Texto>
              </Pressable>
            ) : null}
          </>
        );
      })();

  return (
    <>
      <Pantalla conPestanas={false} alRefrescar={d ? refrescar : undefined} refrescando={refrescando} alFinal={d?.siguiente ? cargarMas : undefined}>
        <View style={{ marginHorizontal: -16 }}>
          <Segmentos opciones={PERIODOS} valor={periodo} alCambiar={setPeriodo} />
        </View>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {ESTADOS.map(([k, texto]) => <Chip key={k} texto={texto} activo={filtro === k} alTocar={() => setFiltro(k)} />)}
        </View>
        {cuerpo}
      </Pantalla>
      {visor ? <VisorPdf visor={visor} alCerrar={() => setVisor(null)} alCompartir={compartirPdf} /> : null}
    </>
  );
}

// El PDF dentro de la app: una hoja con la vista web y, arriba, cerrar y compartir.
function VisorPdf({ visor, alCerrar, alCompartir }) {
  const t = useTema();
  const [error, setError] = useState(false);
  const [compartiendo, setCompartiendo] = useState(false);
  const fondo = t.oscuro ? '#121016' : '#F5F4F8';
  const origen = `${visor.url.split('/').slice(0, 3).join('/')}/`;
  const compartir = async () => {
    if (compartiendo) return;
    setCompartiendo(true);
    try { await alCompartir(visor.f); } catch { Alert.alert('No se pudo compartir', 'Revisa tu conexión e intenta de nuevo.'); } finally { setCompartiendo(false); }
  };
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={alCerrar}>
      <View style={{ flex: 1, backgroundColor: fondo }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 14, gap: 12 }}>
          <Pressable onPress={alCerrar} hitSlop={12} accessibilityRole="button">
            <Text style={{ fontSize: 17, fontWeight: '600', color: colorSistema.texto }}>Cerrar</Text>
          </Pressable>
          <Text numberOfLines={1} style={{ flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: colorSistema.texto }}>
            {tipoDe(visor.f).texto}{visor.f.numero ? ` N.º ${visor.f.numero}` : ''}
          </Text>
          <Pressable onPress={compartir} hitSlop={12} accessibilityRole="button" accessibilityLabel="Compartir PDF" disabled={compartiendo}
            style={{ minWidth: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center', opacity: compartiendo ? 0.5 : 1 }}>
            {compartiendo ? <ActivityIndicator /> : <Icono sf="square.and.arrow.up" respaldo="↗" tam={20} color={t.color.magenta} />}
          </Pressable>
        </View>
        {error ? (
          <Vacio titulo="No se pudo abrir">Revisa tu conexión y vuelve a intentar.</Vacio>
        ) : (
          <WebView source={{ uri: visor.url }} style={{ flex: 1, backgroundColor: fondo }}
            startInLoadingState renderLoading={() => <ActivityIndicator style={{ marginTop: 40 }} />}
            onError={() => setError(true)} onHttpError={() => setError(true)}
            // Sólo el documento: nada lleva afuera.
            onShouldStartLoadWithRequest={(r) => r.url.startsWith(origen) || r.url === 'about:blank'}
            allowsBackForwardNavigationGestures={false} dataDetectorTypes="none" />
        )}
      </View>
    </Modal>
  );
}

function Chip({ texto, activo, alTocar }) {
  const t = useTema();
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); alTocar(); }} accessibilityRole="button" accessibilityState={{ selected: activo }}
      style={{ minHeight: 34, paddingHorizontal: 14, borderRadius: 999, justifyContent: 'center',
        backgroundColor: activo ? t.color.magenta : (t.oscuro ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.8)') }}>
      <Text style={{ fontSize: 14, fontWeight: '700', color: activo ? '#FFFFFF' : colorSistema.texto }}>{texto}</Text>
    </Pressable>
  );
}

// Una factura y, debajo, sus notas de crédito.
function Factura({ f, ocupada, acciones }) {
  return (
    <Tarjeta estilo={{ gap: 12 }}>
      <Documento f={f} ocupada={ocupada} acciones={acciones} />
      {(f.notas ?? []).map((n) => (
        <View key={n.id} style={{ gap: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colorSistema.separador }}>
          <Documento f={n} ocupada={ocupada} acciones={acciones} anidada />
        </View>
      ))}
    </Tarjeta>
  );
}

function Documento({ f, ocupada, acciones, anidada = false }) {
  const t = useTema();
  const tipo = tipoDe(f);
  const nota = f.tipo === 'nota_credito';
  // El naranja en hex (no el del sistema): el ícono y `suave` necesitan un color fijo.
  const naranja = t.oscuro ? '#FF9F0A' : '#B26A00';
  const tono = nota ? '#FF9F0A' : f.tipo === 'credito_fiscal' ? t.color.magenta : t.color.verde;
  const tonoTexto = nota ? naranja : f.tipo === 'credito_fiscal' ? t.color.magentaTexto : t.color.verdeTexto;
  const lado = anidada ? 32 : 40;
  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: anidada ? 8 : 0 }}>
        <View style={{ width: lado, height: lado, borderRadius: anidada ? 10 : 12, alignItems: 'center', justifyContent: 'center',
          backgroundColor: suave(tono, t.oscuro ? 0.26 : 0.15) }}>
          <Icono sf={tipo.sf} respaldo="" tam={anidada ? 15 : 18} color={tonoTexto} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Text style={{ fontSize: anidada ? 14 : 15, fontWeight: '700', color: colorSistema.texto }}>
              {tipo.texto}{f.numero ? ` N.º ${f.numero}` : ''}
            </Text>
            {f.anulada ? <Etiqueta texto="Anulada" /> : null}
          </View>
          <Text style={{ fontSize: 13, color: colorSistema.texto2 }}>
            {anidada ? 'Corrige esta factura · ' : ''}{fecha(f.fecha)}{f.sala ? ` · ${f.sala}` : ''}
          </Text>
        </View>
        <Text style={{ fontSize: anidada ? 16 : 18, fontWeight: '800', color: f.anulada ? colorSistema.texto3 : colorSistema.texto,
          fontVariant: ['tabular-nums'], textDecorationLine: f.anulada ? 'line-through' : 'none' }}>
          {nota ? '−' : ''}{dolares(f.total)}
        </Text>
      </View>
      {f.sin_documento ? (
        <Text style={{ fontSize: 13, color: colorSistema.texto3 }}>Ejemplo sin documento.</Text>
      ) : (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Accion sf="doc.richtext.fill" texto="Ver PDF" cargando={ocupada === `${f.id}pdf`} alTocar={() => acciones.verPdf(f)} />
          <Accion sf="curlybraces" texto="JSON" etiqueta="Compartir JSON" cargando={ocupada === `${f.id}json`} alTocar={() => acciones.compartirJson(f)} />
          <Accion sf="square.and.arrow.down" texto="Descargar" etiqueta="Descargar PDF y JSON" cargando={ocupada === `${f.id}ambos`} alTocar={() => acciones.descargarAmbos(f)} />
        </View>
      )}
    </>
  );
}

function Etiqueta({ texto }) {
  const t = useTema();
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: suave('#FF453A', t.oscuro ? 0.3 : 0.14) }}>
      <Text style={{ fontSize: 12, fontWeight: '700', color: colorSistema.rojo }}>{texto}</Text>
    </View>
  );
}

function Accion({ sf, texto, etiqueta, alTocar, cargando }) {
  const t = useTema();
  return (
    <Pressable onPress={alTocar} disabled={cargando} accessibilityRole="button" accessibilityLabel={etiqueta ?? texto}
      style={({ pressed }) => ({ flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', minHeight: 40, borderRadius: 12,
        backgroundColor: t.oscuro ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)', opacity: cargando ? 0.5 : 1, transform: [{ scale: pressed ? 0.96 : 1 }] })}>
      <Icono sf={sf} respaldo="" tam={14} color={colorSistema.texto} />
      <Text style={{ fontSize: 14, fontWeight: '700', color: colorSistema.texto }}>{cargando ? '…' : texto}</Text>
    </Pressable>
  );
}

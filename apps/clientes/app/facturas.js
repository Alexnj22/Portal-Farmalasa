// Mis facturas (2026-10-07; rehecha 2026-10-09): las facturas de consumidor
// final y los créditos fiscales, con su documento electrónico.
//
// - Por defecto, este mes y el anterior (El Salvador); «Todo» trae el resto.
// - Las anuladas salen, marcadas, y con sus documentos.
// - Cada nota de crédito va DEBAJO de la factura que corrige.
// - El PDF se ve DENTRO de la app: en iPhone la vista web lo muestra con la
//   dirección; en Android (que no sabe mostrar PDF) se descarga al teléfono y
//   lo pinta pdf.js dentro de la vista web (`lib/visorPdf.js`): el documento
//   no sale del teléfono ni pasa por un visor de terceros (2026-10-09).
// - 2026-10-14, «el PDF tarda»: el visor se abre AL TOCAR, con el indicador de
//   carga adentro, en vez de esperar la descarga con el botón apagado. En
//   iPhone se usa la dirección que ya trajo la lista (firmada por 24 h) y sólo
//   se pide otra si falta, si la lista es vieja o si la vista web la rechaza.
//   En Android el PDF ya no se lee a base64: lo abre pdf.js desde el archivo
//   (`htmlVisorPdfArchivo`), con el camino viejo de respaldo.
// - «Descargar» pregunta: enviarla por CORREO (`EnviarCorreoHoja`) o bajar el
//   PDF y el JSON de una vez. La hoja de compartir de iOS recibe un solo
//   archivo, así que van juntos en un .zip (`lib/zip.js`). En Android se
//   guardan en la carpeta que la persona elige (`Share` no manda archivos ahí).
// - «Seleccionar» (arriba) marca varias, hasta 30: «Enviar por correo» las
//   manda en un solo correo y «Descargar» las junta en un .zip.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Modal, Platform, Share, StyleSheet, Text, View } from 'react-native';
import Presionable from '../componentes/Presionable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useFocusEffect } from 'expo-router';
import { WebView } from 'react-native-webview';
import * as FS from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import { Cargando, Pantalla, RADIO, Tarjeta, Texto, Vacio } from '../componentes/ui';
import GrupoDeBotones from '../componentes/GrupoDeBotones';
import Segmentos from '../componentes/Segmentos';
import { colorSistema } from '../componentes/sistema';
import Icono from '../componentes/Icono';
import EnviarCorreoHoja from '../componentes/EnviarCorreoHoja';
import Vidrio from '../componentes/Vidrio';
import IndicadorCarga from '../componentes/IndicadorCarga';
import { useSesion } from '../lib/sesion';
import { useCuenta } from '../lib/cuenta';
import { dolares, fecha } from '../lib/formato';
import { armarZip, base64ABytes, bytesABase64 } from '../lib/zip';
import { htmlVisorPdf, htmlVisorPdfArchivo, ORIGEN_PDFJS } from '../lib/visorPdf';
import { suave, useTema } from '../tema/tema';
import { sinBloquear } from '../lib/bloqueo';
import { copiaParaEmpezar } from '../lib/sinConexion';

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
const enAndroid = Platform.OS === 'android';
const TOPE_SELECCION = 30; // el mismo tope que `facturas_enviar`
const MIME = { pdf: 'application/pdf', json: 'application/json', zip: 'application/zip' };
// La dirección firmada que trae `mis_facturas` vale 24 h (2026-10-14). Se usa
// mientras la lista tenga menos de 23 h — también la copia sin conexión.
const VIGENCIA_LISTA_MS = 23 * 3600_000;
const mensajeDeError = (e) => (e?.message && !/network|fetch/i.test(e.message) ? e.message : 'Revisa tu conexión e intenta de nuevo.');
const conDocumento = (f) => !f.sin_documento;
// Las facturas de la lista y sus notas, aplanadas (lo que se puede marcar).
const aplanar = (lista) => lista.flatMap((f) => [f, ...(f.notas ?? [])]);
const rotulo = (f) => `${tipoDe(f).texto}${f.numero ? ` N.º ${f.numero}` : ''}`;

// En Android `Share` no manda archivos: se guardan en la carpeta que la
// persona elige (Storage Access Framework, ya incluido en expo-file-system).
async function guardarEnAndroid(uri, nombre, ext) {
  const SAF = FS.StorageAccessFramework;
  const permiso = await sinBloquear(() => SAF.requestDirectoryPermissionsAsync());
  if (!permiso.granted) return false;
  const b64 = await FS.readAsStringAsync(uri, { encoding: FS.EncodingType.Base64 });
  const destino = await SAF.createFileAsync(permiso.directoryUri, nombre, MIME[ext]);
  await FS.writeAsStringAsync(destino, b64, { encoding: FS.EncodingType.Base64 });
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  Alert.alert('Guardado', `«${nombre}.${ext}» quedó en la carpeta que elegiste.`);
  return true;
}
async function entregar(uri, nombre, ext) {
  if (enAndroid) return guardarEnAndroid(uri, nombre, ext);
  await sinBloquear(() => Share.share({ url: uri, title: nombre }));
  return true;
}

export default function Facturas() {
  const pedir = useSesion((s) => s.pedir);
  const t = useTema();
  const [periodo, setPeriodo] = useState('reciente');
  const [porPeriodo, setPorPeriodo] = useState({});
  const [filtro, setFiltro] = useState('todas');
  const [refrescando, setRefrescando] = useState(false);
  const [ocupada, setOcupada] = useState(null);
  const [visor, setVisor] = useState(null);
  // Modo selección: `null` = apagado; si no, el Set de ids marcados.
  const [seleccion, setSeleccion] = useState(null);
  const [hojaCorreo, setHojaCorreo] = useState(null);
  const [bajandoVarias, setBajandoVarias] = useState(null);
  const d = porPeriodo[periodo];
  const preRegistro = useCuenta((s) => !!s.resumen?.pendiente);
  const cargar = useCallback(async () => {
    // Lo de la vez anterior se pinta al instante mientras llega lo fresco
    // (2026-10-15). `recibidas: 0`: sus direcciones firmadas se dan por
    // vencidas, así que ver o bajar un documento pide una nueva.
    copiaParaEmpezar('mis_facturas', { periodo }).then((c) => {
      if (c) setPorPeriodo((ant) => (ant[periodo] ? ant : { ...ant, [periodo]: { ...c, recibidas: 0 } }));
    });
    const r = await pedir('mis_facturas', { periodo });
    // Cuándo llegó (para saber si sus direcciones firmadas siguen vigentes).
    const conHora = r?.ok ? { ...r, recibidas: r.sinConexion ? (r.guardadoEn ?? 0) : Date.now() } : r;
    setPorPeriodo((ant) => ({ ...ant, [periodo]: r?.ok || !ant[periodo]?.ok ? conHora : ant[periodo] }));
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

  const lista = useMemo(() => (d?.ok ? d.facturas.filter((f) => pasaFiltro(f, filtro)) : []), [d, filtro]);
  // Todo lo que está cargado (de cualquier filtro), por id: la selección
  // sobrevive a cambiar de filtro.
  const porId = useMemo(() => new Map(aplanar(d?.ok ? d.facturas : []).map((f) => [String(f.id), f])), [d]);
  const elegibles = useMemo(() => aplanar(lista).filter(conDocumento), [lista]);

  // La dirección de un documento: la que vino con la lista o, si no estaba
  // guardado (o la firma ya venció), una nueva.
  const pedirUrl = async (f, formato) => {
    const r = await pedir('factura_documento', { id: f.id, formato });
    if (!r?.ok) throw new Error(r?.mensaje ?? 'El documento todavía no está disponible. Intenta más tarde.');
    return r.url;
  };
  const bajar = async (f, formato, nombre = nombreArchivo(f)) => {
    const destino = `${FS.cacheDirectory}${nombre}.${formato}`;
    const lista0 = formato === 'pdf' ? f.pdf : f.json;
    let r = await FS.downloadAsync(lista0 ?? await pedirUrl(f, formato), destino);
    if (r.status !== 200 && lista0) r = await FS.downloadAsync(await pedirUrl(f, formato), destino);
    if (r.status !== 200) throw new Error('El documento todavía no está disponible. Intenta más tarde.');
    return r.uri;
  };
  const conEspera = async (clave, fn) => {
    Haptics.selectionAsync().catch(() => {});
    setOcupada(clave);
    try { await fn(); } catch (e) {
      Alert.alert('No se pudo abrir', mensajeDeError(e));
    } finally { setOcupada(null); }
  };

  // El visor se abre YA, cargando (2026-10-14). `turno` descarta lo que llega
  // tarde: si se cerró o se abrió otra factura mientras tanto, no se pisa.
  const turnoVisor = useRef(0);
  const verPdf = async (f) => {
    Haptics.selectionAsync().catch(() => {});
    const turno = ++turnoVisor.current;
    const poner = (x) => { if (turnoVisor.current === turno) setVisor({ f, ...x }); };
    poner({ cargando: true });
    try {
      // iPhone: la vista web muestra el PDF con su dirección. La de la lista
      // sirve 24 h; si no vino o la lista es vieja, una recién firmada. Si la
      // vista web la rechaza igual, el visor pide otra (`alRenovar`).
      if (enIphone) {
        const fresca = d?.recibidas && Date.now() - d.recibidas < VIGENCIA_LISTA_MS;
        poner(f.pdf && fresca ? { url: f.pdf, deLaLista: true } : { url: await pedirUrl(f, 'pdf') });
        return;
      }
      // Android no sabe mostrar PDF: se baja al teléfono y lo pinta pdf.js.
      poner({ archivo: await bajar(f, 'pdf') });
    } catch (e) {
      poner({ error: mensajeDeError(e) });
    }
  };
  const cerrarVisor = () => { turnoVisor.current += 1; setVisor(null); };
  const compartirJson = (f) => conEspera(`${f.id}json`, async () => {
    await entregar(await bajar(f, 'json'), nombreArchivo(f), 'json');
  });
  const compartirPdf = async (f) => {
    await entregar(await bajar(f, 'pdf'), nombreArchivo(f), 'pdf');
  };

  // Varias facturas (o una) en un .zip con su PDF y su JSON. Lo que no esté
  // disponible se salta y se avisa; si sólo hay UN archivo, va ése solo.
  const bajarEnZip = async (docs, nombreZip) => {
    const usados = new Set();
    const nombres = docs.map((f) => {
      let n = nombreArchivo(f);
      for (let i = 2; usados.has(n); i++) n = `${nombreArchivo(f)}_${i}`;
      usados.add(n);
      return n;
    });
    const tareas = docs.flatMap((f, i) => ['pdf', 'json'].map((ext) => ({ f, ext, nombre: nombres[i] })));
    const listos = [];
    let faltan = 0;
    for (let i = 0; i < tareas.length; i += 4) {
      const tanda = await Promise.allSettled(tareas.slice(i, i + 4).map(async (x) => ({ ...x, uri: await bajar(x.f, x.ext, x.nombre) })));
      for (const r of tanda) if (r.status === 'fulfilled') listos.push(r.value); else faltan++;
      if (docs.length > 1) setBajandoVarias(Math.min(tareas.length, i + 4) / tareas.length);
    }
    if (!listos.length) throw new Error('Los documentos todavía no están disponibles. Intenta más tarde.');
    if (listos.length === 1) {
      await entregar(listos[0].uri, listos[0].nombre, listos[0].ext);
    } else {
      const archivos = await Promise.all(listos.map(async (x) => ({
        nombre: `${x.nombre}.${x.ext}`,
        bytes: base64ABytes(await FS.readAsStringAsync(x.uri, { encoding: FS.EncodingType.Base64 })),
      })));
      const destino = `${FS.cacheDirectory}${nombreZip}.zip`;
      await FS.writeAsStringAsync(destino, bytesABase64(armarZip(archivos)), { encoding: FS.EncodingType.Base64 });
      await entregar(destino, nombreZip, 'zip');
    }
    if (faltan) Alert.alert('Faltó algún documento', `${faltan === 1 ? 'Un archivo no estaba' : `${faltan} archivos no estaban`} disponible todavía. Intenta con ${faltan === 1 ? 'ése' : 'ésos'} más tarde.`);
  };
  const descargarAmbos = (f) => conEspera(`${f.id}ambos`, () => bajarEnZip([f], nombreArchivo(f)));

  const abrirCorreo = (docs) => {
    if (!docs.length) return;
    setHojaCorreo({
      ids: docs.map((f) => String(f.id)),
      resumen: docs.length === 1 ? `${rotulo(docs[0])} · ${fecha(docs[0].fecha)}` : docs.slice(0, 3).map(rotulo).join(', ') + (docs.length > 3 ? '…' : ''),
    });
  };
  // «Descargar» de una factura: ¿al correo o al teléfono?
  const obtener = (f) => {
    Haptics.selectionAsync().catch(() => {});
    ActionSheetIOS.showActionSheetWithOptions({
      title: rotulo(f),
      message: 'Su PDF y su archivo JSON.',
      options: ['Enviar por correo', enAndroid ? 'Guardar en el teléfono' : 'Descargar', 'Cancelar'],
      cancelButtonIndex: 2,
    }, (i) => {
      if (i === 0) abrirCorreo([f]);
      else if (i === 1) descargarAmbos(f);
    });
  };
  // «…» junto a «Ver PDF» (2026-10-13): en un teléfono chico o con letra grande
  // los tres botones no cabían en una fila. El JSON y la descarga van en la hoja
  // de opciones del sistema (en Android, la de componentes/HojasAndroid).
  const masOpciones = (f) => {
    Haptics.selectionAsync().catch(() => {});
    ActionSheetIOS.showActionSheetWithOptions({
      title: rotulo(f),
      options: ['Compartir JSON', 'Enviar por correo', enAndroid ? 'Guardar PDF y JSON en el teléfono' : 'Descargar PDF y JSON', 'Cancelar'],
      cancelButtonIndex: 3,
    }, (i) => {
      if (i === 0) compartirJson(f);
      else if (i === 1) abrirCorreo([f]);
      else if (i === 2) descargarAmbos(f);
    });
  };
  const acciones = { verPdf, compartirJson, obtener, masOpciones };

  // ── Selección ───────────────────────────────────────────────────────────
  const marcados = seleccion ? [...seleccion].map((id) => porId.get(id)).filter(Boolean) : [];
  const alternar = (f) => {
    const id = String(f.id);
    setSeleccion((s) => {
      const n = new Set(s ?? []);
      if (n.has(id)) n.delete(id);
      else if (n.size >= TOPE_SELECCION) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        Alert.alert('Máximo 30', `Puedes elegir hasta ${TOPE_SELECCION} facturas a la vez.`);
        return s;
      } else n.add(id);
      Haptics.selectionAsync().catch(() => {});
      return n;
    });
  };
  const todasMarcadas = elegibles.length > 0 && elegibles.slice(0, TOPE_SELECCION).every((f) => seleccion?.has(String(f.id)));
  const marcarTodas = () => {
    Haptics.selectionAsync().catch(() => {});
    setSeleccion(todasMarcadas ? new Set() : new Set(elegibles.slice(0, TOPE_SELECCION).map((f) => String(f.id))));
  };
  const salirDeSeleccion = () => { setSeleccion(null); setBajandoVarias(null); };
  const descargarMarcadas = async () => {
    if (!marcados.length || bajandoVarias != null) return;
    Haptics.selectionAsync().catch(() => {});
    setBajandoVarias(0);
    try {
      await bajarEnZip(marcados, `Facturas-${new Date().toISOString().slice(0, 10)}`);
    } catch (e) {
      Alert.alert('No se pudo descargar', e?.message && !/network|fetch/i.test(e.message) ? e.message : 'Revisa tu conexión e intenta de nuevo.');
    } finally { setBajandoVarias(null); }
  };

  const cuerpo = !d ? <Cargando />
    // Sin ficha todavía (2026-10-12): antes decía «… para reservar».
    : d.pendiente || (!d.ok && preRegistro) ? <Vacio titulo="Sin facturas" icono="doc.text.fill" respaldo="▤">Cuando completes tu registro en cualquier sucursal verás aquí las facturas de tus compras.</Vacio>
    : !d.ok ? <Vacio titulo="No se pudieron cargar">{d.mensaje ?? 'Revisa tu conexión.'}</Vacio>
      : (
        <>
          {!lista.length ? <Vacio titulo={filtro === 'todas' ? 'Sin facturas' : 'Nada por aquí'} icono="doc.text.fill" respaldo="▤">{VACIO[filtro]}</Vacio> : null}
          {lista.map((f) => <Factura key={f.id} f={f} ocupada={ocupada} acciones={acciones} seleccion={seleccion} alternar={alternar} />)}
          {d.siguiente ? (
            <Presionable onPress={cargarMas} disabled={masCargando} accessibilityRole="button"
              style={({ pressed }) => ({ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, minHeight: 44, borderRadius: 999, opacity: pressed ? 0.6 : 1 })}>
              {masCargando ? <ActivityIndicator /> : null}
              <Texto nivel={2} estilo={{ fontSize: 14, fontWeight: '600' }}>{masCargando ? 'Cargando más…' : 'Ver más facturas'}</Texto>
            </Presionable>
          ) : null}
          {seleccion ? <View style={{ height: 96 }} /> : null}
        </>
      );

  return (
    <>
      <Stack.Screen options={{
        headerRight: d?.ok && (seleccion || elegibles.length) ? () => (
          <Presionable onPress={() => { Haptics.selectionAsync().catch(() => {}); if (seleccion) salirDeSeleccion(); else setSeleccion(new Set()); }}
            hitSlop={10} accessibilityRole="button" accessibilityLabel={seleccion ? 'Terminar la selección' : 'Seleccionar varias facturas'}
            style={({ pressed }) => ({ paddingHorizontal: 6, minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
            <Text style={{ fontSize: 17, fontWeight: seleccion ? '600' : '400', color: t.color.magentaTexto }}>{seleccion ? 'Listo' : 'Seleccionar'}</Text>
          </Presionable>
        ) : undefined,
      }} />
      <Pantalla sinVidrio conPestanas={false} conBurbuja={false} alRefrescar={d && !seleccion ? refrescar : undefined} refrescando={refrescando} alFinal={d?.siguiente ? cargarMas : undefined}>
        <View style={{ marginHorizontal: -16 }}>
          <Segmentos opciones={PERIODOS} valor={periodo} alCambiar={(p) => { setPeriodo(p); if (seleccion) setSeleccion(new Set()); }} />
        </View>
        {/* Android: botones conectados de Material 3 Expressive (2026-10-14). */}
        <GrupoDeBotones opciones={ESTADOS} valor={filtro} alCambiar={setFiltro} />
        {seleccion ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 }}>
            <Texto nivel={2} estilo={{ fontSize: 14 }}>
              {marcados.length ? `${marcados.length} ${marcados.length === 1 ? 'elegida' : 'elegidas'}` : 'Toca las facturas que quieras'}
            </Texto>
            {elegibles.length ? (
              <Presionable onPress={marcarTodas} hitSlop={8} accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center' }}>
                <Text style={{ fontSize: 15, fontWeight: '600', color: t.color.magentaTexto }}>
                  {todasMarcadas ? 'Quitar todas' : elegibles.length > TOPE_SELECCION ? `Elegir ${TOPE_SELECCION}` : 'Elegir todas'}
                </Text>
              </Presionable>
            ) : null}
          </View>
        ) : null}
        {cuerpo}
      </Pantalla>
      {seleccion ? (
        <BarraSeleccion cantidad={marcados.length} progreso={bajandoVarias}
          alEnviar={() => { Haptics.selectionAsync().catch(() => {}); abrirCorreo(marcados); }} alDescargar={descargarMarcadas} />
      ) : null}
      {visor ? <VisorPdf visor={visor} alCerrar={cerrarVisor} alCompartir={compartirPdf} alRenovar={() => pedirUrl(visor.f, 'pdf')} /> : null}
      {hojaCorreo ? (
        <EnviarCorreoHoja ids={hojaCorreo.ids} resumen={hojaCorreo.resumen} alCerrar={() => setHojaCorreo(null)}
          alEnviar={() => { if (seleccion) setSeleccion(new Set()); }} />
      ) : null}
    </>
  );
}

// Abajo, mientras se elige: cuántas, «Enviar por correo» y «Descargar».
function BarraSeleccion({ cantidad, progreso, alEnviar, alDescargar }) {
  const t = useTema();
  const ins = useSafeAreaInsets();
  const apagada = !cantidad || progreso != null;
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingBottom: Math.max(ins.bottom, 12) + 4 }}>
      <Vidrio radio={24} style={{ width: '100%', maxWidth: 560, alignSelf: 'center' }}>
        <View style={{ flexDirection: 'row', gap: 10, padding: 10 }}>
          <Presionable onPress={alEnviar} disabled={apagada} accessibilityRole="button" accessibilityState={{ disabled: apagada }}
            accessibilityLabel={`Enviar por correo ${cantidad} facturas`}
            style={({ pressed }) => ({ flex: 1, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', minHeight: 48, borderRadius: 16,
              backgroundColor: t.color.magenta, opacity: apagada ? 0.45 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
            <Icono sf="envelope.fill" respaldo="" tam={15} color="#FFFFFF" />
            <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFFFFF' }}>Enviar por correo</Text>
          </Presionable>
          <Presionable onPress={alDescargar} disabled={apagada} accessibilityRole="button" accessibilityState={{ disabled: apagada }}
            accessibilityLabel={`Descargar ${cantidad} facturas`}
            style={({ pressed }) => ({ flex: 1, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', minHeight: 48, borderRadius: 16,
              backgroundColor: t.oscuro ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)', opacity: apagada && progreso == null ? 0.45 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
            {progreso != null ? <ActivityIndicator /> : <Icono sf="square.and.arrow.down" respaldo="" tam={15} color={colorSistema.texto} />}
            <Text style={{ fontSize: 15, fontWeight: '700', color: colorSistema.texto, fontVariant: ['tabular-nums'] }}>
              {progreso != null ? `${Math.round(progreso * 100)} %` : enAndroid ? 'Guardar' : 'Descargar'}
            </Text>
          </Presionable>
        </View>
      </Vidrio>
    </View>
  );
}

// El PDF dentro de la app: una hoja con la vista web y, arriba, cerrar y compartir.
// Se abre al tocar, con el indicador de carga (2026-10-14); el documento llega
// después: en iPhone una dirección, en Android el archivo ya descargado.
function VisorPdf({ visor, alCerrar, alCompartir, alRenovar }) {
  const t = useTema();
  const [compartiendo, setCompartiendo] = useState(false);
  const fondo = t.oscuro ? '#121016' : '#F5F4F8';
  const listo = !visor.cargando && !visor.error;
  const compartir = async () => {
    if (compartiendo || !listo) return;
    setCompartiendo(true);
    try { await alCompartir(visor.f); } catch { Alert.alert('No se pudo compartir', 'Revisa tu conexión e intenta de nuevo.'); } finally { setCompartiendo(false); }
  };
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={alCerrar}>
      <View style={{ flex: 1, backgroundColor: fondo }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 14, gap: 12 }}>
          <Presionable onPress={alCerrar} hitSlop={12} accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center' }}>
            <Text style={{ fontSize: 17, fontWeight: '600', color: colorSistema.texto }}>Cerrar</Text>
          </Presionable>
          <Text numberOfLines={1} style={{ flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: colorSistema.texto }}>
            {rotulo(visor.f)}
          </Text>
          <Presionable onPress={compartir} hitSlop={12} accessibilityRole="button" accessibilityLabel={enAndroid ? 'Guardar PDF' : 'Compartir PDF'}
            disabled={compartiendo || !listo} accessibilityState={{ disabled: compartiendo || !listo }}
            style={{ minWidth: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center', opacity: compartiendo || !listo ? 0.4 : 1 }}>
            {compartiendo ? <ActivityIndicator /> : <Icono sf="square.and.arrow.up" respaldo="↗" tam={20} color={t.color.magenta} />}
          </Presionable>
        </View>
        {visor.error ? (
          <View style={{ padding: 16 }}><Vacio titulo="No se pudo abrir">{visor.error}</Vacio></View>
        ) : visor.cargando ? (
          <CargandoPdf />
        ) : visor.url ? (
          <PdfPorDireccion key={visor.url} url={visor.url} deLaLista={!!visor.deLaLista} fondo={fondo} alRenovar={alRenovar} />
        ) : (
          <PdfPorArchivo key={visor.archivo} archivo={visor.archivo} fondo={fondo} />
        )}
      </View>
    </Modal>
  );
}

function CargandoPdf() {
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 72, left: 0, right: 0, alignItems: 'center', gap: 12 }}>
      <IndicadorCarga tam="grande" />
      <Text style={{ fontSize: 14, color: colorSistema.texto2 }}>Abriendo el PDF…</Text>
    </View>
  );
}

function ErrorPdf() {
  return (
    <View style={{ padding: 16 }}>
      <Vacio titulo="No se pudo mostrar">Revisa tu conexión y vuelve a intentar, o guarda el PDF con el botón de arriba.</Vacio>
    </View>
  );
}

// iPhone: la vista web muestra el PDF con su dirección. Si la de la lista ya
// no sirve (venció, o la lista era una copia sin conexión), se pide UNA nueva.
function PdfPorDireccion({ url: inicial, deLaLista, fondo, alRenovar }) {
  const [url, setUrl] = useState(inicial);
  const [renovada, setRenovada] = useState(!deLaLista);
  const [error, setError] = useState(false);
  const [pintado, setPintado] = useState(false);
  const fallo = async () => {
    if (renovada) { setError(true); return; }
    setRenovada(true); setPintado(false);
    try { setUrl(await alRenovar()); } catch { setError(true); }
  };
  if (error) return <ErrorPdf />;
  const origen = `${url.split('/').slice(0, 3).join('/')}/`;
  return (
    <View style={{ flex: 1 }}>
      <WebView key={url} source={{ uri: url }} originWhitelist={['*']} style={{ flex: 1, backgroundColor: fondo }}
        onLoadEnd={() => setPintado(true)}
        onError={fallo} onHttpError={fallo}
        // Sólo el documento: nada lleva afuera.
        onShouldStartLoadWithRequest={(r) => r.url.startsWith(origen) || r.url === 'about:blank'}
        allowsBackForwardNavigationGestures={false} dataDetectorTypes="none" />
      {!pintado ? <CargandoPdf /> : null}
    </View>
  );
}

// Android: pdf.js dentro de la vista web. Primero leyendo el archivo desde
// `file://` (sin pasar el PDF por JavaScript); si esa vía no anda en este
// teléfono, la de siempre: el PDF en base64 dentro del HTML.
function PdfPorArchivo({ archivo, fondo }) {
  const [modo, setModo] = useState('archivo');
  const [fuente, setFuente] = useState(null);
  const [error, setError] = useState(false);
  const [pintado, setPintado] = useState(false);
  useEffect(() => {
    let vivo = true;
    setFuente(null);
    (async () => {
      try {
        if (modo === 'archivo') {
          const nombre = archivo.split('/').pop();
          const html = `${archivo.slice(0, archivo.length - nombre.length)}visor-pdf.html`;
          await FS.writeAsStringAsync(html, htmlVisorPdfArchivo(nombre, fondo));
          if (vivo) setFuente({ uri: html });
        } else {
          const base64 = await FS.readAsStringAsync(archivo, { encoding: FS.EncodingType.Base64 });
          if (vivo) setFuente({ html: htmlVisorPdf(base64, fondo), baseUrl: ORIGEN_PDFJS });
        }
      } catch {
        if (!vivo) return;
        if (modo === 'archivo') setModo('base64'); else setError(true);
      }
    })();
    return () => { vivo = false; };
  }, [modo, archivo, fondo]);
  const reintentar = () => { if (modo === 'archivo') setModo('base64'); else setError(true); };
  if (error) return <ErrorPdf />;
  return (
    <View style={{ flex: 1 }}>
      {fuente ? (
        <WebView key={modo} source={fuente} originWhitelist={['*']} style={{ flex: 1, backgroundColor: fondo }}
          // El HTML lee el PDF vecino con XHR: hace falta leer archivos desde `file://`.
          allowFileAccess={modo === 'archivo'} allowFileAccessFromFileURLs={modo === 'archivo'}
          onError={() => (modo === 'archivo' ? reintentar() : setError(true))}
          onMessage={(e) => {
            const m = e.nativeEvent.data;
            if (m === 'reintentar') reintentar();
            else if (m === 'error') setError(true);
            else setPintado(true);
          }}
          // Sólo el documento y la librería que lo pinta: nada lleva afuera.
          onShouldStartLoadWithRequest={(r) => r.url.startsWith(ORIGEN_PDFJS) || r.url.startsWith('file://') || r.url === 'about:blank' || r.url.startsWith('data:') || r.url.startsWith('blob:')}
          allowsBackForwardNavigationGestures={false} dataDetectorTypes="none"
          setBuiltInZoomControls setDisplayZoomControls={false} />
      ) : null}
      {!pintado ? <CargandoPdf /> : null}
    </View>
  );
}

// Una factura y, debajo, sus notas de crédito.
// En modo selección cada documento lleva su casilla y tocarlo lo marca.
function Factura({ f, ocupada, acciones, seleccion, alternar }) {
  return (
    <Tarjeta estilo={{ gap: 12 }}>
      <Documento f={f} ocupada={ocupada} acciones={acciones} seleccion={seleccion} alternar={alternar} />
      {(f.notas ?? []).map((n) => (
        <View key={n.id} style={{ gap: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colorSistema.separador }}>
          <Documento f={n} ocupada={ocupada} acciones={acciones} seleccion={seleccion} alternar={alternar} anidada />
        </View>
      ))}
    </Tarjeta>
  );
}

function Documento({ f, ocupada, acciones, seleccion, alternar, anidada = false }) {
  const t = useTema();
  const tipo = tipoDe(f);
  const nota = f.tipo === 'nota_credito';
  // El naranja en hex (no el del sistema): el ícono y `suave` necesitan un color fijo.
  const naranja = t.oscuro ? '#FF9F0A' : '#B26A00';
  const tono = nota ? '#FF9F0A' : f.tipo === 'credito_fiscal' ? t.color.magenta : t.color.verde;
  const tonoTexto = nota ? naranja : f.tipo === 'credito_fiscal' ? t.color.magentaTexto : t.color.verdeTexto;
  const lado = anidada ? 32 : 40;
  const eligiendo = !!seleccion;
  const marcable = eligiendo && !f.sin_documento;
  const marcado = marcable && seleccion.has(String(f.id));
  const fila = (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: anidada ? 8 : 0 }}>
        {eligiendo ? (
          <Icono sf={marcado ? 'checkmark.circle.fill' : 'circle'} respaldo={marcado ? '●' : '○'} tam={24}
            color={marcado ? t.color.magenta : marcable ? colorSistema.texto3 : colorSistema.separador} />
        ) : null}
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
  );
  if (eligiendo) {
    return (
      <Presionable onPress={() => marcable && alternar(f)} disabled={!marcable}
        accessibilityRole="checkbox" accessibilityState={{ checked: marcado, disabled: !marcable }}
        accessibilityLabel={`${tipo.texto}${f.numero ? ` número ${f.numero}` : ''}, ${dolares(f.total)}`}
        style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', opacity: !marcable ? 0.5 : pressed ? 0.7 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
        {fila}
      </Presionable>
    );
  }
  return (
    <>
      {fila}
      {f.sin_documento ? (
        <Text style={{ fontSize: 13, color: colorSistema.texto3 }}>Ejemplo sin documento.</Text>
      ) : (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Accion sf="doc.richtext.fill" texto="Ver PDF" cargando={ocupada === `${f.id}pdf`} alTocar={() => acciones.verPdf(f)} />
          <Accion sf="ellipsis" respaldo="…" etiqueta="Más opciones: compartir el JSON, enviar por correo o descargar"
            cargando={ocupada === `${f.id}json` || ocupada === `${f.id}ambos`} alTocar={() => acciones.masOpciones(f)} />
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

// Sin `texto`, es el botón cuadrado de «…» (44 × 44).
function Accion({ sf, respaldo = '', texto, etiqueta, alTocar, cargando }) {
  const t = useTema();
  return (
    <Presionable onPress={alTocar} disabled={cargando} accessibilityRole="button" accessibilityLabel={etiqueta ?? texto}
      style={({ pressed }) => ({ flex: texto ? 1 : 0, width: texto ? undefined : 44, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', minHeight: 44, borderRadius: RADIO.chico,
        backgroundColor: t.oscuro ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)', opacity: cargando ? 0.5 : 1, transform: [{ scale: pressed ? 0.96 : 1 }] })}>
      {cargando && !texto ? <ActivityIndicator /> : <Icono sf={sf} respaldo={respaldo} tam={14} color={colorSistema.texto} />}
      {texto ? <Text style={{ fontSize: 14, fontWeight: '700', color: colorSistema.texto }}>{cargando ? '…' : texto}</Text> : null}
    </Presionable>
  );
}

// Novedades, NATIVO — `NovedadesView`: lo nuevo del portal y la app para el
// personal, cada cargo con lo suyo. Antes se abría como el portal dentro de la
// app (usuario, 2026-11-17: «las novedades en la app se ve como web»).
//
//   · «Lo nuevo»: el avance (cuántas revisó de las que le tocan) y una tarjeta
//     por novedad con su imagen fija. Tocar una abre su hoja: la animación, para
//     qué sirve, los pasos y lo que hay que tener en cuenta; «Ir ahí» abre la
//     pantalla que explica (nativa si la tiene). Abrirla la marca como
//     revisada EN LA BASE con el mismo hook del portal (`useNovedadesVistas`),
//     así cuenta igual en el teléfono y en la computadora.
//   · Quien edita Novedades ve además «Quién las vio» (la cuenta por persona,
//     `filasDeQuienVio` del núcleo, la misma del portal) y «Android» (la lista
//     de la prueba de Google Play: copiar correos, marcar agregados y avisar).
//
// La tarjeta «App del personal» del portal (descargarla y dejar el correo de
// Android) no va aquí: quien la ve ya está dentro de la app.
//
// La animación es un WebP animado servido por el portal. La imagen de React
// Native no lo anima en Android sin recompilar la app (`expo.webp.animated`),
// así que va en una vista web mínima con sólo esa imagen: se anima en los dos
// sistemas y sale por actualización por aire.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Image, Modal, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { WebView } from 'react-native-webview';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import useNovedadesVistas from '@nucleo/hooks/useNovedadesVistas';
import { TEMAS, novedadesVisibles } from '@nucleo/constants/novedades';
import {
  fetchPruebasAndroid, fetchQuienVioNovedades, marcarAgregadosEnPlay, mensajeDeNovedades, reenviarAvisoAndroid,
} from '@nucleo/data/novedades';
import {
  ESTADOS_QUIEN, claveDeNovedad, estadoDeAvance, filasDeQuienVio, ordenDeAvance,
} from '@nucleo/utils/quienVioNovedades';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { fechaTexto } from '@nucleo/utils/fecha';
import { fechaHora12 } from '@nucleo/utils/hora';
import { PORTAL_URL } from '@plataforma/config';
import { abrirRuta } from '../pantallas';
import { BARRA_FIJA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { BotonGrande, Vacio } from '../componentes/formulario/Piezas';
import { Anillo, Insignia, Pildora, Renglon, Caja, Nota } from '../componentes/avisos/Piezas';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import { Presionable as Pressable } from '../componentes/Tocable';
import Segmentos from '../componentes/Segmentos';
import FijoArriba from '../componentes/FijoArriba';
import Refrescar from '../componentes/Refrescar';
import Vidrio from '../componentes/Vidrio';
import Avatar from '../componentes/Avatar';
import ConAurora from '../componentes/ConAurora';
import EncabezadoDeHoja from '../componentes/EncabezadoDeHoja';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo } from '../componentes/Progreso';

// Los íconos de las novedades son de lucide (portal); acá, su par en la app.
const ICONO = { UserPlus: 'Users', PackageCheck: 'Package', CircleAlert: 'AlertCircle', UserRound: 'User', Inbox: 'Bandeja' };
const iconoDeNovedad = (n) => ICONO[n.icono] ?? n.icono ?? 'Megaphone';
const urlDe = (ruta) => (ruta ? `${PORTAL_URL}${ruta}` : null);
const dia = (iso) => (iso ? fechaTexto(iso, { day: 'numeric', month: 'long' }) : '');
const PLAY_CONSOLE = 'https://play.google.com/console';
const Separador = () => <View style={{ height: 12 }} />;

// ── La animación ────────────────────────────────────────────────────────────

function Animacion({ n, ancho }) {
  const [proporcion, setProporcion] = useState(16 / 9);
  const portada = urlDe(n.media?.portada || n.media?.src);
  useEffect(() => {
    if (!portada) return;
    Image.getSize(portada, (w, h) => { if (w && h) setProporcion(w / h); }, () => {});
  }, [portada]);
  if (!n.media) return null;
  const alto = Math.round(ancho / proporcion);
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<style>html,body{margin:0;padding:0;background:transparent}img{display:block;width:100%;height:auto}</style></head>
<body><img src="${urlDe(n.media.src)}" alt=""></body></html>`;
  return (
    <View style={{ width: ancho, height: alto, borderRadius: 18, overflow: 'hidden', backgroundColor: 'rgba(127,127,127,0.13)' }}
      accessibilityRole="image" accessibilityLabel={`Cómo se hace: ${n.titulo}`}>
      <Image source={{ uri: portada }} style={{ position: 'absolute', width: ancho, height: alto }} resizeMode="cover" />
      {n.media.tipo === 'animacion' ? (
        <WebView source={{ html, baseUrl: PORTAL_URL }} originWhitelist={['*']} scrollEnabled={false} bounces={false}
          style={{ width: ancho, height: alto, backgroundColor: 'transparent' }} containerStyle={{ backgroundColor: 'transparent' }}
          pointerEvents="none" javaScriptEnabled={false} />
      ) : null}
    </View>
  );
}

// ── La hoja de una novedad ──────────────────────────────────────────────────

function HojaDeNovedad({ n, posicion, onCerrar, onAnterior, onSiguiente }) {
  const { width } = useWindowDimensions();
  const ancho = Math.min(width, 700) - 40;
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal onRequestClose={onCerrar}>
      <ConAurora>
        <EncabezadoDeHoja titulo={n.titulo} subtitulo={n.donde} onCerrar={onCerrar} />
        <ScrollView contentContainerStyle={{ padding: 20, gap: 18, paddingBottom: 60 }}>
          <Animacion key={n.id} n={n} ancho={ancho} />
          {n.media?.tipo === 'animacion' ? (
            <Text style={{ color: colorSistema.texto2, fontSize: 13, textAlign: 'center', marginTop: -8 }}>La animación se repite sola.</Text>
          ) : null}
          <Text style={{ color: colorSistema.texto, fontSize: 18, lineHeight: 25 }}>{n.resumen}</Text>
          {n.para ? (
            <View style={{ borderRadius: 16, padding: 14, gap: 4, backgroundColor: `${MARCA.azulClaro}1F`, borderWidth: 1, borderColor: `${MARCA.azulClaro}33` }}>
              <Text style={{ color: MARCA.azulClaro, fontSize: 13, fontWeight: '700' }}>Para qué te sirve</Text>
              <Text style={{ color: colorSistema.texto, fontSize: 16, lineHeight: 22 }}>{n.para}</Text>
            </View>
          ) : null}
          <View style={{ gap: 12 }}>
            <Text style={{ color: MARCA.azulClaro, fontSize: 13, fontWeight: '700' }}>Cómo se hace</Text>
            {n.pasos.map((p, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
                <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: MARCA.azul, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: '#fff', fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{i + 1}</Text>
                </View>
                <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, lineHeight: 22, paddingTop: 4 }}>{p}</Text>
              </View>
            ))}
          </View>
          {n.ojo?.length ? (
            <View style={{ gap: 8 }}>
              <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '700' }}>Ten en cuenta</Text>
              {n.ojo.map((o, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 10 }}>
                  <Text style={{ color: MARCA.verde, fontSize: 15, fontWeight: '800' }}>✓</Text>
                  <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 15, lineHeight: 21 }}>{o}</Text>
                </View>
              ))}
            </View>
          ) : null}
          <View style={{ gap: 10, marginTop: 6 }}>
            {n.ruta ? <BotonGrande texto="Ir ahí" borde onPress={() => { onCerrar(); abrirRuta(n.ruta); }} /> : null}
            {onSiguiente ? <BotonGrande texto="Siguiente" onPress={onSiguiente} /> : <BotonGrande texto="Listo" onPress={onCerrar} />}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Pressable onPress={onAnterior} disabled={!onAnterior} accessibilityRole="button" hitSlop={8}
                style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 6, opacity: onAnterior ? 1 : 0.35 }}>
                <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '600' }}>‹ Anterior</Text>
              </Pressable>
              <Text style={{ color: colorSistema.texto2, fontSize: 13, fontVariant: ['tabular-nums'] }}>{posicion}</Text>
              <View style={{ width: 90 }} />
            </View>
          </View>
        </ScrollView>
      </ConAurora>
    </Modal>
  );
}

// ── Lo nuevo ────────────────────────────────────────────────────────────────

function Tarjeta({ n, revisada, onAbrir }) {
  const portada = urlDe(n.media?.portada || n.media?.src);
  return (
    <Pressable onPress={onAbrir} accessibilityRole="button" accessibilityLabel={`Ver cómo: ${n.titulo}`}
      style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
      <Vidrio radio={22} interactivo>
        {portada ? (
          <Image source={{ uri: portada }} style={{ width: '100%', aspectRatio: 16 / 9, borderTopLeftRadius: 22, borderTopRightRadius: 22 }} resizeMode="cover" />
        ) : null}
        <View style={{ padding: 14, gap: 8 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {n.nuevo ? <Pildora texto="Nuevo" color={MARCA.verde} /> : null}
            {revisada ? <Pildora texto="Revisada" color={MARCA.azulClaro} /> : null}
            {n.media?.tipo === 'animacion' ? <Pildora texto="Animación" color={MARCA.violeta} /> : null}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Insignia icono={iconoDeNovedad(n)} tamano={36} />
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 17, fontWeight: '700' }}>{n.titulo}</Text>
          </View>
          <Text style={{ color: colorSistema.texto2, fontSize: 15, lineHeight: 21 }} numberOfLines={3}>{n.resumen}</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginTop: 2 }}>
            <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 12 }} numberOfLines={1}>{n.donde}</Text>
            <Text style={{ color: MARCA.azulClaro, fontSize: 13, fontWeight: '700' }}>Ver cómo ›</Text>
          </View>
        </View>
      </Vidrio>
    </Pressable>
  );
}

function LoNuevo({ user, ctx, cargo, texto }) {
  const { vistas, marcar } = useNovedadesVistas(user?.id);
  const revisadas = vistas ?? new Set();
  const [tema, setTema] = useState('todos');
  const [abierta, setAbierta] = useState(null);
  const tandas = useMemo(() => novedadesVisibles(ctx), [ctx]);
  const galeria = useMemo(() => tandas.flatMap((t) => t.novedades.map((n) => ({ ...n, tanda: t.id })))
    .filter((n) => n.especial !== 'app-personal'), [tandas]);
  const visibles = galeria.filter((n) => (tema === 'todos' || n.tema === tema)
    && (!texto.trim() || tokenMatch(texto, n.titulo, n.resumen, n.donde, ...(n.pasos || []))));
  const total = galeria.length;
  const hechas = galeria.filter((n) => revisadas.has(claveDeNovedad(n))).length;
  const pct = total ? Math.round((hechas / total) * 100) : 0;
  const tanda = tandas[0];

  const ver = (n) => {
    setAbierta(n.id);
    if (!revisadas.has(claveDeNovedad(n))) marcar(claveDeNovedad(n));
  };
  const indice = abierta ? visibles.findIndex((n) => n.id === abierta) : -1;
  const actual = indice >= 0 ? visibles[indice] : null;

  const temas = TEMAS.filter((t) => t.value !== 'app')
    .map((t) => ({ id: t.value, n: t.value === 'todos' ? total : galeria.filter((x) => x.tema === t.value).length, label: t.label }))
    .filter((t) => t.n > 0)
    .map((t) => ({ id: t.id, label: `${t.label} · ${t.n}` }));
  const grupos = temas.length > 2 ? [{ id: 'tema', titulo: 'Tema', porDefecto: 'todos', activa: tema, onCambiar: setTema, opciones: temas }] : [];

  return (
    <>
      <MenuDeFiltros grupos={grupos} />
      <FlatList style={{ flex: 1 }} data={visibles} keyExtractor={(n) => claveDeNovedad(n)}
        contentContainerStyle={{ paddingVertical: 12, paddingBottom: 48 }} ItemSeparatorComponent={Separador}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        ListHeaderComponent={(
          <View style={{ gap: 12, marginBottom: 12 }}>
            <View style={{ marginHorizontal: 16 }}>
              <Vidrio radio={22} tinte={`${MARCA.azul}33`}>
                <View style={{ padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                  <View style={{ flex: 1, gap: 4 }}>
                    {tanda ? <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600' }}>Del {dia(tanda.desde)} al {dia(tanda.hasta)}</Text> : null}
                    <Text style={{ color: colorSistema.texto, fontSize: 22, fontWeight: '800' }}>Lo nuevo</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 14, lineHeight: 19 }}>
                      {cargo ? `Para ti, como ${cargo}: ` : ''}{total} novedades que ya puedes usar. Toca una para ver cómo se hace.
                    </Text>
                  </View>
                  <View style={{ alignItems: 'center', gap: 4 }}>
                    <Anillo pct={pct} color={MARCA.azulClaro} texto={`${pct}%`} tamano={64} />
                    <Text style={{ color: colorSistema.texto2, fontSize: 12, fontVariant: ['tabular-nums'] }}>{hechas} de {total}</Text>
                  </View>
                </View>
              </Vidrio>
            </View>
            <FiltrosActivos grupos={grupos} />
          </View>
        )}
        renderItem={({ item }) => <Tarjeta n={item} revisada={revisadas.has(claveDeNovedad(item))} onAbrir={() => ver(item)} />}
        ListEmptyComponent={<Vacio titulo="Sin novedades con ese filtro" detalle="Prueba con Todo o borra la búsqueda." />} />
      {actual ? (
        <HojaDeNovedad n={actual} posicion={`${indice + 1} de ${visibles.length}`} onCerrar={() => setAbierta(null)}
          onAnterior={indice > 0 ? () => ver(visibles[indice - 1]) : null}
          onSiguiente={indice < visibles.length - 1 ? () => ver(visibles[indice + 1]) : null} />
      ) : null}
    </>
  );
}

// ── Quién las vio ───────────────────────────────────────────────────────────

function Avance({ hechas, total }) {
  const pct = total ? Math.round((hechas / total) * 100) : 0;
  const color = hechas === 0 ? MARCA.rojo : hechas >= total ? MARCA.verde : MARCA.ambar;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: 'rgba(127,127,127,0.18)', overflow: 'hidden' }}>
        <View style={{ width: `${pct}%`, height: '100%', borderRadius: 3, backgroundColor: color }} />
      </View>
      <Text style={{ color: colorSistema.texto, fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{hechas} de {total}</Text>
    </View>
  );
}

function HojaDePersona({ f, empleado, sala, onCerrar }) {
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal onRequestClose={onCerrar}>
      <ConAurora>
        <EncabezadoDeHoja titulo={shortEmployeeName(f.name || '')} subtitulo={`${f.cargo} · ${sala}`} onCerrar={onCerrar} />
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 60 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Avatar empleado={empleado ?? { id: f.id, name: f.name }} tamano={48} />
            <View style={{ flex: 1 }}><Avance hechas={f.hechas} total={f.total} /></View>
          </View>
          <Caja>
            {f.lista.map((n, i) => {
              const cuando = f.suyas.get(claveDeNovedad(n));
              return (
                <Renglon key={claveDeNovedad(n)} primero={i === 0} titulo={n.titulo}
                  detalle={cuando ? fechaHora12(cuando) : null}
                  derecha={cuando ? <Pildora texto="Vista" color={MARCA.verde} /> : <Pildora texto="Sin ver" color={MARCA.ambar} />} />
              );
            })}
          </Caja>
        </ScrollView>
      </ConAurora>
    </Modal>
  );
}

function QuienLasVio({ texto }) {
  const branches = useStaffStore((s) => s.branches);
  const empleados = useStaffStore((s) => s.employees);
  const [datos, setDatos] = useState(null);
  const [estado, setEstado] = useState('todos');
  const [cargo, setCargo] = useState('');
  const [abierta, setAbierta] = useState(null);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    try { setDatos(await fetchQuienVioNovedades()); }
    catch (e) { setDatos({ empleados: [], vistas: [], permisos: {}, cargos: [] }); fallo('No se pudo cargar', mensajeDeNovedades(e)); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const filas = useMemo(() => filasDeQuienVio(datos), [datos]);
  const porId = useMemo(() => new Map((empleados || []).map((e) => [String(e.id), e])), [empleados]);
  const sala = (id) => (branches ?? []).find((b) => b.id === id)?.name ?? '—';
  const cuenta = (k) => filas.filter((f) => k === 'todos' || estadoDeAvance(f) === k).length;
  const visibles = filas
    .filter((f) => estado === 'todos' || estadoDeAvance(f) === estado)
    .filter((f) => !cargo || f.cargo === cargo)
    .filter((f) => !texto.trim() || tokenMatch(texto, f.name))
    .sort(ordenDeAvance);
  const cargos = [...new Set(filas.map((f) => f.cargo))].sort();
  const grupos = [
    { id: 'estado', titulo: 'Mostrar', porDefecto: 'todos', activa: estado, onCambiar: setEstado,
      opciones: ESTADOS_QUIEN.map((o) => ({ id: o.value, label: `${o.label} · ${cuenta(o.value)}` })) },
    { id: 'cargo', titulo: 'Cargo', porDefecto: '', activa: cargo, onCambiar: setCargo,
      opciones: [{ id: '', label: 'Todos los cargos' }, ...cargos.map((c) => ({ id: c, label: c }))] },
  ];
  const actual = abierta ? filas.find((f) => f.id === abierta) : null;

  return (
    <>
      <MenuDeFiltros grupos={grupos} />
      <FlatList style={{ flex: 1 }} data={datos ? visibles : []} keyExtractor={(f) => String(f.id)}
        contentContainerStyle={{ paddingVertical: 12, paddingBottom: 48 }} ItemSeparatorComponent={Separador}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag" initialNumToRender={12} windowSize={7}
        refreshControl={<Refrescar refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}
        ListHeaderComponent={<View style={{ marginBottom: 12 }}><FiltrosActivos grupos={grupos} /></View>}
        renderItem={({ item: f }) => (
          <Pressable onPress={() => setAbierta(f.id)} accessibilityRole="button"
            style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
            <Vidrio radio={20} interactivo>
              <View style={{ padding: 14, gap: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Avatar empleado={porId.get(String(f.id)) ?? { id: f.id, name: f.name }} tamano={40} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{shortEmployeeName(f.name || '')}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={1}>{f.cargo} · {sala(f.branch_id)}</Text>
                  </View>
                </View>
                <Avance hechas={f.hechas} total={f.total} />
                <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>Última vez: {f.ultima ? fechaHora12(f.ultima) : 'Nunca'}</Text>
              </View>
            </Vidrio>
          </Pressable>
        )}
        ListEmptyComponent={datos === null
          ? <Vacio titulo="Cargando…" />
          : <Vacio titulo="Nadie con ese filtro" detalle="Prueba con Todos o borra la búsqueda." />} />
      {actual ? <HojaDePersona f={actual} empleado={porId.get(String(actual.id))} sala={sala(actual.branch_id)} onCerrar={() => setAbierta(null)} /> : null}
    </>
  );
}

// ── Android (la prueba de Google Play) ─────────────────────────────────────

function PruebaAndroid({ texto }) {
  const branches = useStaffStore((s) => s.branches);
  const empleados = useStaffStore((s) => s.employees);
  const [filas, setFilas] = useState(null);
  const [ocupado, setOcupado] = useState(null);
  // Los que se copiaron: «Avisarles» marca ESOS, no a quien dejó su correo
  // después de copiar y todavía no está en Google Play.
  const [copiados, setCopiados] = useState(null);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    try { setFilas(await fetchPruebasAndroid()); }
    catch (e) { setFilas([]); fallo('No se pudo cargar', mensajeDeNovedades(e)); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const porId = useMemo(() => new Map((empleados || []).map((e) => [String(e.id), e])), [empleados]);
  const sala = (id) => (branches ?? []).find((b) => b.id === id)?.name ?? '—';
  const visibles = (filas ?? []).filter((f) => !texto.trim() || tokenMatch(texto, f.email, f.empleado?.name));
  const porAgregar = (filas ?? []).filter((f) => !f.agregado_at);
  const aMarcar = copiados ? porAgregar.filter((f) => copiados.has(f.employee_id)) : porAgregar;

  const copiar = async () => {
    await Clipboard.setStringAsync(porAgregar.map((f) => f.email).join(', '));
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setCopiados(new Set(porAgregar.map((f) => f.employee_id)));
    listo('Correos copiados', `${porAgregar.length} listos para pegar en Google Play.`);
  };
  const agregar = async (ids, clave) => {
    setOcupado(clave);
    try {
      const n = await marcarAgregadosEnPlay(ids);
      listo('Listo', n === 1 ? 'Se le avisó que ya puede descargarla.' : `Se les avisó a ${n} que ya pueden descargarla.`);
      setCopiados(null);
      cargar();
    } catch (e) { fallo('No se pudo marcar', mensajeDeNovedades(e)); }
    finally { setOcupado(null); }
  };
  const reenviar = async (f) => {
    setOcupado(f.employee_id);
    try {
      await reenviarAvisoAndroid([f.employee_id]);
      listo('Aviso enviado', `${shortEmployeeName(f.empleado?.name || '')} lo recibe en la campana y en su teléfono.`);
    } catch (e) { fallo('No se pudo avisar', mensajeDeNovedades(e)); }
    finally { setOcupado(null); }
  };

  return (
    <FlatList style={{ flex: 1 }} data={visibles} keyExtractor={(f) => String(f.employee_id)}
      contentContainerStyle={{ paddingVertical: 12, paddingBottom: 48 }} ItemSeparatorComponent={Separador}
      contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
      refreshControl={<Refrescar refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}
      ListHeaderComponent={(
        <View style={{ marginHorizontal: 16, marginBottom: 12, gap: 10 }}>
          <Nota rotulo="1. Copia los correos" texto={porAgregar.length ? `${porAgregar.length} ${porAgregar.length === 1 ? 'persona espera' : 'personas esperan'} acceso.` : 'Nadie espera acceso.'} />
          <BotonGrande texto={`Copiar correos (${porAgregar.length})`} borde deshabilitado={!porAgregar.length} onPress={copiar} />
          <Nota rotulo="2. Pégalos en Google Play" texto="En Play Console abre Portal Farmasalud → Pruebas internas → Testers, pega los correos en la lista y guarda." />
          <BotonGrande texto="Abrir Google Play Console" borde onPress={() => WebBrowser.openBrowserAsync(PLAY_CONSOLE).catch(() => {})} />
          <Nota rotulo="3. Avísales" texto="A cada uno le llega un aviso en la campana y en su teléfono con el botón de descarga y los pasos." />
          <BotonGrande texto={ocupado === 'todos' ? 'Avisando…' : `Agregados, avisarles (${aMarcar.length})`} deshabilitado={!aMarcar.length || !!ocupado}
            onPress={() => agregar(aMarcar.map((f) => f.employee_id), 'todos')} />
        </View>
      )}
      renderItem={({ item: f }) => (
        <View style={{ marginHorizontal: 16 }}>
          <Vidrio radio={20}>
            <View style={{ padding: 14, gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Avatar empleado={porId.get(String(f.employee_id)) ?? { id: f.employee_id, name: f.empleado?.name || '' }} tamano={40} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{f.empleado?.name ? shortEmployeeName(f.empleado.name) : '—'}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={1}>{sala(f.empleado?.branch_id)}</Text>
                </View>
                {f.agregado_at ? <Pildora texto={`Avisado el ${dia(f.agregado_at)}`} color={MARCA.verde} /> : <Pildora texto="Por agregar" color={MARCA.ambar} />}
              </View>
              <Text selectable style={{ color: colorSistema.texto, fontSize: 14 }}>{f.email}</Text>
              <Pressable disabled={!!ocupado} accessibilityRole="button" hitSlop={8}
                onPress={() => (f.agregado_at ? reenviar(f) : agregar([f.employee_id], f.employee_id))}
                style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', opacity: ocupado ? 0.4 : 1 }}>
                <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '700' }}>
                  {ocupado === f.employee_id ? 'Avisando…' : f.agregado_at ? 'Avisar de nuevo' : 'Agregado, avisar'}
                </Text>
              </Pressable>
            </View>
          </Vidrio>
        </View>
      )}
      ListEmptyComponent={filas === null
        ? <Vacio titulo="Cargando…" />
        : <Vacio titulo="Sin correos todavía" detalle="Aquí sale quien deja su correo en Novedades." />} />
  );
}

// ── La pantalla ─────────────────────────────────────────────────────────────

export default function Novedades() {
  const { user, hasPermission } = useAuth();
  const roles = useStaffStore((s) => s.roles);
  const puedeAdministrar = hasPermission('novedades', 'can_edit');
  const miCargo = user?.roleId ?? (Number.isInteger(user?.role) ? user.role : null);
  const ctx = useMemo(() => ({ roleId: miCargo, puede: (m, nivel = 'can_view') => hasPermission(m, nivel) }), [miCargo, hasPermission]);
  const cargo = (roles ?? []).find((r) => r.id === miCargo)?.name ?? null;

  const pestanas = puedeAdministrar
    ? [{ id: 'novedades', label: 'Lo nuevo' }, { id: 'quien', label: 'Quién las vio' }, { id: 'android', label: 'Android' }]
    : [];
  // `/novedades?tab=android` (el aviso del portal) llega con su pestaña.
  const { tab } = useLocalSearchParams();
  const [pestana, setPestana] = useState(pestanas.some((p) => p.id === tab) ? tab : 'novedades');
  const [texto, setTexto] = useState('');
  const activa = pestanas.some((p) => p.id === pestana) ? pestana : 'novedades';

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_FIJA, title: 'Novedades',
        headerSearchBarOptions: {
          placeholder: activa === 'android' ? 'Buscar por nombre o correo' : activa === 'quien' ? 'Buscar por nombre' : 'Buscar una novedad',
          hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      {pestanas.length ? (
        <FijoArriba>
          <Segmentos opciones={pestanas} activa={activa} onCambiar={setPestana} />
        </FijoArriba>
      ) : null}
      {activa === 'quien' ? <QuienLasVio texto={texto} />
        : activa === 'android' ? <PruebaAndroid texto={texto} />
          : <LoNuevo user={user} ctx={ctx} cargo={cargo} texto={texto} />}
    </>
  );
}

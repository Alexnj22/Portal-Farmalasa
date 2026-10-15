// Tres pestañas de Marketing que faltaban en la app, NATIVAS — las del portal:
//
//   · Flujo (`TabTablero`): las piezas del mes agrupadas por estado. En el
//     portal se arrastran; acá se mantiene presionada una y se elige a dónde
//     va, con la MISMA regla (`destinosDeFlujo`): sólo entre los estados del
//     diseñador y, ya aprobada, a programado o publicado. Aprobar y pedir
//     cambios no se hace moviendo: lo hace quien revisa, con su comentario.
//   · Pauta (`TabPauta`): presupuesto del mes, sin asignar, gastado y costo
//     por mensaje, y las piezas que se pautan con lo que trajeron.
//   · Galería en modo gestión (`Galeria gestion`): todas las piezas de los
//     últimos seis meses con el interruptor de liberar para las salas.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Image, Text, View, useWindowDimensions } from 'react-native';
import * as Haptics from 'expo-haptics';
import { fetchGaleria, firmarDisenos, liberarPieza, moverPieza } from '@nucleo/data/marketing';
import {
  ESTADOS_PIEZA, esDeGaleria, puedeMoverA, esDeMarca, estadoDe, formatoDe, mediosDe, objetivoDe, tipoDeArchivo, totalesDePauta,
} from '@nucleo/utils/marketing';
import { correrMes, fechaTexto, mesSV } from '@nucleo/utils/fecha';
import { formatMoney, formatQty } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { colorSistema } from '../Formulario';
import { Aviso } from '../formulario/Piezas';
import { Pildora } from '../avisos/Piezas';
import Kpi, { FilaDeKpis } from '../inicio/Kpi';
import Vidrio from '../Vidrio';
import Tocable from '../Tocable';
import Interruptor from '../Interruptor';
import { MARCA } from '../inicio/marca';
import { colorDeVariante } from '../colorDeVariante';
import { fallo } from '../Progreso';

/** A qué estados se puede mover una pieza desde el flujo (`puedeMoverA`, núcleo, la regla del portal). */
const destinosDeFlujo = (pieza) => ESTADOS_PIEZA.map((e) => e.value).filter((d) => puedeMoverA(pieza, d));

function FilaDePieza({ p, onAbrir, onMantener, derecha }) {
  const est = estadoDe(p.estado);
  return (
    <Tocable onPress={() => onAbrir(p)} onLongPress={onMantener ? () => onMantener(p) : undefined} delayLongPress={300} style={{ marginHorizontal: 16 }}>
      <Vidrio radio={16} interactivo>
        <View style={{ padding: 12, gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '600' }} numberOfLines={2}>{p.titulo || formatoDe(p.formato).label}</Text>
            {derecha ?? <Pildora texto={est.label} color={colorDeVariante(est.variant)} />}
          </View>
          <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{[fechaTexto(p.fecha, { weekday: 'short', day: 'numeric', month: 'short' }), formatoDe(p.formato).label, p.pautar ? 'con pauta' : null].filter(Boolean).join(' · ')}</Text>
        </View>
      </Vidrio>
    </Tocable>
  );
}

export function Flujo({ piezas, puedeMoverla, onAbrir, onMovida }) {
  const porEstado = useMemo(() => {
    const m = Object.fromEntries(ESTADOS_PIEZA.map((e) => [e.value, []]));
    for (const p of piezas || []) (m[p.estado] ||= []).push(p);
    return m;
  }, [piezas]);
  const mover = (p) => {
    if (!puedeMoverla(p)) return;
    const destinos = destinosDeFlujo(p);
    if (!destinos.length) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const opciones = [...destinos.map((d) => estadoDe(d).label), 'Cancelar'];
    ActionSheetIOS.showActionSheetWithOptions({ title: `Mover «${p.titulo}» a`, options: opciones, cancelButtonIndex: opciones.length - 1 }, async (i) => {
      if (i >= destinos.length) return;
      const destino = destinos[i];
      try {
        await moverPieza(p.id, destino === 'publicado' ? { estado: destino, publicado_en: new Date().toISOString() } : { estado: destino });
        onMovida?.();
      } catch (e) { fallo('No se pudo mover la pieza', mensajeAmigable(e, 'Intenta de nuevo.')); }
    });
  };
  return (
    <>
      {ESTADOS_PIEZA.map((e) => {
        const lista = porEstado[e.value] || [];
        return (
          <View key={e.value} style={{ gap: 8 }}>
            <View style={{ marginHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <Pildora texto={e.label} color={colorDeVariante(e.variant)} />
              <Text style={{ color: colorSistema.texto2, fontSize: 13, fontVariant: ['tabular-nums'] }}>{lista.length}</Text>
            </View>
            {lista.map((p) => <FilaDePieza key={p.id} p={p} onAbrir={onAbrir} onMantener={mover} derecha={<View />} />)}
            {!lista.length ? <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>Sin piezas</Text> : null}
          </View>
        );
      })}
      <Text style={{ color: colorSistema.texto2, fontSize: 12, textAlign: 'center', marginHorizontal: 20 }}>Mantén presionada una pieza para moverla de estado (sólo quien la creó).</Text>
    </>
  );
}

export function Pauta({ piezas, presupuestoMes, redes, onAbrir }) {
  const filas = useMemo(() => (piezas || []).filter((p) => p.pautar || p.pauta), [piezas]);
  const t = useMemo(() => totalesDePauta((piezas || []).map((p) => p.pauta).filter(Boolean), presupuestoMes), [piezas, presupuestoMes]);
  const nombreRed = (c) => (redes || []).find((r) => r.clave === c)?.nombre || c;
  return (
    <>
      <FilaDeKpis>
        <Kpi icono="DollarSign" rotulo="Presupuesto del mes" valor={formatMoney(t.presupuestoMes)} color={MARCA.azul} apoyo={`${formatMoney(t.presupuesto)} asignado`} />
        <Kpi icono="Boxes" rotulo="Sin asignar" valor={formatMoney(t.disponible)} color={t.disponible < 0 ? MARCA.rojo : MARCA.azulClaro} pide={t.disponible < 0}
          apoyo={t.disponible < 0 ? 'Se pasó del presupuesto' : 'Por repartir'} />
      </FilaDeKpis>
      <FilaDeKpis>
        <Kpi icono="CheckCircle2" rotulo="Gastado" valor={formatMoney(t.gastado)} color={MARCA.verde} apoyo={`${t.conResultado} pieza(s) con resultado`} />
        <Kpi icono="MessageSquare" rotulo="Costo por mensaje" valor={t.costoPorMensaje != null ? formatMoney(t.costoPorMensaje) : '—'} color={MARCA.violetaClaro}
          apoyo={t.costoPorClic != null ? `${formatMoney(t.costoPorClic)} por clic` : 'Sin resultados'} />
      </FilaDeKpis>
      {filas.map((p) => {
        const pa = p.pauta;
        const resultado = pa && [pa.mensajes != null && `${formatQty(pa.mensajes)} mensajes`, pa.clics != null && `${formatQty(pa.clics)} clics`, pa.alcance != null && `${formatQty(pa.alcance)} alcance`].filter(Boolean).join(' · ');
        return (
          <Tocable key={p.id} onPress={() => onAbrir(p)} style={{ marginHorizontal: 16 }}>
            <Vidrio radio={16} interactivo>
              <View style={{ padding: 12, gap: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '600' }} numberOfLines={2}>{p.titulo}</Text>
                  {pa ? <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(pa.presupuesto)}</Text>
                    : <Pildora texto="Sin plan" color={MARCA.ambar} />}
                </View>
                <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>
                  {[fechaTexto(p.fecha, { day: 'numeric', month: 'short' }), pa?.objetivo ? objetivoDe(pa.objetivo).label : null, (pa?.redes || []).map(nombreRed).join(', ') || null].filter(Boolean).join(' · ')}
                </Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`Gastado ${pa?.gastado != null ? formatMoney(pa.gastado) : '—'}${resultado ? ` · ${resultado}` : ''}`}</Text>
              </View>
            </Vidrio>
          </Tocable>
        );
      })}
      {!filas.length ? <View style={{ marginHorizontal: 16 }}><Aviso texto="Sin piezas para pautar este mes. Marca «Se pautará» en una pieza para planificar su inversión." /></View> : null}
    </>
  );
}

export function GaleriaGestion({ marca, formato, liberada, busqueda, puedeLiberar, onAbrir, recarga }) {
  const { width } = useWindowDimensions();
  const [piezas, setPiezas] = useState(null);
  const [firmadas, setFirmadas] = useState(new Map());
  const [error, setError] = useState(null);
  const cargar = useCallback(async () => {
    try {
      const ps = await fetchGaleria({ desde: `${correrMes(mesSV(), -6)}-01` });
      setPiezas(ps); setFirmadas(await firmarDisenos(ps)); setError(null);
    } catch (e) { setError(mensajeAmigable(e, 'No se pudo cargar la galería.')); setPiezas([]); }
  }, []);
  useEffect(() => { cargar(); }, [cargar, recarga]);
  const visibles = useMemo(() => (piezas || [])
    .filter((p) => !marca || esDeMarca(p, marca))
    .filter((p) => !formato || p.formato === formato)
    .filter((p) => !liberada || (liberada === 'si' ? p.liberada : !p.liberada))
    .filter((p) => !busqueda || `${p.titulo} ${p.copy || ''} ${p.hashtags || ''}`.toLowerCase().includes(busqueda.toLowerCase())),
  [piezas, marca, formato, liberada, busqueda]);
  const alternar = async (p, on) => {
    setPiezas((g) => g.map((x) => (x.id === p.id ? { ...x, liberada: on } : x)));
    try { await liberarPieza(p.id, on); }
    catch (e) { setPiezas((g) => g.map((x) => (x.id === p.id ? { ...x, liberada: !on } : x))); fallo('No se pudo cambiar', mensajeAmigable(e, 'Intenta de nuevo.')); }
  };
  const lado = (width - 16 * 2 - 10) / 2;
  if (piezas == null) return <ActivityIndicator style={{ marginTop: 24 }} />;
  return (
    <>
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      <View style={{ marginHorizontal: 16 }}><Aviso texto="Las piezas aprobadas que se liberan las ven las salas en su Galería, para publicarlas en WhatsApp." /></View>
      <View style={{ marginHorizontal: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {visibles.slice(0, 120).map((p) => {
          const portada = mediosDe(p).find((a) => tipoDeArchivo(a) === 'imagen' && firmadas.get(a.url));
          const aprobada = esDeGaleria({ ...p, liberada: true });
          return (
            <View key={p.id} style={{ width: lado, gap: 4 }}>
              <Tocable onPress={() => onAbrir(p)}>
                {portada ? <Image source={{ uri: firmadas.get(portada.url) }} style={{ width: lado, height: lado, borderRadius: 14 }} />
                  : <View style={{ width: lado, height: lado, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{formatoDe(p.formato).label}</Text></View>}
              </Tocable>
              <Text style={{ color: colorSistema.texto, fontSize: 13, fontWeight: '600' }} numberOfLines={2}>{p.titulo}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 11 }}>{`${formatoDe(p.formato).label} · ${fechaTexto(p.fecha, { day: 'numeric', month: 'short' })}`}</Text>
              {puedeLiberar && aprobada ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ flex: 1, color: p.liberada ? MARCA.verde : colorSistema.texto2, fontSize: 12, fontWeight: '600' }}>{p.liberada ? 'Liberada' : 'Sin liberar'}</Text>
                  <Interruptor value={!!p.liberada} onValueChange={(on) => alternar(p, on)} />
                </View>
              ) : !aprobada ? <Text style={{ color: colorSistema.texto2, fontSize: 11 }}>Se libera al aprobarse</Text> : null}
            </View>
          );
        })}
      </View>
      {!visibles.length && !error ? <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 24 }}>Sin piezas con ese filtro</Text> : null}
    </>
  );
}

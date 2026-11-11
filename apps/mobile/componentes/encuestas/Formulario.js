// El cuestionario de una encuesta a clientes, NATIVO — la versión de la app de
// `FormularioEncuesta` en modo entrevista: una sección por pantalla, las
// preguntas condicionadas aparecen o desaparecen según lo contestado, y al
// final el paso opcional de los datos del cliente con su consentimiento.
//
// El recorrido, lo obligatorio y la regla del contacto salen del núcleo
// (`encuestasClientes`): lo mismo que recorre el cliente en el QR o la tablet.
// No sabe guardar: `onEnviar(respuestas, contacto, segundos)` lo hace quien lo
// monta; si lanza, el error se muestra y nada se pierde.
import { useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Interruptor from '../Interruptor';
import * as Haptics from 'expo-haptics';
import { ACUERDO, CARITAS, MAX_NUMERO, MAX_TEXTO, motivoParaNoGuardarContacto, opcionesConTexto, primeraSinContestar, recorrido, maximoDe, alternarOpcion, textoDeMaximo, exclusivasDe, TRAMOS_NPS, tramoNps, guionDeEscala, escalaNumerica } from '@nucleo/utils/encuestasClientes';
import { nuevaReferencia } from '@nucleo/data/encuestasClientes';
import { colorSistema } from '../Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../formulario/Piezas';
import { MARCA } from '../inicio/marca';

// El color de cada tramo del NPS (TRAMOS_NPS dice el nombre; acá, el color).
const COLOR_TRAMO = { danger: MARCA.rojo, warning: MARCA.ambar, success: MARCA.verde };

function Opcion({ activa, onPress, children, ancho, color = MARCA.azul, etiqueta }) {
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }}
      accessibilityRole="button" accessibilityState={{ selected: !!activa }} accessibilityLabel={etiqueta}
      style={({ pressed }) => ({
        minHeight: 44, minWidth: ancho ?? 44, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, justifyContent: 'center', alignItems: 'center',
        backgroundColor: activa ? color : 'rgba(255,255,255,0.08)', borderWidth: 0.5, borderColor: activa ? color : colorSistema.separador,
        transform: [{ scale: pressed ? 0.97 : 1 }],
      })}>
      {typeof children === 'string' ? <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>{children}</Text> : children}
    </Pressable>
  );
}

function Respuesta({ p, valor, onChange }) {
  const fila = { flexDirection: 'row', flexWrap: 'wrap', gap: 8 };
  switch (p.tipo) {
    case 'nps': {
      // Mismo criterio que el portal: cada tramo con su color y lo marcado en
      // palabras, porque la fila del 0 al 10 se parte en dos en el teléfono.
      const marcado = tramoNps(valor);
      return (
        <View style={{ gap: 8 }}>
          {/* Dos filas fijas, 0–6 y 7–10: cada fila es un tramo. */}
          {[[0, 6], [7, 10]].map(([a, z]) => (
            <View key={a} style={{ flexDirection: 'row', gap: 6 }}>{Array.from({ length: z - a + 1 }, (_, k) => {
              const n = a + k;
              const t = tramoNps(n);
              return <View key={n} style={{ flex: 1, maxWidth: 52 }}><Opcion activa={valor === n} color={COLOR_TRAMO[t.tono]} etiqueta={`${n} · ${t.label}`} ancho={0} onPress={() => onChange(n)}>{String(n)}</Opcion></View>;
            })}</View>
          ))}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 4 }}>
            {TRAMOS_NPS.map((t) => (
              <View key={t.tono} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: COLOR_TRAMO[t.tono] }} />
                <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`${t.desde}–${t.hasta} ${t.label.toLowerCase()}`}</Text>
              </View>
            ))}
          </View>
          {marcado ? <Text style={{ color: COLOR_TRAMO[marcado.tono], fontSize: 14, fontWeight: '600' }}>{`Marcó ${valor}: ${marcado.label.toLowerCase()} que recomiende la farmacia.`}</Text> : null}
        </View>
      );
    }
    case 'csat': {
      // Con su rótulo: sin él 🙁, 😐 y 🙂 se parecen demasiado.
      const marcada = CARITAS.find((c) => c.valor === valor);
      return (
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', gap: 6 }}>{CARITAS.map((c) => (
            <View key={c.valor} style={{ flex: 1 }}>
              <Opcion activa={valor === c.valor} onPress={() => onChange(c.valor)} ancho={0} etiqueta={c.label}>
                <Text style={{ fontSize: 26 }}>{c.emoji}</Text>
                <Text style={{ color: '#fff', fontSize: 10, fontWeight: '600', textAlign: 'center', marginTop: 2 }} numberOfLines={2}>{c.label}</Text>
              </Opcion>
            </View>
          ))}</View>
          {marcada ? <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '600' }}>{`Marcó: ${marcada.label.toLowerCase()}.`}</Text> : null}
        </View>
      );
    }
    case 'likert':
      return <View style={{ gap: 6 }}>{ACUERDO.map((l, i) => <Opcion key={l} activa={valor === i + 1} onPress={() => onChange(i + 1)}>{`${i + 1} · ${l}`}</Opcion>)}</View>;
    case 'si_no':
      return <View style={fila}>{[[true, 'Sí'], [false, 'No']].map(([v, l]) => <Opcion key={l} activa={valor === v} onPress={() => onChange(v)} ancho={100}>{l}</Opcion>)}</View>;
    case 'unica': {
      const e = escalaNumerica(p);
      if (e) {
        const marcada = e.opciones.find((o) => o.id === valor);
        const mitad = e.opciones.length > 6 ? Math.ceil(e.opciones.length / 2) : e.opciones.length;
        const filas = [e.opciones.slice(0, mitad), e.opciones.slice(mitad)].filter((f) => f.length);
        return (
          <View style={{ gap: 6 }}>
            {filas.map((f, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: 6 }}>{f.map((o) => (
                <View key={o.id} style={{ flex: 1, maxWidth: 64 }}><Opcion activa={valor === o.id} ancho={0} onPress={() => onChange(o.id)}>{String(o.n)}</Opcion></View>
              ))}</View>
            ))}
            {e.etiquetaMin || e.etiquetaMax ? (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`${e.min} = ${e.etiquetaMin || '—'}`}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 12, textAlign: 'right' }}>{`${e.max} = ${e.etiquetaMax || '—'}`}</Text>
              </View>
            ) : null}
            {marcada ? <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '600' }}>{`Marcó ${marcada.n} de ${e.max}.`}</Text> : null}
          </View>
        );
      }
      return <View style={{ gap: 6 }}>{opcionesConTexto(p).map((o) => <Opcion key={o.id} activa={valor === o.id} onPress={() => onChange(o.id)}>{o.texto}</Opcion>)}</View>;
    }
    case 'multiple': {
      const m = Array.isArray(valor) ? valor : [];
      const maximo = maximoDe(p);
      const exclusivas = exclusivasDe(p);
      return <View style={{ gap: 6 }}>
        {maximo ? <Text style={{ fontSize: 13, color: colorSistema.texto2 }}>{textoDeMaximo(maximo)}</Text> : null}
        {opcionesConTexto(p).map((o) => {
          const on = m.includes(o.id);
          return <Opcion key={o.id} activa={on} onPress={() => onChange(alternarOpcion(m, o.id, maximo, exclusivas))}>{`${on ? '✓ ' : ''}${o.texto}`}</Opcion>;
        })}</View>;
    }
    case 'ranking': {
      const ops = opcionesConTexto(p);
      const orden = Array.isArray(valor) && valor.length === ops.length ? valor : ops.map((o) => o.id);
      const mover = (i, d) => { const j = i + d; if (j < 0 || j >= orden.length) return; const n = [...orden]; [n[i], n[j]] = [n[j], n[i]]; onChange(n); };
      return (
        <View style={{ gap: 6 }}>
          <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>Use las flechas para cambiar el orden. Si ya está como lo dijo, siga.</Text>
          {orden.map((id, i) => (
            <View key={id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>{`${i + 1}. ${ops.find((o) => o.id === id)?.texto ?? ''}`}</Text>
              <Pressable disabled={i === 0} onPress={() => mover(i, -1)} hitSlop={6} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', opacity: i === 0 ? 0.3 : 1 }}><Text style={{ color: MARCA.azulClaro, fontSize: 20 }}>↑</Text></Pressable>
              <Pressable disabled={i === orden.length - 1} onPress={() => mover(i, 1)} hitSlop={6} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', opacity: i === orden.length - 1 ? 0.3 : 1 }}><Text style={{ color: MARCA.azulClaro, fontSize: 20 }}>↓</Text></Pressable>
            </View>
          ))}
        </View>
      );
    }
    case 'numero':
      return <Campo multiline={false} keyboardType="number-pad" value={valor == null ? '' : String(valor)} onChangeText={(t) => { const d = t.replace(/\D/g, ''); if (d === '') onChange(''); else if (Number(d) <= MAX_NUMERO) onChange(Number(d)); }} placeholder="Escriba la cantidad" />;
    default:
      return <Campo value={valor || ''} maxLength={MAX_TEXTO} onChangeText={(t) => onChange(t.slice(0, MAX_TEXTO))} placeholder="Lo que respondió, con sus palabras" />;
  }
}

export default function Formulario({ encuesta, onEnviar, onEntregarMuestra, onReiniciar }) {
  const secciones = useMemo(() => (encuesta?.cuestionario?.secciones || []).filter((s) => (s.preguntas || []).length), [encuesta?.cuestionario]);
  const [paso, setPaso] = useState(0);
  const [respuestas, setRespuestas] = useState({});
  const [faltante, setFaltante] = useState(null);
  const [enContacto, setEnContacto] = useState(false);
  const [contacto, setContacto] = useState({ consiente: false, telefono: '', nombre: '' });
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(undefined);
  // Desde la primera respuesta; y una referencia por respuesta para que un
  // reintento tras un corte de red no la guarde dos veces.
  const inicio = useRef(null);
  const referencia = useRef(nuevaReferencia());

  const { visibles, limpias } = useMemo(() => recorrido(encuesta?.cuestionario, respuestas), [encuesta?.cuestionario, respuestas]);
  const de = (s) => visibles.filter((p) => p.seccionId === s.id);
  // En el teléfono, UNA pregunta por pantalla (como el portal en teléfono):
  // cada paso lleva su sección para mostrar el título arriba.
  const pasos = secciones.flatMap((s) => de(s).map((p) => ({ seccion: s, preguntas: [p] })));
  const actual = pasos[paso] || null;
  const terminado = resultado !== undefined;
  const progreso = terminado ? 100 : Math.round(((enContacto ? pasos.length : paso) / (pasos.length + 1)) * 100);
  const incentivo = encuesta?.incentivo_tipo === 'puntos' && encuesta?.incentivo_puntos ? `Si deja su teléfono, recibe ${encuesta.incentivo_puntos} puntos.`
    : encuesta?.incentivo_tipo === 'muestra' ? `Si deja su teléfono, entrégale: ${encuesta.incentivo_descripcion || 'la muestra médica'}.` : null;

  const reiniciar = () => {
    setPaso(0); setRespuestas({}); setFaltante(null); setEnContacto(false); setContacto({ consiente: false, telefono: '', nombre: '' });
    setError(null); setResultado(undefined); inicio.current = null; referencia.current = nuevaReferencia();
    onReiniciar?.();
  };
  const siguiente = () => {
    // Un «ordenar» que no se tocó ya muestra un orden completo: ese orden es la respuesta.
    let conOrden = respuestas;
    if (actual) {
      for (const p of actual.preguntas) {
        if (p.tipo !== 'ranking') continue;
        const ops = opcionesConTexto(p);
        const r = conOrden[p.id];
        if (!(Array.isArray(r) && r.length === ops.length)) conOrden = { ...conOrden, [p.id]: ops.map((o) => o.id) };
      }
      if (conOrden !== respuestas) setRespuestas(conOrden);
    }
    if (actual) { const f = primeraSinContestar(actual.preguntas, conOrden); if (f) { setFaltante(f.id); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}); return; } }
    setFaltante(null);
    if (paso + 1 >= pasos.length) setEnContacto(true); else setPaso(paso + 1);
  };
  const enviar = async (conDatos) => {
    if (conDatos) { const m = motivoParaNoGuardarContacto(contacto); if (m) { setError(m); return; } }
    setError(null); setEnviando(true);
    try {
      const r = await onEnviar(limpias, conDatos ? { consiente: true, telefono: contacto.telefono.trim(), nombre: contacto.nombre.trim() } : null, Math.round((Date.now() - (inicio.current ?? Date.now())) / 1000), referencia.current);
      setResultado(r || null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e) { setError(e?.message || 'No se pudo enviar. Intenta de nuevo.'); }
    setEnviando(false);
  };

  if (!secciones.length) return <View style={{ marginHorizontal: 16 }}><Aviso texto="Todavía no hay preguntas para mostrar." /></View>;
  const inc = resultado?.incentivo;
  return (
    <View style={{ gap: 12 }}>
      <View style={{ marginHorizontal: 20, height: 6, borderRadius: 3, backgroundColor: colorSistema.separador, overflow: 'hidden' }}>
        <View style={{ width: `${progreso}%`, height: 6, backgroundColor: MARCA.azul }} />
      </View>
      {!terminado ? <Text style={{ marginHorizontal: 20, marginTop: -6, color: colorSistema.texto2, fontSize: 12, textAlign: 'right' }}>{enContacto ? 'Último paso' : `Pregunta ${paso + 1} de ${pasos.length}`}</Text> : null}
      {terminado ? (
        <Seccion>
          <Text style={{ color: MARCA.verde, fontSize: 20, fontWeight: '800', textAlign: 'center' }}>Respuesta guardada</Text>
          {inc?.tipo === 'puntos' && inc.estado === 'acreditado' ? <Aviso texto={`Se acreditaron ${inc.puntos} puntos en la cuenta del cliente.`} /> : null}
          {inc?.tipo === 'puntos' && inc.estado === 'pendiente' ? <Aviso tono="cuidado" texto={`Los ${inc.puntos} puntos quedaron pendientes: el teléfono no corresponde a una sola ficha.`} /> : null}
          {inc?.tipo === 'muestra' && inc.estado !== 'entregado' ? (
            <>
              <Aviso tono="cuidado" texto={`Entrégale al cliente: ${inc.descripcion || 'la muestra médica'}.`} />
              {onEntregarMuestra && resultado?.id ? <BotonGrande texto="Ya la entregué" color={MARCA.verde} onPress={async () => {
                try { await onEntregarMuestra(resultado.id); setResultado((x) => ({ ...x, incentivo: { ...x.incentivo, estado: 'entregado' } })); } catch (e) { setError(e?.message || 'No se pudo marcar la entrega.'); }
              }} /> : null}
            </>
          ) : null}
          {inc?.tipo === 'muestra' && inc.estado === 'entregado' ? <Aviso texto="Muestra entregada." /> : null}
          {error ? <Aviso tono="freno" texto={error} /> : null}
          <BotonGrande texto="Otra entrevista" borde color={MARCA.azulClaro} onPress={reiniciar} />
        </Seccion>
      ) : enContacto ? (
        <Seccion titulo="¿El cliente quiere dejar sus datos?">
          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Es opcional. Sin datos, la respuesta queda anónima.</Text>
          {incentivo ? <Aviso texto={incentivo} /> : null}
          <Campo multiline={false} keyboardType="phone-pad" value={contacto.telefono} onChangeText={(t) => setContacto((c) => ({ ...c, telefono: t }))} placeholder="Teléfono (7777-7777)" />
          <Campo multiline={false} value={contacto.nombre} onChangeText={(t) => setContacto((c) => ({ ...c, nombre: t }))} placeholder="Nombre (opcional)" />
          <Pressable accessibilityRole="switch" accessibilityState={{ checked: contacto.consiente }}
            onPress={() => { Haptics.selectionAsync().catch(() => {}); setContacto((c) => ({ ...c, consiente: !c.consiente })); setError(null); }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}>
            <Interruptor value={contacto.consiente} onValueChange={(v) => setContacto((c) => ({ ...c, consiente: v }))} />
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14 }}>{`Consentimiento del cliente${encuesta.texto_consentimiento ? `: ${encuesta.texto_consentimiento}` : ''}`}</Text>
          </Pressable>
          {error ? <Aviso tono="freno" texto={error} /> : null}
          <BotonGrande texto={enviando ? 'Enviando…' : 'Enviar'} color={MARCA.azul} deshabilitado={enviando} onPress={() => enviar(true)} />
          <BotonGrande texto="Enviar sin datos" borde color={MARCA.azulClaro} deshabilitado={enviando} onPress={() => enviar(false)} />
          <BotonGrande texto="Atrás" borde color={colorSistema.texto2} deshabilitado={enviando} onPress={() => setEnContacto(false)} />
        </Seccion>
      ) : actual ? (
        <>
          {actual.seccion.titulo || actual.seccion.descripcion ? (
            <View style={{ marginHorizontal: 20, gap: 2 }}>
              {actual.seccion.titulo ? <Text style={{ color: colorSistema.texto, fontSize: 18, fontWeight: '700' }}>{actual.seccion.titulo}</Text> : null}
              {actual.seccion.descripcion ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{actual.seccion.descripcion}</Text> : null}
            </View>
          ) : null}
          {actual.preguntas.map((p) => (
            <Seccion key={p.id}>
              <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '600' }}>
                {`${p.numero}. ${p.texto || 'Pregunta sin texto'}`}{p.obligatoria ? <Text style={{ color: MARCA.rojo }}> *</Text> : null}
              </Text>
              {guionDeEscala(p) ? <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '600' }}>{guionDeEscala(p)}</Text> : null}
              {p.ayuda ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{p.ayuda}</Text> : null}
              <Respuesta p={p} valor={respuestas[p.id]} onChange={(v) => { if (inicio.current == null) inicio.current = Date.now(); setRespuestas((r) => ({ ...r, [p.id]: v })); if (faltante === p.id) setFaltante(null); }} />
              {faltante === p.id ? <Text style={{ color: MARCA.rojo, fontSize: 12, fontWeight: '600' }}>Esta pregunta es obligatoria.</Text> : null}
            </Seccion>
          ))}
          <View style={{ marginHorizontal: 16, flexDirection: 'row', gap: 10 }}>
            {paso > 0 ? <View style={{ flex: 1 }}><BotonGrande texto="Atrás" borde color={colorSistema.texto2} onPress={() => setPaso(paso - 1)} /></View> : null}
            <View style={{ flex: 1 }}><BotonGrande texto="Siguiente" color={MARCA.azul} onPress={siguiente} /></View>
          </View>
        </>
      ) : null}
    </View>
  );
}

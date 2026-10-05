// El cuestionario de una encuesta a clientes, NATIVO — la versión de la app de
// `FormularioEncuesta` en modo entrevista: una sección por pantalla, las
// preguntas condicionadas aparecen o desaparecen según lo contestado, y al
// final el paso opcional de los datos del cliente con su consentimiento.
//
// El recorrido, lo obligatorio y la regla del contacto salen del núcleo
// (`encuestasClientes`): lo mismo que recorre el cliente en el QR o la tablet.
// No sabe guardar: `onEnviar(respuestas, contacto, segundos)` lo hace quien lo
// monta; si lanza, el error se muestra y nada se pierde.
import { useMemo, useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { ACUERDO, CARITAS, motivoParaNoGuardarContacto, primeraSinContestar, recorrido } from '@nucleo/utils/encuestasClientes';
import { colorSistema } from '../Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../formulario/Piezas';
import { MARCA } from '../inicio/marca';

function Opcion({ activa, onPress, children, ancho }) {
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }}
      style={({ pressed }) => ({
        minHeight: 44, minWidth: ancho ?? 44, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, justifyContent: 'center', alignItems: 'center',
        backgroundColor: activa ? MARCA.azul : 'rgba(255,255,255,0.08)', borderWidth: 0.5, borderColor: activa ? MARCA.azul : colorSistema.separador,
        transform: [{ scale: pressed ? 0.97 : 1 }],
      })}>
      {typeof children === 'string' ? <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>{children}</Text> : children}
    </Pressable>
  );
}

function Respuesta({ p, valor, onChange }) {
  const fila = { flexDirection: 'row', flexWrap: 'wrap', gap: 8 };
  switch (p.tipo) {
    case 'nps':
      return (
        <View style={{ gap: 4 }}>
          <View style={fila}>{Array.from({ length: 11 }, (_, n) => <Opcion key={n} activa={valor === n} onPress={() => onChange(n)}>{String(n)}</Opcion>)}</View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: colorSistema.texto2, fontSize: 11 }}>Nada probable</Text><Text style={{ color: colorSistema.texto2, fontSize: 11 }}>Muy probable</Text>
          </View>
        </View>
      );
    case 'csat':
      return <View style={fila}>{CARITAS.map((c) => <Opcion key={c.valor} activa={valor === c.valor} onPress={() => onChange(c.valor)} ancho={56}><Text style={{ fontSize: 26 }} accessibilityLabel={c.label}>{c.emoji}</Text></Opcion>)}</View>;
    case 'likert':
      return <View style={{ gap: 6 }}>{ACUERDO.map((l, i) => <Opcion key={l} activa={valor === i + 1} onPress={() => onChange(i + 1)}>{`${i + 1} · ${l}`}</Opcion>)}</View>;
    case 'si_no':
      return <View style={fila}>{[[true, 'Sí'], [false, 'No']].map(([v, l]) => <Opcion key={l} activa={valor === v} onPress={() => onChange(v)} ancho={100}>{l}</Opcion>)}</View>;
    case 'unica':
      return <View style={{ gap: 6 }}>{(p.opciones || []).filter((o) => o.texto).map((o) => <Opcion key={o.id} activa={valor === o.id} onPress={() => onChange(o.id)}>{o.texto}</Opcion>)}</View>;
    case 'multiple': {
      const m = Array.isArray(valor) ? valor : [];
      return <View style={{ gap: 6 }}>{(p.opciones || []).filter((o) => o.texto).map((o) => {
        const on = m.includes(o.id);
        return <Opcion key={o.id} activa={on} onPress={() => onChange(on ? m.filter((x) => x !== o.id) : [...m, o.id])}>{`${on ? '✓ ' : ''}${o.texto}`}</Opcion>;
      })}</View>;
    }
    case 'ranking': {
      const ops = (p.opciones || []).filter((o) => o.texto);
      const orden = Array.isArray(valor) && valor.length === ops.length ? valor : ops.map((o) => o.id);
      const mover = (i, d) => { const j = i + d; if (j < 0 || j >= orden.length) return; const n = [...orden]; [n[i], n[j]] = [n[j], n[i]]; onChange(n); };
      return (
        <View style={{ gap: 6 }}>
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
      return <Campo multiline={false} keyboardType="number-pad" value={valor == null ? '' : String(valor)} onChangeText={(t) => onChange(t === '' ? '' : Number(t.replace(/\D/g, '')))} placeholder="0" />;
    default:
      return <Campo value={valor || ''} onChangeText={onChange} placeholder="Lo que respondió, con sus palabras" />;
  }
}

export default function Formulario({ encuesta, onEnviar, onEntregarMuestra }) {
  const secciones = useMemo(() => (encuesta?.cuestionario?.secciones || []).filter((s) => (s.preguntas || []).length), [encuesta?.cuestionario]);
  const [paso, setPaso] = useState(0);
  const [respuestas, setRespuestas] = useState({});
  const [faltante, setFaltante] = useState(null);
  const [enContacto, setEnContacto] = useState(false);
  const [contacto, setContacto] = useState({ consiente: false, telefono: '', nombre: '' });
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(undefined);
  const [inicio, setInicio] = useState(() => Date.now());

  const { visibles, limpias } = useMemo(() => recorrido(encuesta?.cuestionario, respuestas), [encuesta?.cuestionario, respuestas]);
  const de = (s) => visibles.filter((p) => p.seccionId === s.id);
  const pasos = secciones.filter((s) => de(s).length > 0);
  const actual = pasos[paso] || null;
  const terminado = resultado !== undefined;
  const progreso = terminado ? 100 : Math.round(((enContacto ? pasos.length : paso) / (pasos.length + 1)) * 100);
  const incentivo = encuesta?.incentivo_tipo === 'puntos' && encuesta?.incentivo_puntos ? `Si deja su teléfono, recibe ${encuesta.incentivo_puntos} puntos.`
    : encuesta?.incentivo_tipo === 'muestra' ? `Si deja su teléfono, entrégale: ${encuesta.incentivo_descripcion || 'la muestra médica'}.` : null;

  const reiniciar = () => {
    setPaso(0); setRespuestas({}); setFaltante(null); setEnContacto(false); setContacto({ consiente: false, telefono: '', nombre: '' });
    setError(null); setResultado(undefined); setInicio(Date.now());
  };
  const siguiente = () => {
    if (actual) { const f = primeraSinContestar(de(actual), respuestas); if (f) { setFaltante(f.id); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}); return; } }
    setFaltante(null);
    if (paso + 1 >= pasos.length) setEnContacto(true); else setPaso(paso + 1);
  };
  const enviar = async (conDatos) => {
    if (conDatos) { const m = motivoParaNoGuardarContacto(contacto); if (m) { setError(m); return; } }
    setError(null); setEnviando(true);
    try {
      const r = await onEnviar(limpias, conDatos ? { consiente: true, telefono: contacto.telefono.trim(), nombre: contacto.nombre.trim() } : null, Math.round((Date.now() - inicio) / 1000));
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
            <Switch value={contacto.consiente} onValueChange={(v) => setContacto((c) => ({ ...c, consiente: v }))} />
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14 }}>{`Consentimiento del cliente${encuesta.texto_consentimiento ? `: ${encuesta.texto_consentimiento}` : ''}`}</Text>
          </Pressable>
          {error ? <Aviso tono="freno" texto={error} /> : null}
          <BotonGrande texto={enviando ? 'Enviando…' : 'Enviar'} color={MARCA.azul} deshabilitado={enviando} onPress={() => enviar(true)} />
          <BotonGrande texto="Enviar sin datos" borde color={MARCA.azulClaro} deshabilitado={enviando} onPress={() => enviar(false)} />
          <BotonGrande texto="Atrás" borde color={colorSistema.texto2} deshabilitado={enviando} onPress={() => setEnContacto(false)} />
        </Seccion>
      ) : actual ? (
        <>
          {actual.titulo || actual.descripcion ? (
            <View style={{ marginHorizontal: 20, gap: 2 }}>
              {actual.titulo ? <Text style={{ color: colorSistema.texto, fontSize: 18, fontWeight: '700' }}>{actual.titulo}</Text> : null}
              {actual.descripcion ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{actual.descripcion}</Text> : null}
            </View>
          ) : null}
          {de(actual).map((p) => (
            <Seccion key={p.id}>
              <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '600' }}>
                {`${p.numero}. ${p.texto || 'Pregunta sin texto'}`}{p.obligatoria ? <Text style={{ color: MARCA.rojo }}> *</Text> : null}
              </Text>
              {p.ayuda ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{p.ayuda}</Text> : null}
              <Respuesta p={p} valor={respuestas[p.id]} onChange={(v) => { setRespuestas((r) => ({ ...r, [p.id]: v })); if (faltante === p.id) setFaltante(null); }} />
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

// Pasar la ronda — la misma captura que `components/bitacoras/PasarLaRonda.jsx`
// del portal: agrupada por MOMENTO (se camina una vez con el termohigrómetro y
// se anota todo lo de esa pasada), lo que queda en blanco no se manda, y una
// lectura fuera de rango exige decir qué se hizo. La lógica es la del núcleo
// (`utils/rondaDeBitacora`); acá sólo se dibuja.
import { useCallback, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fueraDeRango, registrarRonda, rotularRango } from '@nucleo/data/bitacoras';
import {
  agruparRondaPorMomento, alternarGrupoDePuntos, alternarPunto, armarEnvioDeRonda, gruposDePuntos,
  lecturasSinAccion, marcarTurnoDeLimpieza, mueblesQueFaltan, rotuloCortoDePunto,
} from '@nucleo/utils/rondaDeBitacora';
import { rango12 } from '@nucleo/utils/hora';
import Boton from '../Boton';
import { Aviso, BotonChico, CampoNumero, CampoTexto, Casilla, Insignia, Tarjeta, Texto, Titulo } from '../comunes';
import { useTema } from '../../tema/tema';

function RenglonLectura({ item, valor, onCambio, errorServidor }) {
  const t = useTema();
  const { area } = item;
  const fuera = fueraDeRango(area, valor.temp);
  const faltaAccion = fuera && !String(valor.accion || '').trim();
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: t.color.texto, fontWeight: '700', fontSize: t.texto.cuerpo + 2 }}>{area.nombre}</Text>
          <Texto tenue numberOfLines={1}>{rotularRango(area)}</Texto>
        </View>
        <CampoNumero valor={valor.temp} onCambio={(v) => onCambio({ temp: v })} error={fuera}
          etiqueta={`Temperatura de ${area.nombre} en grados`} />
        {area.mide_humedad
          ? <CampoNumero valor={valor.hum} onCambio={(v) => onCambio({ hum: v })} etiqueta={`Humedad de ${area.nombre} en porcentaje`} />
          : <Text style={{ width: 84, textAlign: 'center', color: t.color.texto3 }}>—</Text>}
      </View>
      {fuera ? (
        <View style={{ gap: 6 }}>
          <Text style={{ color: t.color.peligroTexto, fontWeight: '700', fontSize: t.texto.cuerpo + 1 }}>
            Fuera del rango. Hay que anotar qué se hizo: una lectura fuera de rango sin acción al lado prueba que se vio y no se actuó.
          </Text>
          <CampoTexto valor={valor.accion} onCambio={(v) => onCambio({ accion: v })} error={faltaAccion}
            etiqueta={`Qué se hizo con la temperatura de ${area.nombre}`}
            placeholder="Se encendió el aire y se bajó la persiana. Recontrolado a las 13:40." />
        </View>
      ) : null}
      {errorServidor ? <Text style={{ color: t.color.peligroTexto, fontWeight: '700' }}>{errorServidor}</Text> : null}
    </View>
  );
}

function RenglonLimpieza({ item, valor, onCambio, errorServidor }) {
  const t = useTema();
  const { area, bloque } = item;
  const [conNota, setConNota] = useState(false);
  const [abierto, setAbierto] = useState(false);
  const marcadas = valor.puntos || new Set();
  const grupos = gruposDePuntos(area.puntos);
  const total = (area.puntos || []).length;
  const faltan = mueblesQueFaltan(area, marcadas);

  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Casilla marcada={!!valor.marcada} onCambio={(m) => onCambio(marcarTurnoDeLimpieza(area, m))}
            etiqueta={`Limpieza de ${area.nombre}, ${bloque.label}`}>
            <Text style={{ color: t.color.texto, fontWeight: '700', fontSize: t.texto.cuerpo + 2 }}>
              {area.nombre}<Text style={{ color: t.color.texto3, fontWeight: '500' }}> · {bloque.label}</Text>
            </Text>
          </Casilla>
        </View>
        {valor.marcada && grupos.length ? (
          <BotonChico onPress={() => setAbierto(a => !a)} etiqueta="Ver los muebles">
            <Text style={{ color: faltan ? t.color.peligroTexto : t.color.marca }}>{total - faltan} de {total}</Text>
          </BotonChico>
        ) : null}
        {valor.marcada && !conNota ? <BotonChico onPress={() => setConNota(true)} etiqueta="Anotar algo">Nota</BotonChico> : null}
      </View>
      {valor.marcada && abierto ? grupos.map(g => {
        const hechas = g.items.filter(p => marcadas.has(p.clave)).length;
        const completo = hechas === g.items.length;
        return (
          <View key={g.tipo} style={{ gap: 4, paddingLeft: 32 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: t.color.texto3, fontWeight: '800', fontSize: t.texto.caption + 2, textTransform: 'uppercase' }}>{g.label}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ color: completo ? t.color.exitoTexto : t.color.texto2, fontWeight: '800' }}>{hechas} de {g.items.length}</Text>
                <BotonChico onPress={() => onCambio({ puntos: alternarGrupoDePuntos(marcadas, g.items) })}>{completo ? 'Ninguna' : 'Todas'}</BotonChico>
              </View>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {g.items.map(p => (
                <View key={p.clave} style={{ width: '31%' }}>
                  <Casilla marcada={marcadas.has(p.clave)} etiqueta={p.label || 'Sin nombre'}
                    onCambio={() => onCambio({ puntos: alternarPunto(marcadas, p.clave) })}>
                    <Text style={{ color: t.color.texto, fontVariant: ['tabular-nums'] }}>{rotuloCortoDePunto(p, g.singular)}</Text>
                  </Casilla>
                </View>
              ))}
            </View>
          </View>
        );
      }) : null}
      {valor.marcada && conNota ? (
        <CampoTexto valor={valor.obs} onCambio={(v) => onCambio({ obs: v })} etiqueta={`Observación de la limpieza de ${area.nombre}`}
          placeholder="Una gotera, una vitrina que hubo que reacomodar…" />
      ) : null}
      {errorServidor ? <Text style={{ color: t.color.peligroTexto, fontWeight: '700' }}>{errorServidor}</Text> : null}
    </View>
  );
}

export default function Ronda({ fecha, bloques, onCerrar }) {
  const t = useTema();
  const [pendientes, setPendientes] = useState(bloques);
  const [valores, setValores] = useState({});
  const [errores, setErrores] = useState({});
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [huboCambio, setHuboCambio] = useState(false);

  const cambiar = useCallback((clave, parche) => {
    setValores(v => ({ ...v, [clave]: { ...(v[clave] || {}), ...parche } }));
  }, []);
  const momentos = useMemo(() => agruparRondaPorMomento(pendientes), [pendientes]);
  const items = useMemo(() => armarEnvioDeRonda(pendientes, valores, fecha), [pendientes, valores, fecha]);
  const incompletos = useMemo(() => lecturasSinAccion(pendientes, valores), [pendientes, valores]);

  const guardar = async () => {
    setError(null);
    setGuardando(true);
    const res = await registrarRonda(items);
    setGuardando(false);
    if (res.error) { setError(res.error); return; }
    if (res.guardados > 0) setHuboCambio(true);
    const fallidas = new Map((res.fallidos || []).map(f => [f.clave, f.error]));
    if (!fallidas.size) { onCerrar(true); return; }
    // Lo que entró desaparece; lo que no, se queda con su motivo y lo tecleado.
    const enviadas = new Set(items.map(i => i.clave));
    setPendientes(p => p.filter(it => !enviadas.has(it.clave) || fallidas.has(it.clave)));
    setErrores(Object.fromEntries(fallidas));
  };

  // «Atrás» en Android y el gesto de bajar la hoja en iOS se hacen sin querer:
  // con algo escrito, se pregunta antes de tirarlo. Una lectura tomada de pie
  // no se puede rehacer de memoria.
  const cerrar = () => {
    if (guardando) return;
    if (!items.length) { onCerrar(huboCambio); return; }
    Alert.alert('¿Salir sin anotar?', items.length === 1 ? 'Hay 1 renglón escrito que todavía no se guardó.' : `Hay ${items.length} renglones escritos que todavía no se guardaron.`, [
      { text: 'Seguir anotando', style: 'cancel' },
      { text: 'Salir sin guardar', style: 'destructive', onPress: () => onCerrar(huboCambio) },
    ]);
  };

  return (
    <Modal visible animationType="slide" onRequestClose={cerrar} presentationStyle="pageSheet">
      <SafeAreaView style={{ flex: 1, backgroundColor: t.color.fondo }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={{ padding: 16, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.color.texto, fontSize: t.texto.titulo, fontWeight: '800' }}>Pasar la ronda</Text>
              <Texto tenue>Lo que dejes en blanco queda pendiente.</Texto>
            </View>
            <BotonChico onPress={cerrar} deshabilitado={guardando}>{huboCambio ? 'Listo' : 'Cancelar'}</BotonChico>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 12 }} keyboardShouldPersistTaps="handled"
        // En iPhone el teclado tapaba el campo que se escribe: esto corre el
        // contenido para que quede a la vista, y arrastrar lo cierra.
        automaticallyAdjustKeyboardInsets keyboardDismissMode="on-drag">
            {Object.keys(errores).length ? (
              <Aviso tono="warning">Quedaron renglones sin guardar. Lo demás ya está anotado; abajo está el motivo de cada uno.</Aviso>
            ) : null}
            {momentos.map(m => (
              <Tarjeta key={m.clave} tono={m.estado === 'vencida' ? 'warning' : undefined}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Titulo>{m.label}</Titulo>
                  <Texto tenue>{rango12(m.desde, m.hasta)}</Texto>
                  {m.estado === 'vencida' ? <Insignia tono="warning">Se pasó la hora</Insignia> : null}
                </View>
                {m.lecturas.length ? (
                  <View style={{ gap: 10 }}>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <View style={{ flex: 1 }} />
                      <Text style={{ width: 84, textAlign: 'center', color: t.color.texto3, fontWeight: '800' }}>°C</Text>
                      <Text style={{ width: 84, textAlign: 'center', color: t.color.texto3, fontWeight: '800' }}>% HR</Text>
                    </View>
                    {m.lecturas.map(it => (
                      <RenglonLectura key={it.clave} item={it} valor={valores[it.clave] || {}}
                        onCambio={(p) => cambiar(it.clave, p)} errorServidor={errores[it.clave]} />
                    ))}
                  </View>
                ) : null}
                {m.limpiezas.length ? (
                  <View style={{ borderTopWidth: 1, borderTopColor: t.color.borde, paddingTop: 6 }}>
                    <Text style={{ color: t.color.texto3, fontWeight: '800', fontSize: t.texto.caption + 2, textTransform: 'uppercase' }}>Limpieza</Text>
                    {m.limpiezas.map(it => (
                      <RenglonLimpieza key={it.clave} item={it} valor={valores[it.clave] || {}}
                        onCambio={(p) => cambiar(it.clave, p)} errorServidor={errores[it.clave]} />
                    ))}
                  </View>
                ) : null}
              </Tarjeta>
            ))}
            {error ? <Aviso tono="danger">{error}</Aviso> : null}
          </ScrollView>
          <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: t.color.borde, backgroundColor: t.color.tarjeta }}>
            <Boton onPress={guardar} ocupado={guardando} deshabilitado={!items.length || incompletos.length > 0}>
              {items.length ? `Anotar ${items.length}` : 'Anotar'}
            </Boton>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// Contar lo que preguntaron, NATIVO — `ContarExistencia` del portal. `id` es
// la sucursal de la consulta (la fila que le toca contar a quien abre).
//
// Conteo CIEGO: la pantalla no muestra lo que dice el sistema ni, si no
// cuadra, hacia dónde está la diferencia. Se cuenta por presentación; si el
// producto es regulado, además por lote (los lotes de la sucursal salen por
// nombre y fecha, sin cantidades, y se puede agregar uno que no esté). Un campo
// vacío cuenta como cero. Si el producto es perecedero pide el vencimiento
// (mes y año) de lo contado: sin él la base lo rechaza.
//
// Si no cuadra, la base pide UN reconteo: se borra lo escrito y se vuelve a
// contar. Si el reconteo tampoco cuadra queda el descuadre, y lo ajusta quien
// aprueba inventario (en `consultas-existencia`).
import { useEffect, useState } from 'react';
import { ActionSheetIOS, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { contarExistencia, fetchParaContar } from '@nucleo/data/consultasExistencia';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { mesDelVence, venceDelMes, mesAnioTexto } from '@nucleo/utils/fecha';
import Tocable from '../../componentes/Tocable';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Cargando, PantallaSinDato, Seccion, exigeParametro } from '../../componentes/formulario/Piezas';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo } from '../../componentes/Progreso';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

/** Mes y año en dos toques (año, después mes): «AAAA-MM», lo que trae el empaque. */
function MesAnio({ valor, onCambiar, rotulo = 'Vence' }) {
  const elegir = () => {
    Haptics.selectionAsync().catch(() => {});
    const hoy = new Date().getFullYear();
    const anios = Array.from({ length: 9 }, (_, i) => String(hoy - 2 + i));
    ActionSheetIOS.showActionSheetWithOptions({ title: 'Año de vencimiento', options: [...anios, 'Cancelar'], cancelButtonIndex: anios.length }, (i) => {
      if (i >= anios.length) return;
      ActionSheetIOS.showActionSheetWithOptions({ title: `Mes de ${anios[i]}`, options: [...MESES, 'Cancelar'], cancelButtonIndex: 12 }, (m) => {
        if (m < 12) onCambiar(`${anios[i]}-${String(m + 1).padStart(2, '0')}`);
      });
    });
  };
  const [a, m] = String(valor || '').split('-');
  return (
    <Tocable onPress={elegir} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 10 }}>
      <Text style={{ color: colorSistema.texto, fontSize: 16 }}>{rotulo}</Text>
      <Text style={{ flex: 1, textAlign: 'right', color: valor ? colorSistema.acento : colorSistema.texto2, fontSize: 16 }}>
        {a && m ? `${MESES[Number(m) - 1]} ${a}` : 'Mes y año'}
      </Text>
      <Text style={{ color: colorSistema.texto2, fontSize: 18 }}>›</Text>
    </Tocable>
  );
}

const conAlgo = (g) => Object.values(g.cantidades).some((v) => Number(v) > 0);

function Contar() {
  const { id } = useLocalSearchParams();
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  // Un grupo por lote (o uno solo sin lote): { lote, vence, nuevo, cantidades: {tipo: '3'} }.
  const [grupos, setGrupos] = useState([]);
  // Qué grupos piden la fecha: los que no la traen del sistema (se fija al llegar los datos).
  const [pidenVence, setPidenVence] = useState(new Set());
  const [ronda, setRonda] = useState(1);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null);

  useEffect(() => {
    let vivo = true;
    fetchParaContar(id).then(({ data, error: e }) => {
      if (!vivo) return;
      if (e) { setError(mensajeAmigable(e)); return; }
      const gs = data.regulado
        ? (data.lotes ?? []).map((l) => ({ lote: l.lote, vence: mesDelVence(l.vence), nuevo: false, cantidades: {} }))
        : [{ lote: null, vence: mesDelVence(data.vence), nuevo: false, cantidades: {} }];
      setDatos(data);
      setRonda(data.ronda);
      setGrupos(gs);
      if (data.perecedero) setPidenVence(new Set(gs.map((g, i) => (!g.vence ? i : null)).filter((i) => i !== null)));
    });
    return () => { vivo = false; };
  }, [id]);

  if (error) return <PantallaSinDato titulo="Contar existencia" texto={error} />;
  if (!datos) return <PantallaSinDato titulo="Contar existencia" cargando />;

  const cambiar = (i, cambio) => setGrupos((gs) => gs.map((g, j) => (j === i ? { ...g, ...cambio } : g)));
  const ponerCantidad = (i, tipo, valor) => setGrupos((gs) => gs.map((g, j) => (
    j === i ? { ...g, cantidades: { ...g.cantidades, [tipo]: valor.replace(/[^\d]/g, '') } } : g)));

  // Las dos reglas del portal, en ese orden, para el PRIMER grupo que las incumple.
  const queFalta = (() => {
    const iLote = grupos.findIndex((g) => g.nuevo && conAlgo(g) && (!String(g.lote ?? '').trim() || !venceDelMes(g.vence)));
    if (iLote >= 0) return !String(grupos[iLote].lote ?? '').trim() ? 'Escribe el número del lote nuevo.' : 'Pon el vencimiento del lote nuevo.';
    if (datos.perecedero && grupos.some((g) => conAlgo(g) && !venceDelMes(g.vence))) return 'Pon el vencimiento de lo que contaste.';
    return null;
  })();

  const enviar = async () => {
    if (queFalta || enviando) return;
    const conteo = grupos.flatMap((g) => (datos.presentaciones ?? []).map((p) => ({
      tipo: p.tipo, factor: p.factor,
      cantidad: Number(g.cantidades[p.tipo] || 0),
      ...(datos.regulado ? { lote: String(g.lote ?? '').trim().toUpperCase() } : {}),
      ...(datos.regulado || datos.perecedero ? { vence: venceDelMes(g.vence) } : {}),
    }))).filter((c) => c.cantidad > 0 || !datos.regulado);
    setEnviando(true);
    const { data, error: e } = await contarExistencia(id, conteo);
    setEnviando(false);
    if (e) { fallo('No se guardó', mensajeAmigable(e)); return; }
    if (data.estado === 'RECONTAR') {
      // Se borra lo escrito: un reconteo que arranca con los números de antes se confirma sin contar.
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      setGrupos((gs) => gs.filter((g) => !g.nuevo).map((g) => ({ ...g, cantidades: {} })));
      setRonda(2);
      return;
    }
    Haptics.notificationAsync(data.estado === 'CUADRA' ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning).catch(() => {});
    setResultado(data);
  };

  const titulo = datos.nombre ?? 'Contar existencia';
  if (resultado) {
    const falta = Number(resultado.diferencia) < 0;
    return (
      <>
        <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Contar existencia', headerLargeTitle: false }} />
        <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }} contentInsetAdjustmentBehavior="automatic">
          <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '800' }}>{titulo}</Text>
          <Seccion>
            {resultado.estado === 'CUADRA'
              ? <Text style={{ color: MARCA.verde, fontSize: 16, fontWeight: '700' }}>Cuadra. No hay que ajustar nada.</Text>
              : <Text style={{ color: falta ? MARCA.rojo : MARCA.ambar, fontSize: 16, fontWeight: '700' }}>
                  {`No cuadra: ${falta ? 'faltan' : 'sobran'} ${resultado.texto}. Un supervisor o administrador lo revisa y hace el ajuste. No tienes que hacer nada más.`}
                </Text>}
          </Seccion>
          <BotonGrande texto="Listo" onPress={() => router.back()} />
        </ScrollView>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Contar existencia', headerLargeTitle: false }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }}
          contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled">
          <View style={{ gap: 2 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '800' }}>{titulo}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{`${datos.sala} · cuenta lo que hay en el estante`}</Text>
          </View>
          {ronda === 2
            ? <Aviso tono="cuidado" texto={`No coincide con la existencia registrada. Vuelve a contar con calma, presentación por presentación${datos.regulado ? ' y lote por lote' : ''}.`} />
            : <Aviso texto="Escribe cuántas hay de cada presentación. Lo que dejes vacío cuenta como cero. Los vencidos apartados no se cuentan." />}
          {datos.regulado && grupos.length === 0
            ? <Aviso texto="La sucursal no tiene lotes registrados de este producto. Si hay en el estante, agrega el lote." /> : null}

          {grupos.map((g, i) => (
            <Seccion key={i} titulo={datos.regulado ? (g.nuevo ? 'Lote nuevo' : `Lote ${g.lote}`) : 'Conteo'}
              pie={datos.regulado && !g.nuevo && g.vence && !pidenVence.has(i) ? `Vence ${mesAnioTexto(venceDelMes(g.vence))}` : undefined}>
              {g.nuevo ? (
                <>
                  <Campo multiline={false} value={g.lote ?? ''} placeholder="Número de lote" autoCapitalize="characters" autoCorrect={false}
                    onChangeText={(v) => cambiar(i, { lote: v })} />
                  <MesAnio valor={g.vence} onCambiar={(v) => cambiar(i, { vence: v })} />
                </>
              ) : null}
              {datos.perecedero && !g.nuevo && (pidenVence.has(i) || !datos.regulado)
                ? <MesAnio rotulo="Vence (mes y año)" valor={g.vence} onCambiar={(v) => cambiar(i, { vence: v })} /> : null}
              {(datos.presentaciones ?? []).map((p) => (
                <View key={p.tipo} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>{`${p.tipo}${p.factor > 1 ? ` (${p.factor})` : ''}`}</Text>
                  <Campo multiline={false} keyboardType="number-pad" value={g.cantidades[p.tipo] ?? ''} placeholder="0"
                    onChangeText={(v) => ponerCantidad(i, p.tipo, v)}
                    style={{ width: 110, textAlign: 'right', fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] }} />
                </View>
              ))}
              {g.nuevo ? (
                <Tocable onPress={() => setGrupos((gs) => gs.filter((_, j) => j !== i))} style={{ alignSelf: 'flex-end', minHeight: 36, justifyContent: 'center' }}>
                  <Text style={{ color: MARCA.rojo, fontSize: 14 }}>Quitar el lote</Text>
                </Tocable>
              ) : null}
            </Seccion>
          ))}

          {datos.regulado ? (
            <BotonGrande texto="Hay otro lote" borde onPress={() => setGrupos((gs) => [...gs, { lote: '', vence: '', nuevo: true, cantidades: {} }])} />
          ) : null}
          {queFalta ? <Aviso tono="cuidado" texto={queFalta} /> : null}
          {enviando ? <Cargando /> : (
            <BotonGrande texto={ronda === 2 ? 'Enviar reconteo' : 'Enviar conteo'} deshabilitado={!!queFalta} onPress={enviar} />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

export default exigeParametro(Contar, 'id', { titulo: 'Contar existencia', texto: 'No se encontró la consulta.' });

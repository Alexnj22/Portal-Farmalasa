// «Enriquecer SRS», NATIVO — el `SrsEnriquecerModal` del catálogo del portal:
// recorre los productos activos sin principio activo (de a 300), los busca en
// el registro sanitario y los reparte en tres:
//
//   · se aplican solos (parecido ≥ 70%): se revisan de un vistazo, se quita el
//     que no va y «Aplicar» los guarda todos;
//   · para revisar: uno por uno, eligiendo entre los mejores candidatos, o
//     saltándolo, o marcándolo «no lleva principio activo» (insumos, equipos…),
//     o escribiéndolo a mano en su ficha;
//   · sin resultado: se pueden marcar «no lleva principio activo».
//
// La búsqueda, el parecido y lo que se guarda son del núcleo
// (`utils/enriquecerSrs`, `data/srs`), lo mismo que el portal.
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { aplicarPrincipiosDeSrs, escanearSinPrincipioEnSrs } from '@nucleo/data/srs';
import { updateProductSinPrincipioActivo } from '@nucleo/data/productos';
import { principiosDeSrs, SRS_AUTO_MIN, SRS_LOTE, textoDePrincipios } from '@nucleo/utils/enriquecerSrs';
import { resultadoDeSrs } from '@nucleo/utils/srs';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Seccion } from '../../componentes/formulario/Piezas';
import { Pildora } from '../../componentes/avisos/Piezas';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../../componentes/Progreso';

const pct = (s) => `${Math.round(Number(s) * 100)}%`;
const colorDe = (s) => (s >= SRS_AUTO_MIN ? MARCA.verde : MARCA.ambar);

export default function EnriquecerSrs() {
  const [fase, setFase] = useState('inicio');   // inicio | buscando | revisando
  const [avance, setAvance] = useState({ hechos: 0, total: 0 });
  const [auto, setAuto] = useState([]);
  const [quitados, setQuitados] = useState(() => new Set());
  const [revisar, setRevisar] = useState([]);
  const [indice, setIndice] = useState(0);
  const [sin, setSin] = useState([]);
  const [sinPA, setSinPA] = useState(() => new Set());
  const [cuenta, setCuenta] = useState({ aplicados: 0, saltados: 0 });
  const [ocupado, setOcupado] = useState(false);
  const cancelar = useRef(false);

  const empezar = async () => {
    cancelar.current = false;
    setFase('buscando'); setAuto([]); setQuitados(new Set()); setRevisar([]); setIndice(0); setSin([]); setSinPA(new Set());
    setCuenta({ aplicados: 0, saltados: 0 });
    const r = await escanearSinPrincipioEnSrs({
      alAvanzar: setAvance,
      alDecidir: ({ tipo, entrada, producto }) => {
        if (tipo === 'auto') setAuto((x) => [...x, entrada]);
        else if (tipo === 'revisar') setRevisar((x) => [...x, entrada]);
        else setSin((x) => [...x, { id: producto.id, nombre: producto.nombre }]);
      },
      cancelado: () => cancelar.current,
    });
    if (r.error) fallo('No se pudo leer el catálogo', mensajeAmigable(r.error));
    setFase('revisando');
  };

  const aplicarAuto = async () => {
    setOcupado(true); trabajando('Guardando los principios…');
    let hechos = 0;
    let fallidos = 0;
    for (const e of auto) {
      if (quitados.has(e.product.id)) continue;
      try { await aplicarPrincipiosDeSrs(e.product.id, e.principios, { desde: 'app' }); hechos += 1; } catch { fallidos += 1; }
    }
    setCuenta((c) => ({ aplicados: c.aplicados + hechos, saltados: c.saltados + quitados.size }));
    setAuto([]); setQuitados(new Set()); setOcupado(false);
    if (fallidos) fallo('Se guardó una parte', `${hechos} guardados y ${fallidos} no. Vuelve a correrlo para los que faltan.`);
    else listo('Guardado', `${hechos} producto${hechos === 1 ? '' : 's'} con su principio activo.`);
  };

  const actual = revisar[indice];
  const siguiente = (aplicado) => {
    setCuenta((c) => (aplicado ? { ...c, aplicados: c.aplicados + 1 } : { ...c, saltados: c.saltados + 1 }));
    setIndice((i) => i + 1);
  };
  const aplicarActual = async () => {
    setOcupado(true);
    try { await aplicarPrincipiosDeSrs(actual.product.id, actual.principios, { desde: 'app' }); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); siguiente(true); }
    catch (e) { fallo('No se pudo guardar', mensajeAmigable(e)); }
    finally { setOcupado(false); }
  };
  const marcarSinPA = async (id, si = true) => {
    const { error } = await updateProductSinPrincipioActivo(id, si);
    if (error) { fallo('No se pudo marcar', mensajeAmigable(error)); return false; }
    setSinPA((s) => { const n = new Set(s); if (si) n.add(id); else n.delete(id); return n; });
    return true;
  };
  const elegir = (k) => {
    const c = actual.candidates[k];
    if (!c) return;
    Haptics.selectionAsync().catch(() => {});
    setRevisar((q) => q.map((e, i) => (i === indice ? { ...e, srs: c.srs, score: c.score, principios: principiosDeSrs(c.srs) } : e)));
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Enriquecer SRS' }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic">
        {fase === 'inicio' ? (
          <>
            <Aviso texto={`Busca en el registro sanitario hasta ${SRS_LOTE} productos activos sin principio activo. Lo que se parece mucho se aplica de un vistazo; lo demás se revisa uno por uno.`} />
            <BotonGrande texto="Empezar" color={MARCA.violetaClaro} onPress={empezar} />
          </>
        ) : null}

        {fase === 'buscando' ? (
          <Seccion titulo="Buscando en el SRS">
            <ActivityIndicator />
            <Text style={{ color: colorSistema.texto, fontSize: 15, textAlign: 'center' }}>{`${avance.hechos} de ${avance.total || '…'} productos`}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 13, textAlign: 'center' }}>{`${auto.length} se aplican solos · ${revisar.length} para revisar · ${sin.length} sin resultado`}</Text>
            <BotonGrande texto="Detener" borde onPress={() => { cancelar.current = true; }} />
          </Seccion>
        ) : null}

        {fase === 'revisando' ? (
          <>
            <Text style={{ color: colorSistema.texto2, fontSize: 14, marginHorizontal: 4 }}>
              {`${cuenta.aplicados} aplicados · ${cuenta.saltados} saltados${sinPA.size ? ` · ${sinPA.size} sin principio activo` : ''}`}
            </Text>

            {auto.length ? (
              <Seccion titulo={`Se aplican solos · ${auto.length - quitados.size}`} pie="Toca uno para quitarlo (o volver a ponerlo) antes de aplicar.">
                {auto.map((e, i) => {
                  const fuera = quitados.has(e.product.id);
                  return (
                    <Pressable key={e.product.id} onPress={() => setQuitados((s) => { const n = new Set(s); if (n.has(e.product.id)) n.delete(e.product.id); else n.add(e.product.id); return n; })}
                      style={({ pressed }) => ({ gap: 2, paddingTop: i ? 8 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, opacity: fuera ? 0.4 : pressed ? 0.7 : 1 })}>
                      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                        <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14, fontWeight: '600', textDecorationLine: fuera ? 'line-through' : 'none' }}>{e.product.nombre}</Text>
                        <Pildora texto={pct(e.score)} color={colorDe(e.score)} />
                      </View>
                      <Text style={{ color: MARCA.violetaClaro, fontSize: 13 }}>{textoDePrincipios(e.principios) || 'El registro no trae principio'}</Text>
                    </Pressable>
                  );
                })}
                <BotonGrande texto={ocupado ? 'Guardando…' : `Aplicar ${auto.length - quitados.size}`} color={MARCA.verde}
                  deshabilitado={ocupado || auto.length === quitados.size} onPress={aplicarAuto} />
              </Seccion>
            ) : null}

            {actual ? (
              <Seccion titulo={`Para revisar · ${indice + 1} de ${revisar.length}`}>
                <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '800' }}>{actual.product.nombre}</Text>
                {actual.product.laboratorios?.nombre ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{actual.product.laboratorios.nombre}</Text> : null}
                {actual.candidates.map((c, k) => {
                  const r = resultadoDeSrs(c.srs);
                  const elegido = c.srs === actual.srs;
                  return (
                    <Pressable key={k} onPress={() => elegir(k)}
                      style={({ pressed }) => ({ gap: 2, padding: 10, borderRadius: 14, borderWidth: elegido ? 1.5 : 0.5,
                        borderColor: elegido ? MARCA.violetaClaro : colorSistema.separador, opacity: pressed ? 0.7 : 1 })}>
                      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                        <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14, fontWeight: '700' }}>{r.nombre || 'Sin nombre'}</Text>
                        <Pildora texto={pct(c.score)} color={colorDe(c.score)} />
                      </View>
                      <Text style={{ color: MARCA.violetaClaro, fontSize: 13 }}>{[r.principio, r.conc].filter(Boolean).join(' · ') || 'Sin principio en el registro'}</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{[r.lab, r.forma, r.noregistro ? `Reg. ${r.noregistro}` : null].filter(Boolean).join(' · ')}</Text>
                    </Pressable>
                  );
                })}
                <BotonGrande texto={ocupado ? 'Guardando…' : 'Aplicar'} color={MARCA.verde} deshabilitado={ocupado || !actual.principios.length} onPress={aplicarActual} />
                <BotonGrande texto="Saltar" borde deshabilitado={ocupado} onPress={() => siguiente(false)} />
                <BotonGrande texto="No lleva principio activo" borde color={MARCA.ambar} deshabilitado={ocupado}
                  onPress={async () => { setOcupado(true); if (await marcarSinPA(actual.product.id)) siguiente(false); setOcupado(false); }} />
                <Pressable onPress={() => router.push({ pathname: '/producto/principios', params: { id: String(actual.product.id), nombre: actual.product.nombre } })}
                  style={{ minHeight: 44, justifyContent: 'center' }}>
                  <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '600' }}>Escribirlo a mano ›</Text>
                </Pressable>
              </Seccion>
            ) : revisar.length ? <Aviso texto="Ya revisaste todos los que tenían candidatos." /> : null}

            {sin.length ? (
              <Seccion titulo={`Sin resultado en el SRS · ${sin.length}`} pie="Los que no son medicamento (insumos, equipos, cosméticos) se marcan para que no vuelvan a salir.">
                {sin.map((p, i) => {
                  const marcado = sinPA.has(p.id);
                  return (
                    <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: i ? 6 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                      <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14 }}>{p.nombre}</Text>
                      <Pressable onPress={() => marcarSinPA(p.id, !marcado)} style={{ minHeight: 44, justifyContent: 'center' }}>
                        <Text style={{ color: marcado ? MARCA.verde : MARCA.azulClaro, fontSize: 13, fontWeight: '600' }}>{marcado ? 'Sin principio ✓' : 'No lleva'}</Text>
                      </Pressable>
                    </View>
                  );
                })}
              </Seccion>
            ) : null}

            {!auto.length && (!actual) ? <BotonGrande texto="Otra tanda" borde onPress={empezar} /> : null}
          </>
        ) : null}
      </ScrollView>
    </>
  );
}

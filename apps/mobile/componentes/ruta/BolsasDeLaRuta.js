// Las bolsas de traslado en la ruta de reparto (punto 6 de traslados,
// 2026-11-12): lo que el conductor lleva encima y lo que puede llevarse «de
// paso» — bolsas despachadas cuyo destino es una parada que le falta.
//
//   · «Escanear bolsa» la recoge (`recogerBolsa`): queda a su nombre, con la
//     hora y la ubicación del teléfono. El escáner sigue abierto para varias.
//   · Al entregar la parada, las bolsas para esa sala se entregan solas (lo
//     hace la base). Las que van a una sala que NO es parada tienen su propio
//     «Entregué»; «Soltar» la devuelve (queda que la tuvo).
//   · «De paso, lleva también»: primero lo que queda en el camino, después los
//     desvíos con sus minutos estimados (`minutosDeDesvio`).
//
// Opcional: nada obliga a recoger. Recibir con el botón sigue valiendo.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { entregarBolsa, fetchBolsasDeRuta, recogerBolsa, soltarBolsa } from '@nucleo/data/rutaBolsas';
import { bolsasEncima, minutosDeDesvio, ordenarSugeridas, rotuloDeSugerida } from '@nucleo/utils/bolsasDeRuta';
import { hora12 } from '@nucleo/utils/hora';
import { colorSistema } from '../Formulario';
import { Aviso, BotonGrande, Seccion } from '../formulario/Piezas';
import Escaner from '../Escaner';
import { MARCA } from '../inicio/marca';
import { fallo, listo } from '../Progreso';

const cuantos = (n) => `${n} producto${n === 1 ? '' : 's'}`;

function Fila({ primero, titulo, detalle, etiqueta, tonoEtiqueta, acciones }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: primero ? 0 : 10,
      borderTopWidth: primero ? 0 : 0.5, borderTopColor: colorSistema.separador }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{titulo}</Text>
        {detalle ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{detalle}</Text> : null}
        {etiqueta ? <Text style={{ color: tonoEtiqueta ?? colorSistema.texto2, fontSize: 12, fontWeight: '700' }}>{etiqueta}</Text> : null}
      </View>
      {acciones?.length ? <View style={{ gap: 4, alignItems: 'flex-end' }}>{acciones}</View> : null}
    </View>
  );
}

function Accion({ texto, color, onPress, deshabilitado }) {
  return (
    <Pressable onPress={onPress} disabled={deshabilitado} accessibilityRole="button" accessibilityLabel={texto}
      style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 10, justifyContent: 'center',
        opacity: deshabilitado ? 0.5 : pressed ? 0.6 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
      <Text style={{ color, fontSize: 14, fontWeight: '700' }}>{texto}</Text>
    </Pressable>
  );
}

/**
 * @param ruta        la ruta (se vuelve a leer cuando cambia)
 * @param paradas     en orden (`ordenarParadas`)
 * @param coords      `{ porSucursal, bodega }`
 * @param puedeOperar el conductor, o quien gestiona rutas
 * @param posicion    `() => { lat, lng } | null` — la última del GPS
 * @param onEncima    avisa cuáles lleva encima (para «Entregué» y «Volver a base»)
 */
export default function BolsasDeLaRuta({ ruta, paradas, coords, puedeOperar, posicion, onEncima }) {
  const [datos, setDatos] = useState({ llevas: [], sugeridas: [] });
  const [error, setError] = useState('');
  const [escaneando, setEscaneando] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const activa = ruta?.status === 'pendiente' || ruta?.status === 'en_ruta';

  const cargar = useCallback(async () => {
    const r = await fetchBolsasDeRuta(ruta?.id);
    if (r.error) { setError(r.error.message ?? 'No se pudieron leer las bolsas.'); return; }
    setError('');
    setDatos({ llevas: r.llevas, sugeridas: r.sugeridas });
  }, [ruta?.id]);
  // Se vuelve a leer cada vez que la ruta cambia (entregar una parada entrega sus bolsas).
  useEffect(() => { cargar(); }, [cargar, ruta]);

  const encima = useMemo(() => bolsasEncima(datos.llevas), [datos.llevas]);
  const entregadas = datos.llevas.filter((b) => b.entregada_at);
  useEffect(() => { onEncima?.(encima); }, [encima, onEncima]);
  const sugeridas = useMemo(() => ordenarSugeridas(datos.sugeridas,
    (s) => minutosDeDesvio(s, paradas, coords?.porSucursal, coords?.bodega)), [datos.sugeridas, paradas, coords]);

  const escanear = async (codigo) => {
    setAviso(null);
    const r = await recogerBolsa(ruta.id, codigo, posicion?.());
    if (!r?.ok) { setAviso({ error: true, texto: r?.error ?? 'No se pudo recoger esa bolsa.' }); return false; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setAviso({ texto: `Recogida: ${r.origen ?? '¿?'} → ${r.destino ?? '¿?'}${r.en_ruta ? '' : ' (no es parada de esta ruta)'}` });
    await cargar();
    return false;   // el escáner sigue abierto para la siguiente
  };

  const hacer = (titulo, mensaje, boton, accion, exito) => Alert.alert(titulo, mensaje, [
    { text: 'Cancelar', style: 'cancel' },
    { text: boton, onPress: async () => {
      setOcupado(true);
      try {
        const r = await accion();
        if (!r?.ok) throw new Error(r?.error ?? 'No se pudo.');
        listo(exito);
        await cargar();
      } catch (e) { fallo(`No se pudo: ${boton.toLowerCase()}`, e?.message); }
      finally { setOcupado(false); }
    } },
  ]);

  if (!activa && !datos.llevas.length) return null;

  return (
    <View style={{ marginHorizontal: 16, gap: 14 }}>
      {error ? <Aviso tono="cuidado" texto={error} /> : null}

      <Seccion titulo={`Bolsas que llevas · ${encima.length}`}
        pie={encima.length ? 'Al entregar una parada se entregan solas las bolsas para esa sala.' : null}>
        {!datos.llevas.length ? (
          <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>
            {activa ? 'Ninguna. Escanea el ticket de una bolsa para llevarla con la ruta.' : 'Esta ruta no llevó bolsas.'}
          </Text>
        ) : [...encima, ...entregadas].map((b, i) => (
          <Fila key={b.id} primero={i === 0}
            titulo={`${b.origen ?? '¿?'} → ${b.destino ?? '¿?'}`}
            detalle={[b.codigo ? `Ticket ${b.codigo}` : null, `recogida ${hora12(b.recogida_at)}`,
              b.entregada_at ? `entregada ${hora12(b.entregada_at)}` : null].filter(Boolean).join(' · ')}
            etiqueta={b.entregada_at ? 'Entregada' : b.en_ruta ? null : 'Su sala no es parada de esta ruta'}
            tonoEtiqueta={b.entregada_at ? MARCA.verde : MARCA.ambar}
            acciones={!b.entregada_at && puedeOperar && activa ? [
              !b.en_ruta ? <Accion key="e" texto="Entregué" color={MARCA.verde} deshabilitado={ocupado}
                onPress={() => hacer(`Entregar en ${b.destino}`, 'Queda que la dejaste ahí, con la hora y tu ubicación. La sala la recibe después en el portal.',
                  'Entregué', () => entregarBolsa(b, posicion?.()), 'Bolsa entregada')} /> : null,
              <Accion key="s" texto="Soltar" color={MARCA.rojo} deshabilitado={ocupado}
                onPress={() => hacer('Soltar la bolsa', 'Úsalo si la recogiste por error o la dejaste donde estaba. Queda anotado que la tuviste.',
                  'Soltar', () => soltarBolsa(b), 'Bolsa soltada')} />,
            ].filter(Boolean) : null} />
        ))}
      </Seccion>

      {puedeOperar && activa ? (
        <BotonGrande texto="Escanear bolsa" color={MARCA.azul} deshabilitado={ocupado} onPress={() => { setAviso(null); setEscaneando(true); }} />
      ) : null}

      {activa && sugeridas.length ? (
        <Seccion titulo={`De paso, lleva también · ${sugeridas.length}`}
          pie="Bolsas despachadas que van a una sala de tu ruta. Recogerlas es opcional.">
          {sugeridas.map((s, i) => (
            <Fila key={s.request_id} primero={i === 0}
              titulo={`${s.origen ?? '¿?'} → ${s.destino ?? '¿?'}`}
              detalle={[s.codigo ? `Ticket ${s.codigo}` : null, s.productos ? cuantos(s.productos) : null,
                s.despachado_at ? `salió ${hora12(s.despachado_at)}` : null].filter(Boolean).join(' · ')}
              etiqueta={rotuloDeSugerida(s, s.minutos)}
              tonoEtiqueta={s.categoria === 'en_ruta' ? MARCA.verde : MARCA.ambar} />
          ))}
        </Seccion>
      ) : null}

      <Escaner visible={escaneando} titulo="Recoger una bolsa" ayuda="Apunta al código del ticket pegado a la bolsa"
        onCodigo={escanear} onCerrar={() => setEscaneando(false)}
        pie={aviso ? <Text style={{ color: '#fff', fontSize: 14, textAlign: 'center' }}>{aviso.texto}</Text> : null} />
    </View>
  );
}

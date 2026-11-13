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
import { Alert, Text, View } from 'react-native';
import { Presionable as Pressable } from '../Tocable';
import * as Haptics from 'expo-haptics';
import { entregarBolsa, entregarBolsaConCarne, fetchBolsasDeRuta, recogerBolsa, soltarBolsa } from '@nucleo/data/rutaBolsas';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
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
 * @param firmaExigida la firma de la sala es obligatoria (`security_config`)
 */
export default function BolsasDeLaRuta({ ruta, paradas, coords, puedeOperar, posicion, onEncima, firmaExigida = false }) {
  const [datos, setDatos] = useState({ llevas: [], sugeridas: [] });
  const [error, setError] = useState('');
  const [escaneando, setEscaneando] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  // El paquete suelto cuyo carné de quien recibe se está escaneando.
  const [firmando, setFirmando] = useState(null);
  const [avisoFirma, setAvisoFirma] = useState(null);
  const activa = ruta?.status === 'pendiente' || ruta?.status === 'en_ruta';

  const cargar = useCallback(async () => {
    const r = await fetchBolsasDeRuta(ruta?.id);
    if (r.error) { setError(r.error.message ?? 'No se pudieron leer los paquetes.'); return; }
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
    if (!r?.ok) { setAviso({ error: true, texto: r?.error ?? 'No se pudo recoger ese paquete.' }); return false; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setAviso({ texto: `Recogido: ${r.origen ?? '¿?'} → ${r.destino ?? '¿?'}${r.en_ruta ? '' : ' (no es parada de esta ruta)'}` });
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

  // Paquete suelto (su sala no es parada): «Entregué» ofrece la firma con
  // carné de alguien de la sala destino, igual que la parada.
  const entregarSuelto = (b) => Alert.alert(`Entregar en ${b.destino}`,
    'Queda que lo dejaste ahí, con la hora y tu ubicación. La sala lo recibe después en el portal.'
      + (firmaExigida ? '\n\nPide el carné a quien recibe: sin su firma no se puede entregar.' : '\n\nSi puedes, pide el carné a quien recibe para que quede su firma.'), [
      { text: 'Cancelar', style: 'cancel' },
      ...(firmaExigida ? [] : [{ text: 'Entregué sin firma', onPress: async () => {
        setOcupado(true);
        try {
          const r = await entregarBolsa(b, posicion?.());
          if (!r?.ok) throw new Error(r?.error ?? 'No se pudo.');
          listo('Paquete entregado');
          await cargar();
        } catch (e) { fallo('No se pudo entregar', e?.message); }
        finally { setOcupado(false); }
      } }]),
      { text: 'Firma con carné', onPress: () => { setAvisoFirma(null); setFirmando(b); } },
    ]);
  const alLeerCarne = async (codigo) => {
    const b = firmando;
    if (!b) return true;
    const r = await entregarBolsaConCarne(b, codigo, posicion?.());
    if (!r?.ok) { setAvisoFirma(r?.error ?? 'No se pudo confirmar el carné.'); return false; }
    setFirmando(null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    listo('Paquete entregado', `Firmó ${shortEmployeeName(r.quien)}`);
    await cargar();
    return true;
  };

  if (!activa && !datos.llevas.length) return null;

  return (
    <View style={{ marginHorizontal: 16, gap: 14 }}>
      {error ? <Aviso tono="cuidado" texto={error} /> : null}

      <Seccion titulo={`Paquetes que llevas · ${encima.length}`}
        pie={encima.length ? 'Al entregar una parada se entregan solos los paquetes para esa sala.' : null}>
        {!datos.llevas.length ? (
          <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>
            {activa ? 'Ninguno. Escanea el ticket de un paquete para llevarlo con la ruta.' : 'Esta ruta no llevó paquetes.'}
          </Text>
        ) : [...encima, ...entregadas].map((b, i) => (
          <Fila key={b.id} primero={i === 0}
            titulo={`${b.origen ?? '¿?'} → ${b.destino ?? '¿?'}`}
            detalle={[b.codigo ? `Ticket ${b.codigo}` : null, `recogido ${hora12(b.recogida_at)}`,
              b.entregada_at ? `entregado ${hora12(b.entregada_at)}` : null].filter(Boolean).join(' · ')}
            etiqueta={b.entregada_at ? (b.recibio_firma_at ? 'Entregado · firmó la sala' : 'Entregado') : b.en_ruta ? null : 'Su sala no es parada de esta ruta'}
            tonoEtiqueta={b.entregada_at ? MARCA.verde : MARCA.ambar}
            acciones={!b.entregada_at && puedeOperar && activa ? [
              !b.en_ruta ? <Accion key="e" texto="Entregué" color={MARCA.verde} deshabilitado={ocupado}
                onPress={() => entregarSuelto(b)} /> : null,
              <Accion key="s" texto="Soltar" color={MARCA.rojo} deshabilitado={ocupado}
                onPress={() => hacer('Soltar el paquete', 'Úsalo si lo recogiste por error o lo dejaste donde estaba. Queda anotado que lo tuviste.',
                  'Soltar', () => soltarBolsa(b), 'Paquete soltado')} />,
            ].filter(Boolean) : null} />
        ))}
      </Seccion>

      {puedeOperar && activa ? (
        <BotonGrande texto="Escanear paquete" color={MARCA.azul} deshabilitado={ocupado} onPress={() => { setAviso(null); setEscaneando(true); }} />
      ) : null}

      {activa && sugeridas.length ? (
        <Seccion titulo={`De paso, lleva también · ${sugeridas.length}`}
          pie="Paquetes despachados que van a una sala de tu ruta. Recogerlos es opcional.">
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

      <Escaner visible={!!firmando} titulo={`Firma de ${firmando?.destino ?? 'la sala'}`}
        ayuda="Apunta al código del carné de quien recibe" onCodigo={alLeerCarne}
        onCerrar={() => { setFirmando(null); setAvisoFirma(null); }}
        pie={avisoFirma ? <Text style={{ color: '#fff', fontSize: 14, textAlign: 'center' }}>{avisoFirma}</Text> : null} />
      <Escaner visible={escaneando} titulo="Recoger un paquete" ayuda="Apunta al código del ticket pegado al paquete"
        onCodigo={escanear} onCerrar={() => setEscaneando(false)}
        pie={aviso ? <Text style={{ color: '#fff', fontSize: 14, textAlign: 'center' }}>{aviso.texto}</Text> : null} />
    </View>
  );
}

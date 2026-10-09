// Los puntos de los cambios de cliente que no terminaron de moverse, NATIVO —
// `TraspasosPendientes` de Puntos. «Reintentar» vuelve a mover los puntos de la
// venta a la ficha nueva; «Resolver a mano» lo cierra con lo que se hizo (ya no
// se reintenta). No dibuja nada si no hay ninguno.
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { fetchCambiosPendientes, marcarCambioResueltoAMano, reintentarCambioDeCliente } from '@nucleo/data/puntos';
import { puntosTexto } from '@nucleo/utils/puntosTexto';
import { fechaHora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { colorSistema } from '../Formulario';
import { Campo, Seccion } from '../formulario/Piezas';
import { Pildora } from '../avisos/Piezas';
import { MARCA } from '../inicio/marca';
import { fallo, listo, trabajando } from '../Progreso';

const COMO = { automatico: 'solo, al reintentar', reintento: 'con «Reintentar»', a_mano: 'a mano' };

function Boton({ texto, onPress, deshabilitado, color = MARCA.azulClaro }) {
  return (
    <Pressable onPress={onPress} disabled={deshabilitado} accessibilityRole="button"
      style={({ pressed }) => ({ minHeight: 38, paddingHorizontal: 14, borderRadius: 19, justifyContent: 'center', backgroundColor: `${color}26`, opacity: deshabilitado ? 0.4 : pressed ? 0.7 : 1 })}>
      <Text style={{ color, fontSize: 14, fontWeight: '700' }}>{texto}</Text>
    </Pressable>
  );
}

export default function Traspasos({ puedeResolver }) {
  const [filas, setFilas] = useState([]);
  const [ocupado, setOcupado] = useState(null);
  const [aMano, setAMano] = useState(null);
  const [nota, setNota] = useState('');
  const cargar = useCallback(() => {
    Promise.resolve(fetchCambiosPendientes()).then((r) => setFilas(Array.isArray(r) ? r : [])).catch(() => {});
  }, []);
  useEffect(() => { cargar(); }, [cargar]);
  if (!filas.length) return null;

  const reintentar = async (f) => {
    setOcupado(f.solicitud_id); trabajando('Reintentando…');
    try {
      const r = await reintentarCambioDeCliente(f.solicitud_id, { documento: f.documento, desde: 'app' });
      if (r?.ok) listo('Puntos movidos', `La venta ${f.documento ?? ''} ya tiene sus puntos en ${f.a_nombre}.`);
      else fallo('Todavía no entra', r?.error ?? 'No se pudo mover los puntos.');
      cargar();
    } catch (e) { fallo('No se pudo reintentar', mensajeAmigable(e)); } finally { setOcupado(null); }
  };
  const cerrarAMano = (f) => Alert.alert('¿Marcar como resuelto?', 'Ya no se va a reintentar. Queda anotado lo que se hizo.', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Marcar', onPress: async () => {
      setOcupado(f.solicitud_id); trabajando('Marcando…');
      try {
        await marcarCambioResueltoAMano(f.solicitud_id, nota, { documento: f.documento, desde: 'app' });
        listo('Marcado como resuelto', 'Ya no se va a reintentar.');
        setAMano(null); setNota(''); cargar();
      } catch (e) { fallo('No se pudo marcar', mensajeAmigable(e)); } finally { setOcupado(null); }
    } },
  ]);

  return (
    <View style={{ marginHorizontal: 16 }}>
      <Seccion titulo="Puntos de cambios de cliente">
        {filas.map((f, i) => {
          const abierto = !f.resuelto_at;
          return (
            <View key={f.solicitud_id} style={{ gap: 6, paddingTop: i ? 10 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Pildora texto={abierto ? 'Sin terminar' : `Resuelto ${COMO[f.resuelto_como] ?? ''}`} color={abierto ? MARCA.rojo : MARCA.verde} />
                <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>
                  {`Venta ${f.documento ?? `#${f.invoice_id}`}${f.puntos != null ? ` · ${puntosTexto(f.puntos)} puntos` : ''}`}
                </Text>
              </View>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                {`${f.de_nombre ? `De ${f.de_nombre} a ${f.a_nombre}.` : `Para ${f.a_nombre}.`}${abierto ? ` ${puntosTexto(f.intentos)} intentos${f.ultimo_intento_at ? ` · el último, ${fechaHora12(f.ultimo_intento_at)}` : ''}` : ''}`}
              </Text>
              {abierto && f.ultimo_error ? <Text style={{ color: MARCA.rojo, fontSize: 12 }}>{`Último error: ${f.ultimo_error}`}</Text> : null}
              {!abierto && f.resuelto_como === 'a_mano' ? (
                <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`${f.resuelto_por_nombre ? `${shortEmployeeName({ name: f.resuelto_por_nombre })}: ` : ''}${f.nota ?? ''}`}</Text>
              ) : null}
              {abierto && puedeResolver ? (
                aMano === f.solicitud_id ? (
                  <View style={{ gap: 6 }}>
                    <Campo value={nota} onChangeText={(v) => setNota(v.slice(0, 300))} placeholder="Qué se hizo: le quité 40 a … y le di 40 a … desde su ficha" />
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <Boton texto="Volver" color={colorSistema.texto2} onPress={() => setAMano(null)} />
                      <Boton texto="Marcar resuelto" color={MARCA.verde} deshabilitado={!nota.trim() || ocupado === f.solicitud_id} onPress={() => cerrarAMano(f)} />
                    </View>
                  </View>
                ) : (
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Boton texto="Reintentar" deshabilitado={ocupado === f.solicitud_id} onPress={() => reintentar(f)} />
                    <Boton texto="Resolver a mano" color={MARCA.ambar} onPress={() => { setAMano(f.solicitud_id); setNota(''); }} />
                  </View>
                )
              ) : null}
            </View>
          );
        })}
      </Seccion>
    </View>
  );
}

// Corregir una lectura, o corregir/quitar una limpieza ya anotada en la
// bitácora, NATIVO — `AnotarLectura` y `AnotarLimpieza` del portal en sus modos
// de corrección.
//
// Corregir una lectura AGREGA, nunca pisa: el valor viejo queda al lado del
// nuevo con el nombre y el motivo (el «control de correcciones» de la guía,
// 3.7). Por eso el motivo es obligatorio, igual que al corregir o quitar una
// limpieza: el motivo es lo que separa una corrección de un borrado. Si la
// temperatura nueva sale del rango, se pide qué se hizo — el fuera de rango lo
// decide la base contra la misma configuración.
//
// Recibe la sala, el día, el área y el bloque, y relee el día: así la pantalla
// trabaja con lo que la base tiene AHORA y no con lo que se pintó antes.
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { anularLimpieza, corregirLectura, corregirLimpieza, fetchBitacoraDia, fueraDeRango, rotularRango } from '@nucleo/data/bitacoras';
import { alternarPunto } from '@nucleo/utils/rondaDeBitacora';
import { rango12 } from '@nucleo/utils/hora';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../componentes/formulario/Piezas';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';

const decimal = (v) => v.replace(',', '.').replace(/[^\d.-]/g, '');

export default function BitacoraCorreccion() {
  const { sala, fecha, area: areaId, clave, tipo, modo } = useLocalSearchParams();
  const puedeAnotar = useAuth().hasPermission('bitacoras', 'can_edit');
  const quitando = modo === 'quitar';
  const [dia, setDia] = useState(null);
  const [error, setError] = useState(null);
  const [temp, setTemp] = useState('');
  const [hum, setHum] = useState('');
  const [accion, setAccion] = useState('');
  const [obs, setObs] = useState('');
  const [marcadas, setMarcadas] = useState(new Set());
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    fetchBitacoraDia(sala, fecha).then(({ dia: d, error: e }) => {
      if (e) { setError(e.message || 'No se pudo cargar la bitácora.'); return; }
      setDia(d);
      const a = (d?.areas || []).find((x) => String(x.id) === String(areaId));
      if (tipo === 'lectura') {
        const l = (a?.franjas || []).find((f) => f.clave === clave)?.lectura;
        setTemp(l?.temperatura != null ? String(Number(l.temperatura)) : '');
        setHum(l?.humedad != null ? String(Number(l.humedad)) : '');
        setAccion(l?.accion_correctiva || '');
      } else {
        const r = (a?.limpiezas || []).find((t) => t.clave === clave)?.registro;
        setObs(r?.observaciones || '');
        setMarcadas(new Set((r?.puntos || []).filter((p) => p.hecho).map((p) => p.clave)));
      }
    });
  }, [sala, fecha, areaId, clave, tipo]);

  const area = useMemo(() => (dia?.areas || []).find((x) => String(x.id) === String(areaId)) ?? null, [dia, areaId]);
  const bloque = tipo === 'lectura'
    ? (area?.franjas || []).find((f) => f.clave === clave)
    : (area?.limpiezas || []).find((t) => t.clave === clave);
  const registro = tipo === 'lectura' ? bloque?.lectura : bloque?.registro;
  const fuera = tipo === 'lectura' && temp !== '' && area ? fueraDeRango(area, temp) : false;
  const sinTemp = tipo === 'lectura' && (temp === '' || Number.isNaN(Number(temp)));
  const falta = !motivo.trim() ? 'Escribe el motivo.' : (fuera && !accion.trim()) ? 'Anota qué se hizo con la temperatura fuera de rango.' : sinTemp ? 'Escribe la temperatura.' : null;
  const titulo = tipo === 'lectura' ? 'Corregir la lectura' : quitando ? 'Quitar la limpieza' : 'Corregir la limpieza';

  const guardar = async () => {
    if (falta || ocupado || !registro) return;
    setOcupado(true);
    trabajando('Guardando…');
    const contexto = { area: area?.nombre ?? null, turno: bloque?.label ?? null, fecha };
    let res;
    if (tipo === 'lectura') {
      res = await corregirLectura({ lecturaId: registro.id, temperatura: Number(temp), humedad: area.mide_humedad ? hum : null, accion, motivo: motivo.trim() });
    } else if (quitando) {
      res = await anularLimpieza({ limpiezaId: registro.id, motivo: motivo.trim() }, contexto);
    } else {
      const puntos = (area.puntos || []).map((p) => ({ clave: p.clave, hecho: marcadas.has(p.clave) }));
      res = await corregirLimpieza({ limpiezaId: registro.id, puntos, observaciones: obs, motivo: motivo.trim() }, contexto);
    }
    setOcupado(false);
    if (res?.error) { fallo('No se pudo guardar', String(res.error)); return; }
    listo(quitando ? 'Limpieza quitada' : 'Corrección guardada', `${area?.nombre ?? ''} · ${bloque?.label ?? ''}`);
    router.back();
  };
  const confirmar = () => (quitando
    ? Alert.alert('¿Quitar la limpieza?', 'El registro se va del libro y el turno vuelve a quedar pendiente. Queda anotado quién lo quitó y por qué.', [
      { text: 'Cancelar', style: 'cancel' }, { text: 'Quitar', style: 'destructive', onPress: guardar },
    ])
    : guardar());

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: titulo }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? undefined : 'height'}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
          contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          {error ? <Aviso tono="freno" texto={error} /> : !dia ? <ActivityIndicator style={{ marginTop: 30 }} /> : !area || !registro ? (
            <Aviso tono="cuidado" texto="Ese registro ya no está: puede que alguien lo haya quitado o cambiado. Vuelve y recarga." />
          ) : !puedeAnotar || dia.cerrado ? (
            <Aviso tono="freno" texto={dia.cerrado ? 'Este mes ya está cerrado y firmado. Para corregir hay que reabrirlo desde el Cierre de mes.' : 'Corregir la bitácora es de quien la anota.'} />
          ) : (
            <>
              <View style={{ marginHorizontal: 4 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '700' }}>{area.nombre}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>
                  {`${bloque.label} (${rango12(bloque.desde, bloque.hasta)})${tipo === 'lectura' ? ` · ${rotularRango(area)}` : ''}`}
                </Text>
              </View>
              {quitando ? (
                <Aviso tono="cuidado" texto="El registro se va del libro y el turno vuelve a aparecer como pendiente. Queda anotado quién lo quitó y por qué." />
              ) : (
                <Aviso tono="nota" texto={tipo === 'lectura' ? 'El valor anterior no se borra: queda junto al nuevo, con tu nombre y el motivo.' : 'Queda dicho que se corrigió, con tu nombre y el motivo.'} />
              )}
              {tipo === 'lectura' ? (
                <Seccion titulo={area.mide_humedad ? 'Temperatura °C · Humedad % HR (informativa)' : 'Temperatura °C'}>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <Campo multiline={false} value={temp} onChangeText={(v) => setTemp(decimal(v))} keyboardType="decimal-pad" placeholder="°C"
                        style={{ textAlign: 'center', fontSize: 22, fontWeight: '800', color: fuera ? MARCA.rojo : colorSistema.texto }} />
                    </View>
                    {area.mide_humedad ? (
                      <View style={{ flex: 1 }}>
                        <Campo multiline={false} value={hum} onChangeText={(v) => setHum(decimal(v))} keyboardType="decimal-pad" placeholder="% HR"
                          style={{ textAlign: 'center', fontSize: 22, fontWeight: '800' }} />
                      </View>
                    ) : null}
                  </View>
                </Seccion>
              ) : null}
              {fuera ? (
                <Seccion titulo="Qué se hizo" pie="Fuera de rango: una lectura sin acción al lado prueba que se vio y no se actuó.">
                  <Campo value={accion} onChangeText={setAccion} maxLength={300} placeholder="Se encendió el aire y se bajó la persiana. Recontrolado a las 13:40 en 28.1 °C." />
                </Seccion>
              ) : null}
              {tipo === 'limpieza' && !quitando ? (
                <>
                  {(area.puntos || []).length ? (
                    <Seccion titulo="Qué se limpió">
                      {area.puntos.map((p, i) => (
                        <Pressable key={p.clave} onPress={() => { Haptics.selectionAsync().catch(() => {}); setMarcadas((m) => alternarPunto(m, p.clave)); }}
                          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: 44, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, opacity: pressed ? 0.6 : 1 })}>
                          <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>{p.label || 'Sin nombre'}</Text>
                          <Text style={{ color: marcadas.has(p.clave) ? MARCA.verde : colorSistema.texto2, fontSize: 19, fontWeight: '700' }}>{marcadas.has(p.clave) ? '✓' : '○'}</Text>
                        </Pressable>
                      ))}
                    </Seccion>
                  ) : null}
                  <Seccion titulo="Observaciones (opcional)">
                    <Campo value={obs} onChangeText={setObs} maxLength={300} placeholder="Sólo si hay algo que anotar" />
                  </Seccion>
                </>
              ) : null}
              <Seccion titulo={quitando ? 'Por qué se quita' : 'Motivo de la corrección'}>
                <Campo value={motivo} onChangeText={setMotivo} maxLength={300}
                  placeholder={quitando ? 'Se marcó por error: la limpieza todavía no se había hecho.' : tipo === 'lectura' ? 'Se anotó 26 en vez de 28 por error de tipeo.' : 'Faltó marcar el estante del fondo.'} />
              </Seccion>
              {falta && motivo ? <Aviso tono="cuidado" texto={falta} /> : null}
              <BotonGrande texto={ocupado ? 'Guardando…' : quitando ? 'Quitar' : 'Guardar la corrección'} color={quitando ? MARCA.rojo : MARCA.azul}
                deshabilitado={ocupado || !!falta} onPress={confirmar} />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

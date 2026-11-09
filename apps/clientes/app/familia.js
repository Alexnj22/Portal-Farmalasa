// Mi familia (2026-11-09): personas a cargo del titular —nombre o apodo y
// parentesco, sin DUI— para indicar de quién es cada tratamiento. La cuenta y
// los puntos siguen siendo del titular. Quitar a alguien borra su fila.
// Cerrada hasta publicar el aviso de privacidad: el servidor manda
// `familia_abierta` y sin eso no hay fila en Cuenta ni acciones.
import { useCallback, useState } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Presionable from '../componentes/Presionable';
import Icono from '../componentes/Icono';
import { Boton, Cargando, Pantalla, Seccion, Tarjeta, Vacio } from '../componentes/ui';
import { colorSistema } from '../componentes/sistema';
import { useSesion } from '../lib/sesion';
import { suave, useTema } from '../tema/tema';

const PARENTESCOS = [['hijo', 'Hijo o hija'], ['padre_madre', 'Papá o mamá'], ['abuelo', 'Abuelo o abuela'], ['conyuge', 'Pareja'], ['otro', 'Otro']];
const rotulo = (k) => PARENTESCOS.find(([v]) => v === k)?.[1] ?? '';

export default function Familia() {
  const t = useTema();
  const pedir = useSesion((s) => s.pedir);
  const [d, setD] = useState(null);
  const [nombre, setNombre] = useState('');
  const [parentesco, setParentesco] = useState(null);
  const [autoriza, setAutoriza] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => { setD(await pedir('familia_lista')); }, [pedir]);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const agregar = async () => {
    if (guardando) return;
    setGuardando(true);
    const r = await pedir('familia_agregar', { nombre: nombre.trim(), parentesco, autoriza });
    setGuardando(false);
    if (!r?.ok) { Alert.alert('No se pudo agregar', r?.mensaje ?? 'Revisa tu conexión e intenta de nuevo.'); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setNombre(''); setParentesco(null); setAutoriza(false);
    cargar();
  };
  const quitar = (f) => Alert.alert(`Quitar a ${f.nombre}`, 'Se borra definitivamente. Sus tratamientos quedan a tu nombre.', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Quitar', style: 'destructive', onPress: async () => {
      const r = await pedir('familia_quitar', { id: f.id });
      if (!r?.ok) { Alert.alert('No se pudo quitar', r?.mensaje ?? 'Revisa tu conexión e intenta de nuevo.'); return; }
      cargar();
    } },
  ]);

  if (!d) return <Pantalla conPestanas={false}><Cargando /></Pantalla>;
  if (!d.ok) return <Pantalla conPestanas={false}><Vacio titulo="No disponible">{d.mensaje ?? 'Intenta de nuevo más tarde.'}</Vacio></Pantalla>;
  const lista = d.familiares ?? [];
  const superficie = t.oscuro ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';
  const listo = nombre.trim().length > 0 && parentesco && autoriza;
  return (
    <Pantalla conPestanas={false}>
      <Seccion>Personas a tu cargo</Seccion>
        {lista.length ? lista.map((f) => (
          <Tarjeta key={f.id} estilo={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: colorSistema.texto }}>{f.nombre}</Text>
              <Text style={{ fontSize: 13, color: colorSistema.texto2 }}>{rotulo(f.parentesco)}</Text>
            </View>
            <Presionable onPress={() => quitar(f)} accessibilityRole="button" accessibilityLabel={`Quitar a ${f.nombre}`}
              style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
              <Icono sf="trash" respaldo="×" tam={18} color={t.color.magentaTexto} />
            </Presionable>
          </Tarjeta>
        )) : <Vacio titulo="Todavía no hay nadie">Agrega a quienes les compras sus medicinas y organiza sus tratamientos.</Vacio>}
      {lista.length < 10 ? (
        <>
          <Seccion>Agregar</Seccion>
          <Tarjeta estilo={{ gap: 12 }}>
            <TextInput value={nombre} onChangeText={setNombre} placeholder="Nombre o apodo" placeholderTextColor={colorSistema.texto3} maxLength={40}
              accessibilityLabel="Nombre o apodo" style={{ minHeight: 48, borderRadius: 14, paddingHorizontal: 14, fontSize: 16, color: colorSistema.texto, backgroundColor: superficie }} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {PARENTESCOS.map(([v, l]) => {
                const si = parentesco === v;
                return (
                  <Presionable key={v} onPress={() => setParentesco(v)} accessibilityRole="button" accessibilityState={{ selected: si }}
                    style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 999, backgroundColor: si ? t.color.magenta : suave(t.color.magenta, t.oscuro ? 0.22 : 0.1) }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: si ? '#FFFFFF' : t.color.magentaTexto }}>{l}</Text>
                  </Presionable>
                );
              })}
            </View>
            <Presionable onPress={() => setAutoriza((a) => !a)} accessibilityRole="checkbox" accessibilityState={{ checked: autoriza }}
              style={{ flexDirection: 'row', gap: 10, alignItems: 'center', minHeight: 44 }}>
              <Icono sf={autoriza ? 'checkmark.square.fill' : 'square'} respaldo={autoriza ? '☑' : '☐'} tam={22} color={t.color.magentaTexto} />
              <Text style={{ flex: 1, fontSize: 14, color: colorSistema.texto }}>Es menor de edad a mi cargo, o me autorizó a gestionar sus medicamentos.</Text>
            </Presionable>
            <Boton alTocar={agregar} cargando={guardando} deshabilitado={!listo}>Agregar</Boton>
          </Tarjeta>
        </>
      ) : null}
    </Pantalla>
  );
}

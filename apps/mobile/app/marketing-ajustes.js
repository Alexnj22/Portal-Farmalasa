// Ajustes del calendario de marketing, NATIVO — `AjustesModal` del portal:
//   · el día límite para enviar el mes siguiente y el recordatorio de las 8:00
//     (los cambia quien aprueba el calendario);
//   · las fechas especiales (prender/apagar, agregar con su idea) — las cuidan
//     los dos;
//   · las marcas (agregar con el primer color libre, prender/apagar) y las
//     redes (prender/apagar) — quien edita.
// Apagar algo lo saca de los formularios sin tocar lo ya planificado. Las
// escrituras son las del portal (`data/marketing`).
import { useCallback, useEffect, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import {
  activarRed, fetchAjustes, fetchCatalogos, fetchFechasEspeciales, guardarAjustes, guardarFechaEspecial, guardarMarca,
} from '@nucleo/data/marketing';
import { DIAS_LIMITE_DE_ENVIO, colorLibreDeMarca, diaDeFechaValido, fechaEspecialEn } from '@nucleo/utils/marketing';
import { NOMBRES_DE_MES, fechaTexto } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../componentes/formulario/Piezas';
import { MARCA } from '../componentes/inicio/marca';
import { fallo } from '../componentes/Progreso';

function Fila({ titulo, detalle, valor, onCambiar, deshabilitado }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{titulo}</Text>
        {detalle ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{detalle}</Text> : null}
      </View>
      <Switch value={!!valor} disabled={deshabilitado} onValueChange={onCambiar} />
    </View>
  );
}

export default function AjustesDeMarketing() {
  const { hasPermission } = useAuth();
  const puedeEditar = hasPermission('marketing', 'can_edit');
  const puedeAprobar = hasPermission('marketing', 'can_approve');
  const [datos, setDatos] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [nueva, setNueva] = useState('');
  const [fecha, setFecha] = useState({ nombre: '', mes: '', dia: '', idea: '' });
  const anio = new Date().getFullYear();

  const cargar = useCallback(async () => {
    try {
      const [c, a, f] = await Promise.all([fetchCatalogos(), fetchAjustes(), fetchFechasEspeciales()]);
      setDatos({ marcas: c.marcas, redes: c.redes, ajustes: a, fechas: f });
    } catch (e) { fallo('No se pudieron cargar los ajustes', mensajeAmigable(e)); setDatos({ marcas: [], redes: [], ajustes: null, fechas: [] }); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga de datos

  const intentar = async (fn) => {
    setGuardando(true);
    try { await fn(); await cargar(); }
    catch (e) { fallo('No se pudo guardar', mensajeAmigable(e, 'Intenta de nuevo.')); }
    setGuardando(false);
  };
  const confirmar = (titulo, texto, fn) => Alert.alert(titulo, texto, [{ text: 'Cancelar', style: 'cancel' }, { text: 'Guardar', onPress: () => intentar(fn) }]);

  if (!datos) return <ActivityIndicator style={{ marginTop: 32 }} />;
  const { marcas, redes, ajustes, fechas } = datos;
  const elegirDia = () => ActionSheetIOS.showActionSheetWithOptions(
    { title: 'Fecha límite para enviar el mes siguiente', options: [...DIAS_LIMITE_DE_ENVIO.map((d) => `Día ${d}`), 'Cancelar'], cancelButtonIndex: DIAS_LIMITE_DE_ENVIO.length },
    (i) => { if (i < DIAS_LIMITE_DE_ENVIO.length) confirmar('Fecha límite', `El mes siguiente se envía hasta el día ${DIAS_LIMITE_DE_ENVIO[i]}.`, () => guardarAjustes({ dia_limite_envio: DIAS_LIMITE_DE_ENVIO[i] })); });
  const elegirMes = () => ActionSheetIOS.showActionSheetWithOptions(
    { title: 'Mes', options: [...NOMBRES_DE_MES, 'Cancelar'], cancelButtonIndex: 12 },
    (i) => { if (i < 12) setFecha((x) => ({ ...x, mes: i + 1 })); });

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Ajustes de marketing' }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag">
        <Seccion titulo="El calendario" pie={!puedeAprobar ? 'Los cambia quien aprueba el calendario.' : null}>
          <Pressable disabled={!puedeAprobar || guardando} onPress={elegirDia} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44 }}>
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>Fecha límite para enviar el mes siguiente</Text>
            <Text style={{ color: puedeAprobar ? MARCA.azulClaro : colorSistema.texto2, fontSize: 15, fontWeight: '600' }}>{`Día ${ajustes?.dia_limite_envio ?? 20}`}</Text>
          </Pressable>
          <Fila titulo="Recordatorio de las 8:00" detalle="Lo de hoy, lo vencido y la fecha límite" valor={ajustes?.recordatorios_activos ?? true} deshabilitado={!puedeAprobar || guardando}
            onCambiar={(on) => confirmar(on ? 'Prender recordatorios' : 'Apagar recordatorios', on ? 'Vuelve el aviso de las 8:00.' : 'Ya no llega el aviso de las 8:00.', () => guardarAjustes({ recordatorios_activos: on }))} />
        </Seccion>

        <Seccion titulo="Fechas especiales">
          {fechas.map((f) => {
            const d = fechaEspecialEn(f, anio);
            return (
              <Fila key={f.id} titulo={f.nombre} detalle={`${d ? fechaTexto(d, { day: 'numeric', month: 'long' }) : '—'}${f.regla ? ' (cambia cada año)' : ''}${f.idea ? ` · ${f.idea}` : ''}`}
                valor={f.activo} deshabilitado={!(puedeEditar || puedeAprobar) || guardando} onCambiar={(on) => intentar(() => guardarFechaEspecial({ ...f, activo: on }))} />
            );
          })}
          {puedeEditar || puedeAprobar ? (
            <View style={{ gap: 8, borderTopWidth: 0.5, borderTopColor: colorSistema.separador, paddingTop: 10 }}>
              <Campo multiline={false} placeholder="Nueva fecha (ej. Día del Padre)" value={fecha.nombre} onChangeText={(t) => setFecha((x) => ({ ...x, nombre: t }))} />
              <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                <Pressable onPress={elegirMes} hitSlop={8} style={{ minHeight: 40, justifyContent: 'center' }}>
                  <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '600' }}>{fecha.mes ? NOMBRES_DE_MES[fecha.mes - 1] : 'Mes ▾'}</Text>
                </Pressable>
                <Campo multiline={false} keyboardType="number-pad" placeholder="Día" value={String(fecha.dia)} onChangeText={(t) => setFecha((x) => ({ ...x, dia: t.replace(/\D/g, '') }))} style={{ width: 80 }} />
              </View>
              <Campo multiline={false} placeholder="Idea (opcional)" value={fecha.idea} onChangeText={(t) => setFecha((x) => ({ ...x, idea: t }))} />
              <BotonGrande texto="Agregar fecha" borde color={MARCA.azulClaro} deshabilitado={!fecha.nombre.trim() || !fecha.mes || !diaDeFechaValido(fecha.dia) || guardando}
                onPress={() => intentar(async () => {
                  await guardarFechaEspecial({ nombre: fecha.nombre, mes: Number(fecha.mes), dia: Number(fecha.dia), idea: fecha.idea });
                  setFecha({ nombre: '', mes: '', dia: '', idea: '' });
                })} />
            </View>
          ) : null}
        </Seccion>

        <Seccion titulo="Marcas" pie={!puedeEditar ? 'Las cambia quien edita el calendario.' : null}>
          {marcas.map((m) => (
            <Fila key={m.id} titulo={m.nombre} valor={m.activo} deshabilitado={!puedeEditar || guardando} onCambiar={(on) => intentar(() => guardarMarca({ ...m, activo: on }))} />
          ))}
          {puedeEditar ? (
            <View style={{ gap: 8, borderTopWidth: 0.5, borderTopColor: colorSistema.separador, paddingTop: 10 }}>
              <Campo multiline={false} placeholder="Nueva marca" value={nueva} onChangeText={setNueva} />
              <BotonGrande texto="Agregar marca" borde color={MARCA.azulClaro} deshabilitado={!nueva.trim() || guardando}
                onPress={() => intentar(async () => { await guardarMarca({ nombre: nueva, color: colorLibreDeMarca(marcas), activo: true, orden: marcas.length + 1 }); setNueva(''); })} />
            </View>
          ) : null}
        </Seccion>

        <Seccion titulo="Redes">
          {redes.map((r) => (
            <Fila key={r.clave} titulo={r.nombre} valor={r.activo} deshabilitado={!puedeEditar || guardando} onCambiar={(on) => intentar(() => activarRed(r.clave, on))} />
          ))}
        </Seccion>
        <Aviso texto="Apagar algo lo saca de los formularios sin tocar lo ya planificado." />
      </ScrollView>
    </>
  );
}

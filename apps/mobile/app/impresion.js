// Prueba de impresión, NATIVO — `ImpresionView` + `CajasDeImpresion`.
//
// El portal prueba la ticketera de ESA computadora. El teléfono no tiene una
// enchufada: su papel sale por la caja de la sala (la cola que lee el agente),
// por AirPrint o como PDF. Así que acá la prueba es la misma hoja (el ticket de
// prueba del núcleo) por esos tres caminos, más todo lo de las cajas de las
// salas, que es lo que de verdad dice si va a salir papel: su latido, si su
// agente está al día, «Probar», agregar una caja (el código de 15 minutos) y
// quitarla, y lo último que se mandó con su motivo si no salió.
//
// Lo que sólo existe en un navegador —el envío directo a la ticketera de la
// computadora y el sistema Linux/Windows de esa caja— queda en el portal.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Platform, Pressable, RefreshControl, ScrollView, Share, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { ANCHOS_ROLLO, conCodigosDibujados, construirTicketHtml, guardarAjustesDeImpresion, leerAjustesDeImpresion, construirTicketDePruebaDeCaja, textoParaElRollo, ticketEnBase64 } from '@nucleo/utils/ticketPrint';
import {
  ESTADOS_DE_LA_COLA, LINEA_DE_ACTUALIZAR, avisoAlQuitarCaja, codigoPartido, estadoDelAgente, latidoMostrado, ticketDePruebaDeImpresion,
} from '@nucleo/utils/pruebaDeImpresion';
import {
  crearCodigoDeVinculacion, eliminarCajaDeImpresion, encolarImpresion, fetchCajasDeImpresion, fetchColaDeImpresion, fetchVersionPublicadaDelAgente,
} from '@nucleo/data/impresion';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { APP_VERSION } from '@nucleo/version';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Opciones, Seccion } from '../componentes/formulario/Piezas';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo } from '../componentes/Progreso';
import { compartirPdf, imprimirPapel } from '../componentes/pdf';
import { imprimirEnLaSala } from '../componentes/imprimir';
import VistaPapel from '../componentes/torogoz/fiscal/VistaPapel';

const VACIO = [];
const TONO = { neutro: colorSistema.texto2, bien: MARCA.verde, mal: MARCA.rojo };
const desde = () => `App en ${Platform.OS === 'ios' ? 'iPhone o iPad' : 'Android'}`;

function Enlace({ texto, color = MARCA.azulClaro, onPress, deshabilitado }) {
  return (
    <Pressable onPress={onPress} disabled={deshabilitado} hitSlop={8} accessibilityRole="button"
      style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', paddingHorizontal: 6, opacity: deshabilitado ? 0.4 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
      <Text style={{ color, fontSize: 15, fontWeight: '600' }}>{texto}</Text>
    </Pressable>
  );
}

export default function Impresion() {
  const { user, hasPermission } = useAuth();
  const puedeEditar = hasPermission?.('impresion', 'can_edit');
  const sucursales = useStaffStore((s) => s.branches) ?? VACIO;
  const sucursal = useMemo(() => sucursales.find((b) => b.id === user?.branchId), [sucursales, user]);
  const nombreSala = useMemo(() => Object.fromEntries(sucursales.map((b) => [b.id, b.name])), [sucursales]);

  const [ancho, setAncho] = useState(() => leerAjustesDeImpresion().ancho);
  const [html, setHtml] = useState(null);
  const [cajas, setCajas] = useState([]);
  const [falloLaLista, setFalloLaLista] = useState(null);
  const [cola, setCola] = useState([]);
  const [publicada, setPublicada] = useState(null);
  const [probando, setProbando] = useState(null);
  const [mandando, setMandando] = useState(false);
  const [sala, setSala] = useState(null);
  const [nombre, setNombre] = useState('');
  const [nueva, setNueva] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [recargando, setRecargando] = useState(false);

  const ticket = useMemo(() => ticketDePruebaDeImpresion({ ancho, sucursal, quien: user?.name, desde: desde(), version: APP_VERSION }), [ancho, sucursal, user]);
  useEffect(() => {
    let vivo = true;
    conCodigosDibujados(ticket).then((t) => { if (vivo) setHtml(construirTicketHtml(t)); }).catch(() => { if (vivo) setHtml(construirTicketHtml(ticket)); });
    return () => { vivo = false; };
  }, [ticket]);

  const cargar = useCallback(async () => {
    const [{ cajas: filas, error }, c, p] = await Promise.all([
      Promise.resolve(fetchCajasDeImpresion()).catch((e) => ({ cajas: [], error: e })),
      Promise.resolve(fetchColaDeImpresion({ limite: 15 })).catch(() => []),
      Promise.resolve(fetchVersionPublicadaDelAgente()).catch(() => null),
    ]);
    setCajas(filas || []); setFalloLaLista(error || null); setCola(c || []); setPublicada(p);
  }, []);
  useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial

  const cambiarAncho = (mm) => { const n = Number(mm); setAncho(n); guardarAjustesDeImpresion({ ...leerAjustesDeImpresion(), ancho: n }); };

  const aLaSala = async () => {
    if (!user?.branchId) { fallo('Sin sala', 'Tu ficha no tiene una sala asignada: no hay a qué caja mandarlo.'); return; }
    setMandando(true);
    const r = await imprimirEnLaSala(ticket, user.branchId, 'Prueba de impresión');
    setMandando(false);
    if (!r.ok) { fallo('No se mandó', r.detalle); return; }
    listo('Mandado a la caja', `${r.detalle} Abajo dice qué contestó.`);
    setTimeout(cargar, 5000);
  };
  const airprint = () => Promise.resolve(html && imprimirPapel(html)).catch((e) => fallo('No se imprimió', e?.message || ''));
  const comoPdf = () => Promise.resolve(html && compartirPdf({ html, nombre: 'Prueba de impresión' })).catch((e) => fallo('No se compartió', e?.message || ''));

  const probar = async (c) => {
    if (probando) return;
    setProbando(c.id);
    const salaDeLaCaja = nombreSala[c.branch_id] || `Sucursal ${c.branch_id}`;
    const { error } = await Promise.resolve(encolarImpresion({
      branchId: c.branch_id, titulo: 'PRUEBA DE LA CAJA',
      contenidoB64: ticketEnBase64(textoParaElRollo(construirTicketDePruebaDeCaja({ caja: c.nombre, sala: salaDeLaCaja, quien: user?.name || '', version: APP_VERSION }))),
    })).catch((e) => ({ error: e }));
    if (error) { setProbando(null); fallo('No se pudo mandar la prueba', mensajeAmigable(error, 'Vuelve a intentar.')); return; }
    listo('Mandado a la caja', `Mira si sale papel en ${salaDeLaCaja}. Abajo dice qué contestó.`);
    await new Promise((r) => setTimeout(r, 5000));
    await cargar();
    setProbando(null);
  };

  const quitar = (c) => Alert.alert(`¿Quitar «${c.nombre}»?`, avisoAlQuitarCaja(c, nombreSala[c.branch_id]), [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Sí, quitar', style: 'destructive', onPress: async () => {
      const { data, error } = await Promise.resolve(eliminarCajaDeImpresion(c.id, { branchId: c.branch_id, nombre: c.nombre, sala: nombreSala[c.branch_id] || c.branch_id, equipo: c.equipo })).catch((e) => ({ error: e }));
      if (error) { fallo('No se pudo quitar', mensajeAmigable(error, 'Vuelve a intentar.')); return; }
      listo('Caja quitada', `Ya no aparece «${data || c.nombre}».`);
      cargar();
    } },
  ]);

  const registrar = () => {
    if (!sala || !nombre.trim() || guardando) return;
    Alert.alert('Generar el código', `Para «${nombre.trim()}» en ${nombreSala[sala] || 'esa sala'}. Dura 15 minutos y se usa una sola vez.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Generar', onPress: async () => {
        setGuardando(true);
        const { data, error } = await Promise.resolve(crearCodigoDeVinculacion({ branchId: Number(sala), nombre: nombre.trim() })).catch((e) => ({ error: e }));
        setGuardando(false);
        if (error) { fallo('No se pudo generar el código', mensajeAmigable(error, 'Vuelve a intentar.')); return; }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        setNueva(data?.[0] || null); setNombre(''); cargar();
      } },
    ]);
  };

  const hayAtrasadas = cajas.some((c) => estadoDelAgente(c, publicada)?.mal);
  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Prueba de impresión', headerLargeTitle: true }} />
      <ScrollView style={{ flex: 1 }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingVertical: 8, paddingBottom: 48, gap: 16 }} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <Seccion titulo="El rollo" pie="Es un ajuste de este teléfono: el ancho del papel con el que se arma lo que imprime.">
          <Opciones opciones={ANCHOS_ROLLO.map((a) => ({ id: String(a.mm), label: `${a.mm} mm` }))} valor={String(ancho)} onCambiar={cambiarAncho} />
        </Seccion>

        <Seccion titulo="Imprimir el ticket de prueba" pie="A la caja: sale por la ticketera de tu sala (recibido no es lo mismo que impreso: abajo dice qué contestó). AirPrint y PDF: desde este teléfono.">
          <BotonGrande texto={mandando ? 'Mandando…' : `Mandar a la caja de ${sucursal?.name || 'mi sala'}`} onPress={aLaSala} deshabilitado={mandando} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}><BotonGrande texto="AirPrint" borde onPress={airprint} deshabilitado={!html} /></View>
            <View style={{ flex: 1 }}><BotonGrande texto="Compartir PDF" borde onPress={comoPdf} deshabilitado={!html} /></View>
          </View>
        </Seccion>

        <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', marginHorizontal: 32 }}>Cómo va a salir</Text>
        <VistaPapel html={html} alto={520} ancho={ancho >= 76 ? 320 : 240} />

        <Seccion titulo="Cajas de las salas" pie="«Registrada» no es «funciona»: lo que dice si va a salir papel es cuándo preguntó la caja por última vez. «Probar» gasta un papel en esa caja.">
          {falloLaLista ? <Aviso tono="freno" texto={`No se pudo leer la lista de cajas. Esto NO significa que no haya ninguna: las registradas pueden estar imprimiendo igual. ${mensajeAmigable(falloLaLista, '')}`} /> : null}
          {!cajas.length && !falloLaLista ? <Aviso texto="Ninguna sala imprime todavía: sin una caja registrada, un documento mandado desde el teléfono no tiene dónde salir." /> : null}
          {cajas.map((c, i) => {
            const latido = latidoMostrado(c);
            const agente = estadoDelAgente(c, publicada);
            return (
              <View key={c.id} style={{ borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, paddingTop: i ? 9 : 0, gap: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>{c.nombre}</Text>
                  <Text style={{ color: latido.vivo ? MARCA.verde : colorSistema.texto2, fontSize: 13, fontWeight: '700' }}>{latido.txt}</Text>
                </View>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={1}>{`${nombreSala[c.branch_id] || `Sucursal ${c.branch_id}`}${c.impresora ? ` · ${c.impresora}` : ''}`}</Text>
                {agente ? <Text style={{ color: agente.mal ? MARCA.rojo : colorSistema.texto2, fontSize: 12, fontWeight: agente.mal ? '700' : '400' }}>{agente.txt}</Text> : null}
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  <Enlace texto={probando === c.id ? 'Probando…' : 'Probar'} onPress={() => probar(c)} deshabilitado={!c.vinculada_at || (!!probando && probando !== c.id)} />
                  {puedeEditar ? <Enlace texto="Quitar" color={MARCA.rojo} onPress={() => quitar(c)} /> : null}
                </View>
              </View>
            );
          })}
        </Seccion>

        {hayAtrasadas ? (
          <Seccion titulo="Hay cajas que poner al día" pie="En la computadora de esa caja, abre una terminal y pega esta línea. No cambia la configuración de la caja, sólo el programa; después se actualiza sola.">
            <Text selectable style={{ color: colorSistema.texto, fontSize: 12, fontFamily: 'Menlo' }}>{LINEA_DE_ACTUALIZAR}</Text>
            <Enlace texto="Compartir la línea" onPress={() => Share.share({ message: LINEA_DE_ACTUALIZAR }).catch(() => {})} />
          </Seccion>
        ) : null}

        {nueva ? (
          <Seccion titulo="Escribe este código en la computadora de la caja" pie="En esa computadora, abre una terminal y escribe «bash instalar.sh»: te va a pedir este código. Dura 15 minutos y se usa una sola vez.">
            <Text selectable style={{ color: colorSistema.texto, fontSize: 32, fontWeight: '900', letterSpacing: 6, fontFamily: 'Menlo', textAlign: 'center' }}>{codigoPartido(nueva.codigo)}</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 10 }}>
              <Enlace texto="Compartir" onPress={() => Share.share({ message: nueva.codigo }).catch(() => {})} />
              <Enlace texto="Listo" onPress={() => setNueva(null)} />
            </View>
          </Seccion>
        ) : null}

        {puedeEditar ? (
          <Seccion titulo="Agregar una caja" pie="La ticketera no se pregunta acá: la encuentra el instalador en la propia computadora.">
            <Opciones opciones={sucursales.map((b) => ({ id: String(b.id), label: b.name }))} valor={sala} onCambiar={setSala} />
            <Campo multiline={false} value={nombre} onChangeText={setNombre} placeholder="Nombre (p. ej. Caja Salud 3)" />
            <BotonGrande texto={guardando ? 'Generando…' : 'Generar el código'} onPress={registrar} deshabilitado={!sala || !nombre.trim() || guardando} />
          </Seccion>
        ) : null}

        {cola.length ? (
          <Seccion titulo="Lo último que se mandó">
            {cola.map((j, i) => {
              const e = ESTADOS_DE_LA_COLA[j.estado] || ESTADOS_DE_LA_COLA.PENDIENTE;
              return (
                <View key={j.id} style={{ borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, paddingTop: i ? 7 : 0, gap: 2 }}>
                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                    <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14 }} numberOfLines={1}>{j.titulo}</Text>
                    <Text style={{ color: TONO[e.tono], fontSize: 13, fontWeight: '700' }}>{e.txt}</Text>
                  </View>
                  <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{nombreSala[j.branch_id] || j.branch_id}</Text>
                  {j.error ? <Text style={{ color: MARCA.rojo, fontSize: 12 }}>{j.error}</Text> : null}
                </View>
              );
            })}
          </Seccion>
        ) : null}
      </ScrollView>
    </>
  );
}

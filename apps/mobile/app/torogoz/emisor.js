// Torogoz · Empresa, NATIVO — la pestaña Empresa del portal (`TabEmisor`): los
// datos de la S.A.S. que factura. Salen impresos en cada documento, y el NIT,
// el NRC y la actividad tienen que ser EXACTAMENTE los de su registro en
// Hacienda: si no coinciden, rechaza todo lo que se emita. Sólo la edita quien
// configura la distribuidora; los demás la ven.
//
// El certificado de firma y la contraseña de Hacienda NO se escriben acá: son
// secretos del servidor. Pasar de Pruebas a Producción pide una confirmación
// aparte, porque desde ahí cada documento es fiscal. Las reglas y la fila que
// se guarda salen del núcleo (`distribucionComercial`).
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import useBorrador from '@nucleo/hooks/useBorrador';
import { fetchPuntosVenta, guardarEmisor, mensajeDeDistribucion } from '@nucleo/data/distribucion';
import { anotar } from '@nucleo/data/audit';
import {
  EMISOR_VACIO, TIPO_ESTABLECIMIENTO, emisorAFormulario, emisorParaGuardar, erroresDeEmisor,
} from '@nucleo/utils/distribucionComercial';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema, Formulario } from '../../componentes/Formulario';
import { BotonGrande, Seccion } from '../../componentes/formulario/Piezas';
import { CampoConRotulo, Rotulo } from '../../componentes/personas/Formulario';
import Segmentos from '../../componentes/Segmentos';
import Avatar from '../../componentes/Avatar';
import { fallo, listo, trabajando } from '../../componentes/Progreso';
import {
  ElegirActividad, ElegirLargo, ElegirUbicacion, Interruptor, Nota, PETROLEO, useEmisor,
} from '../../componentes/torogoz/comercial/Piezas';

// Un punto de venta por vendedor: se crea solo la primera vez que emite.
function PuntosDeVenta({ emisorId, oficina }) {
  const [puntos, setPuntos] = useState(null);
  useEffect(() => {
    if (!emisorId) return undefined;
    let vivo = true;
    fetchPuntosVenta(emisorId).then((p) => { if (vivo) setPuntos(p); }).catch(() => { if (vivo) setPuntos([]); });
    return () => { vivo = false; };
  }, [emisorId]);
  return (
    <Seccion titulo="Puntos de venta"
      pie="Cada vendedor recibe su punto de venta la primera vez que factura. El número de los documentos es uno solo por establecimiento, como pide Hacienda.">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40 }}>
        <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'], minWidth: 52 }}>{oficina}</Text>
        <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>Oficina</Text>
      </View>
      {puntos === null && emisorId ? <ActivityIndicator /> : null}
      {(puntos ?? []).map((p) => (
        <View key={p.codigo} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40, borderTopWidth: 0.5, borderTopColor: colorSistema.separador, paddingTop: 8 }}>
          <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'], minWidth: 52 }}>{p.codigo}</Text>
          <Avatar empleado={p.empleado} tamano={26} />
          <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 15 }}>{shortEmployeeName(p.empleado)}</Text>
        </View>
      ))}
    </Seccion>
  );
}

export default function EmisorTorogoz() {
  const { hasPermission } = useAuth();
  const puede = !!hasPermission?.('distribucion_config', 'can_edit');
  const ro = !puede;
  const { emisor, recargar } = useEmisor();
  const [f, setF] = useState(EMISOR_VACIO);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [intento, setIntento] = useState(false);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  // Al llegar la empresa (o cambiar en la base), el formulario toma sus datos.
  // Releerla al volver a la pantalla trae un objeto nuevo con lo mismo: eso NO
  // pisa lo que se está escribiendo.
  const huella = emisor === undefined ? null : JSON.stringify(emisor);
  useEffect(() => { if (huella !== null) setF(emisorAFormulario(JSON.parse(huella))); }, [huella]);

  // Sólo el alta guarda borrador: al editar, los datos ya están en la base.
  const { recuperado, descartar } = useBorrador(emisor === null && puede ? 'distribucion-emisor' : null, f,
    { activo: emisor === null, vale: (v) => !!v?.nombre?.trim() });
  const repuesto = useRef(false);
  useEffect(() => {
    if (repuesto.current || !recuperado || emisor) return;
    repuesto.current = true;
    setF({ ...EMISOR_VACIO, ...recuperado });
  }, [recuperado, emisor]);

  const errores = useMemo(() => erroresDeEmisor(f), [f]);
  const lista = Object.values(errores);
  const pasaAProduccion = !!emisor && emisor.ambiente === '00' && f.ambiente === '01';
  const ver = (k) => (intento || f[k] ? errores[k] : undefined);

  const escribir = async () => {
    setGuardando(true); setError('');
    trabajando('Guardando los datos de la empresa…');
    try {
      await guardarEmisor(emisor?.id, emisorParaGuardar(f));
      anotar('DISTRIBUCION_EMISOR', emisor ? String(emisor.id) : 'nuevo',
        { ambiente: f.ambiente, antes: emisor ? { ambiente: emisor.ambiente, nit: emisor.nit } : null });
      descartar();
      listo('Datos de la empresa guardados', '');
      recargar();
    } catch (e) {
      const m = mensajeDeDistribucion(e);
      setError(m); fallo('No se pudo guardar', m);
    } finally { setGuardando(false); }
  };

  const guardar = () => {
    setIntento(true);
    if (lista.length) { fallo('Falta algo', lista[0]); return; }
    Alert.alert('Guardar los datos de la empresa', 'Salen impresos en cada documento que se emita.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Guardar', onPress: () => {
        if (!pasaAProduccion) { escribir(); return; }
        // Segunda confirmación: desde aquí cada documento cuenta ante Hacienda.
        Alert.alert('Pasar a Producción', 'Desde que guardes, cada documento es fiscal y cuenta ante Hacienda. Hazlo sólo con la autorización de Hacienda ya recibida.', [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Pasar a Producción', style: 'destructive', onPress: escribir },
        ]);
      } },
    ]);
  };

  if (emisor === undefined) {
    return (
      <>
        <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Empresa' }} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /></View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Empresa', headerLargeTitle: true }} />
      <Formulario contentContainerStyle={{ paddingHorizontal: 16, gap: 18, paddingBottom: 60 }}>
        {error ? <Nota tono="danger" texto={error} /> : null}
        <Nota texto="El certificado de firma y la contraseña de Hacienda no se escriben aquí: los carga quien administra el servidor. Sin ellos, los documentos se guardan pero no salen hacia Hacienda." />
        {f.ambiente === '00' ? <Nota tono="warning" titulo="Ambiente de PRUEBAS" texto="Lo que se emita no tiene validez fiscal. Sirve para la certificación ante Hacienda." /> : null}
        {pasaAProduccion ? <Nota tono="danger" titulo="Vas a pasar a PRODUCCIÓN" texto="Desde que guardes, cada documento es fiscal y cuenta ante Hacienda. Hazlo sólo con la autorización de Hacienda ya recibida." /> : null}

        <Seccion titulo="Empresa">
          <CampoConRotulo rotulo="Razón social" requerido value={f.nombre} editable={!ro} error={ver('nombre')} onChangeText={(v) => set('nombre', v)} />
          <CampoConRotulo rotulo="Nombre comercial" value={f.nombre_comercial} editable={!ro} onChangeText={(v) => set('nombre_comercial', v)} />
          <CampoConRotulo rotulo="NIT" requerido value={f.nit} editable={!ro} error={ver('nit')} keyboardType="number-pad" onChangeText={(v) => set('nit', v)} />
          <CampoConRotulo rotulo="NRC" requerido value={f.nrc} editable={!ro} error={ver('nrc')} keyboardType="number-pad" onChangeText={(v) => set('nrc', v)} />
          <Interruptor rotulo="Gran contribuyente" ayuda="Percibe el 1%." valor={f.gran_contribuyente} deshabilitado={ro} onCambiar={(v) => set('gran_contribuyente', v)} />
          <ElegirActividad requerido valor={f.cod_actividad} deshabilitado={ro} error={intento ? errores.cod_actividad : undefined}
            onCambiar={(v, desc) => setF((p) => ({ ...p, cod_actividad: v, desc_actividad: desc }))} />
        </Seccion>

        <Seccion titulo="Dirección y contacto">
          <ElegirUbicacion f={f} setF={setF} deshabilitado={ro} />
          <CampoConRotulo rotulo="Complemento" value={f.complemento} editable={!ro} error={intento ? errores.direccion : undefined} onChangeText={(v) => set('complemento', v)} />
          <CampoConRotulo rotulo="Teléfono" value={f.telefono} editable={!ro} error={ver('telefono')} keyboardType="phone-pad" onChangeText={(v) => set('telefono', v)} />
          <CampoConRotulo rotulo="Correo" value={f.correo} editable={!ro} error={ver('correo')} keyboardType="email-address" autoCapitalize="none"
            onChangeText={(v) => set('correo', v)} />
        </Seccion>

        <Seccion titulo="Punto de emisión">
          <CampoConRotulo rotulo="Establecimiento (número de control)" value={f.establecimiento} editable={!ro} error={ver('establecimiento')}
            autoCapitalize="characters" onChangeText={(v) => set('establecimiento', v.toUpperCase())} />
          <CampoConRotulo rotulo="Punto de venta de la oficina" value={f.punto_venta} editable={!ro} error={ver('punto_venta')}
            autoCapitalize="characters" onChangeText={(v) => set('punto_venta', v.toUpperCase())} />
          <ElegirLargo rotulo="Tipo de establecimiento" valor={f.tipo_establecimiento} deshabilitado={ro}
            opciones={TIPO_ESTABLECIMIENTO.map((t) => ({ id: t.value, label: t.label }))} onCambiar={(v) => set('tipo_establecimiento', v || '04')} />
          <CampoConRotulo rotulo="Código de establecimiento en Hacienda" value={f.cod_estable_mh} editable={!ro} error={ver('cod_estable_mh')}
            autoCapitalize="characters" onChangeText={(v) => set('cod_estable_mh', v.toUpperCase())} />
          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Lo asigna Hacienda al registrar la bodega.</Text>
          <CampoConRotulo rotulo="Código de punto de venta en Hacienda" value={f.cod_punto_venta_mh} editable={!ro} error={ver('cod_punto_venta_mh')}
            autoCapitalize="characters" onChangeText={(v) => set('cod_punto_venta_mh', v.toUpperCase())} />
        </Seccion>

        <PuntosDeVenta emisorId={emisor?.id} oficina={f.punto_venta} />

        <View style={{ gap: 8 }}>
          <Rotulo texto="Ambiente" />
          {ro ? <Text style={{ color: colorSistema.texto, fontSize: 16, marginLeft: 2 }}>{f.ambiente === '01' ? 'Producción' : 'Pruebas'}</Text>
            : <Segmentos margen={0} activa={f.ambiente} onCambiar={(v) => set('ambiente', v)} opciones={[{ id: '00', label: 'Pruebas' }, { id: '01', label: 'Producción' }]} />}
        </View>

        {ro ? null : (
          <>
            <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 4 }}>{lista.length ? lista[0] : 'Listo para guardar.'}</Text>
            <BotonGrande texto="Guardar" color={PETROLEO} deshabilitado={guardando} onPress={guardar} />
          </>
        )}
      </Formulario>
    </>
  );
}

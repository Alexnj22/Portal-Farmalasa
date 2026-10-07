// Torogoz · la ficha de un cliente de ruta, NATIVA — el `ClienteModal` del
// portal: alta (`id = nuevo`) y edición, o sólo lectura sin permiso de vender.
//
// Lo que un Crédito Fiscal exige (NIT, NRC, actividad, dirección completa) lo
// vuelve a exigir la base con un CHECK: acá se avisa antes, allá se garantiza.
// La dirección va con los CÓDIGOS de Hacienda, y la ruta sale de la tabla de
// rutas (no de un texto a mano). La validación y la fila que se guarda son las
// del núcleo (`distribucionComercial`), las mismas del portal. Un cliente nuevo
// guarda borrador: la sesión se cierra sola.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import useBorrador from '@nucleo/hooks/useBorrador';
import { fetchClientes, fetchRutas, guardarCliente, mensajeDeDistribucion } from '@nucleo/data/distribucion';
import { anotar } from '@nucleo/data/audit';
import { CLIENTE_VACIO, clienteAFormulario, clienteParaGuardar, erroresDeCliente } from '@nucleo/utils/distribucionComercial';
import { DOC_IDENTIDAD, TIPO_CLIENTE, soloVentaLibre } from '@nucleo/utils/distribucionComun';
import { fechaNumerica, hoySV } from '@nucleo/utils/fecha';
import { BARRA_NATIVA } from '../../../componentes/PilaDePestana';
import { colorSistema, Formulario } from '../../../componentes/Formulario';
import { BotonGrande, Campo, Opciones, Seccion } from '../../../componentes/formulario/Piezas';
import { CampoConRotulo, Rotulo } from '../../../componentes/personas/Formulario';
import Fecha from '../../../componentes/formulario/Fecha';
import { fallo, listo, trabajando } from '../../../componentes/Progreso';
import { volver } from '../../../componentes/volver';
import {
  ElegirActividad, ElegirLargo, ElegirUbicacion, Interruptor, Nota, PETROLEO, elegida, useEmisor,
} from '../../../componentes/torogoz/comercial/Piezas';

export default function FichaClienteTorogoz() {
  const { id } = useLocalSearchParams();
  const nuevo = id === 'nuevo';
  const { hasPermission } = useAuth();
  const puedeEditar = !!hasPermission?.('distribucion', 'can_edit');
  const ro = !puedeEditar;
  const { emisor } = useEmisor();
  const [cliente, setCliente] = useState(() => (nuevo ? {} : elegida('cliente', id)));
  const [f, setF] = useState(() => (nuevo ? { ...CLIENTE_VACIO } : cliente ? clienteAFormulario(cliente) : null));
  const [rutas, setRutas] = useState([]);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [intento, setIntento] = useState(false);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  // Abierta desde un enlace (sin pasar por la lista): se busca en la base.
  useEffect(() => {
    if (nuevo || cliente) return undefined;
    let vivo = true;
    fetchClientes().then((r) => {
      if (!vivo) return;
      const c = r.find((x) => String(x.id) === String(id));
      if (!c) { setError('No se encontró ese cliente.'); return; }
      setCliente(c); setF(clienteAFormulario(c));
      anotar('DISTRIBUCION_VER_CLIENTE', String(c.id), { nombre: c.nombre });
    }).catch((e) => { if (vivo) setError(mensajeDeDistribucion(e)); });
    return () => { vivo = false; };
  }, [id, nuevo, cliente]);
  useEffect(() => { fetchRutas().then(setRutas).catch(() => setRutas([])); }, []);

  const { recuperado, descartar } = useBorrador(nuevo && emisor?.id ? `distribucion-cliente-${emisor.id}` : null, f,
    { activo: nuevo, vale: (v) => !!v?.nombre?.trim() });
  const repuesto = useRef(false);
  useEffect(() => {
    if (repuesto.current || !recuperado) return;
    repuesto.current = true;
    setF({ ...CLIENTE_VACIO, ...recuperado });
  }, [recuperado]);

  const errores = useMemo(() => (f ? erroresDeCliente(f) : {}), [f]);
  const lista = Object.values(errores);
  const opcionesRuta = useMemo(() => rutas.filter((r) => r.activo || String(r.id) === String(f?.ruta_id))
    .map((r) => ({ id: String(r.id), label: r.nombre })), [rutas, f?.ruta_id]);

  if (!f) {
    return (
      <>
        <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Cliente' }} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          {error ? <Text style={{ color: colorSistema.texto2, fontSize: 15, textAlign: 'center' }}>{error}</Text> : <ActivityIndicator />}
        </View>
      </>
    );
  }

  const contribuyente = !!f.nrc.trim();
  const ver = (k) => (intento || f[k] ? errores[k] : undefined);

  const guardar = () => {
    setIntento(true);
    if (lista.length) { fallo('Falta algo', lista[0]); return; }
    if (!emisor?.id) { fallo('No se pudo guardar', 'Todavía no están los datos de la empresa que factura.'); return; }
    Alert.alert(nuevo ? 'Agregar cliente' : 'Guardar cambios', f.nombre.trim(), [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Guardar', onPress: async () => {
        setGuardando(true); setError('');
        trabajando('Guardando la ficha…');
        try {
          await guardarCliente(clienteParaGuardar(f, { id: cliente?.id, emisorId: emisor.id }));
          descartar();
          listo(nuevo ? 'Cliente agregado' : 'Ficha guardada', f.nombre.trim());
          volver('/torogoz/clientes');
        } catch (e) {
          const m = mensajeDeDistribucion(e);
          setError(m); fallo('No se pudo guardar', m);
        } finally { setGuardando(false); }
      } },
    ]);
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: nuevo ? 'Nuevo cliente' : f.nombre || 'Cliente' }} />
      <Formulario contentContainerStyle={{ paddingHorizontal: 16, gap: 18, paddingBottom: 60 }}>
        {error ? <Nota tono="danger" texto={error} /> : null}

        <Seccion titulo="Cliente">
          <Rotulo texto="Tipo de cliente" />
          {ro ? <Text style={{ color: colorSistema.texto, fontSize: 16 }}>{TIPO_CLIENTE.find((t) => t.value === f.tipo)?.label ?? f.tipo}</Text>
            : <Opciones color={PETROLEO} valor={f.tipo} onCambiar={(v) => set('tipo', v)} opciones={TIPO_CLIENTE.map((t) => ({ id: t.value, label: t.label }))} />}
          {soloVentaLibre(f.tipo) ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Sólo se le pueden vender productos de venta libre.</Text> : null}
          <CampoConRotulo rotulo="Nombre o razón social" requerido value={f.nombre} editable={!ro} error={ver('nombre')}
            onChangeText={(v) => set('nombre', v)} />
          <CampoConRotulo rotulo="Nombre comercial (opcional)" value={f.nombre_comercial} editable={!ro} onChangeText={(v) => set('nombre_comercial', v)} />
          <ElegirLargo rotulo="Ruta" valor={f.ruta_id ? String(f.ruta_id) : ''} opciones={opcionesRuta} vacio="Sin ruta" deshabilitado={ro}
            onCambiar={(v) => set('ruta_id', v)} />
        </Seccion>

        <Seccion titulo="Datos fiscales">
          <ElegirLargo rotulo="Documento" valor={f.tipo_documento} opciones={DOC_IDENTIDAD.map((d) => ({ id: d.value, label: d.label }))}
            deshabilitado={ro} onCambiar={(v) => set('tipo_documento', v || '13')} />
          <CampoConRotulo rotulo="Número" value={f.num_documento} editable={!ro} error={ver('num_documento')} autoCapitalize="characters"
            keyboardType={f.tipo_documento === '13' || f.tipo_documento === '36' ? 'number-pad' : 'default'}
            placeholder={f.tipo_documento === '13' ? '00000000-0' : undefined} onChangeText={(v) => set('num_documento', v)} />
          <CampoConRotulo rotulo="NRC" value={f.nrc} editable={!ro} error={ver('nrc')} keyboardType="number-pad" onChangeText={(v) => set('nrc', v)} />
          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
            {contribuyente ? 'Contribuyente: se le emite Crédito Fiscal.' : 'Sin NRC se le emite Factura.'}
          </Text>
          <Interruptor rotulo="Gran contribuyente" ayuda="Nos retiene el 1%." valor={f.gran_contribuyente}
            deshabilitado={ro || !contribuyente} onCambiar={(v) => set('gran_contribuyente', v)} />
          <ElegirActividad valor={f.cod_actividad} deshabilitado={ro} requerido={contribuyente} error={intento ? errores.cod_actividad : undefined}
            onCambiar={(v, desc) => setF((p) => ({ ...p, cod_actividad: v, desc_actividad: desc }))} />
        </Seccion>

        <Seccion titulo="Dirección" pie="Ahí le llega el documento electrónico al correo.">
          <ElegirUbicacion f={f} setF={setF} deshabilitado={ro} />
          <CampoConRotulo rotulo="Complemento" value={f.complemento} editable={!ro} error={intento ? errores.direccion : undefined}
            placeholder="Barrio, calle, número, referencia" onChangeText={(v) => set('complemento', v)} />
          <CampoConRotulo rotulo="Teléfono" value={f.telefono} editable={!ro} error={ver('telefono')} keyboardType="phone-pad"
            onChangeText={(v) => set('telefono', v)} />
          <CampoConRotulo rotulo="Correo" value={f.correo} editable={!ro} keyboardType="email-address" autoCapitalize="none"
            onChangeText={(v) => set('correo', v)} />
        </Seccion>

        <Seccion titulo="Licencia y crédito" pie="Sin licencia vigente no se le vende. Crédito 0 = sólo contado.">
          <CampoConRotulo rotulo="Autorización de la SRS" value={f.licencia_srs} editable={!ro} onChangeText={(v) => set('licencia_srs', v)} />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 16 }}>Vence</Text>
            {ro ? <Text style={{ color: colorSistema.texto2, fontSize: 16 }}>{f.licencia_srs_vence ? fechaNumerica(f.licencia_srs_vence) : '—'}</Text>
              : f.licencia_srs_vence ? <Fecha valor={f.licencia_srs_vence} onCambiar={(v) => set('licencia_srs_vence', v)} />
                : <BotonGrande texto="Poner fecha" borde color={PETROLEO} onPress={() => set('licencia_srs_vence', hoySV())} />}
          </View>
          {!ro && f.licencia_srs_vence ? (
            <Text onPress={() => set('licencia_srs_vence', '')} style={{ color: PETROLEO, fontSize: 14, fontWeight: '600' }}>Quitar la fecha</Text>
          ) : null}
          <CampoConRotulo rotulo="Crédito aprobado ($)" value={f.limite_credito} editable={!ro} error={ver('limite_credito')} keyboardType="decimal-pad"
            onChangeText={(v) => set('limite_credito', v)} />
          <CampoConRotulo rotulo="Plazo (días)" value={f.plazo_dias} editable={!ro} error={ver('plazo_dias')} keyboardType="number-pad"
            onChangeText={(v) => set('plazo_dias', v)} />
        </Seccion>

        <Seccion titulo="Notas">
          <Campo value={f.notas} editable={!ro} placeholder="Notas" onChangeText={(v) => set('notas', v)} />
          {!nuevo ? <Interruptor rotulo="Cliente activo" valor={f.activo} deshabilitado={ro} onCambiar={(v) => set('activo', v)} /> : null}
        </Seccion>

        {ro ? null : (
          <>
            <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 4 }}>
              {lista.length ? lista[0] : 'Listo para guardar.'}
            </Text>
            <BotonGrande texto="Guardar" color={PETROLEO} deshabilitado={guardando} onPress={guardar} />
          </>
        )}
      </Formulario>
    </>
  );
}

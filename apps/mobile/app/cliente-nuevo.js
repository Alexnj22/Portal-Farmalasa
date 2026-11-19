// Nuevo cliente, NATIVO — el alta del portal (`FormClienteDetail.jsx` sin
// `id`, abierto desde «Nuevo cliente» en Clientes). Desde el 2026-11-15 los
// clientes nacen en el portal y el portal les pide su número a la caja.
//
// Las mismas reglas, del núcleo: primero QUÉ es el cliente (tres grupos y la
// variante dentro del grupo), y de eso sale qué documentos se piden
// (`camposDeCategoria`); el veredicto es `validarAlta` (el de siempre más
// nombre y apellido y un documento); el giro, del catálogo del MH. Si la
// persona ya existía —mismo DUI, NIT o nombre— `crearCliente` devuelve ésa y se
// abren sus datos: nunca se duplica. Después `altaClienteEnCaja` le pide el
// número; si no llega, la ficha queda en la cola y aparece en «Sin número».
//
// Permiso: `clientes_crear`, como el botón del portal.
// Lo escrito se guarda como borrador y se OFRECE al volver, nunca se repone
// solo (como en el portal y en `sacar-dinero.js`).
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { altaClienteEnCaja, crearCliente, mensajeDeError } from '@nucleo/data/customers';
import { DEPARTAMENTOS, distritosDe, municipiosDe, normalizarGeo } from '@nucleo/data/elSalvadorGeo';
import {
  CAMPOS_FICHA, ETIQUETA_CAMPO, FICHA_NUEVA, GRUPOS_DE_CLIENTE, GRUPO_DE_CATEGORIA, PRIMERA_DEL_GRUPO,
  QUE_ES_CATEGORIA, VARIANTES_DEL_GRUPO, cambiosDeFicha, camposDeCategoria, camposRequeridos, cargarGiros,
  conCategoria, esContribuyente, rotuloFaltaAlNacer, validarAlta,
} from '@nucleo/utils/clienteValidacion';
import { applyInputMask } from '@nucleo/utils/inputStyles';
import { hora12 } from '@nucleo/utils/hora';
import useBorrador from '@nucleo/hooks/useBorrador';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { Aviso, BotonGrande, Opciones, PantallaSinDato, Seccion } from '../componentes/formulario/Piezas';
import { CampoConRotulo, Elegir } from '../componentes/personas/Formulario';
import Segmentos from '../componentes/Segmentos';
import CampoGiro from '../componentes/clientes/CampoGiro';
import { MARCA } from '../componentes/inicio/marca';
import { avisar, fallo, listo, trabajando } from '../componentes/Progreso';

const CLAVE_BORRADOR = 'cliente_nuevo';
// Hay borrador si algo se escribió: la categoría sola no cuenta (nace en Consumidor).
const hayEscrito = (f) => CAMPOS_FICHA.some((c) => c !== 'categoria' && String(f?.[c] ?? '').trim() !== '');
const opcionesDe = (lista) => lista.map((x) => ({ id: x, label: x }));

export default function ClienteNuevo() {
  const { hasPermission } = useAuth();
  const puede = hasPermission('clientes_crear');
  const [form, setForm] = useState(() => ({ ...FICHA_NUEVA }));
  const [giros, setGiros] = useState([]);
  const [intento, setIntento] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let vivo = true;
    cargarGiros().then((g) => { if (vivo) setGiros(g); }).catch(() => { if (vivo) setError('No se pudo cargar el listado de giros. Vuelve a abrir la pantalla.'); });
    return () => { vivo = false; };
  }, []);

  const { recuperado, cuando, descartar } = useBorrador(puede ? CLAVE_BORRADOR : null, form, { vale: hayEscrito });
  const [ofrecido, setOfrecido] = useState(false);
  const ofrecerBorrador = !ofrecido && !!recuperado && hayEscrito(recuperado);

  const set = (campo, mascara, mayus) => (t) => {
    const v = mascara ? applyInputMask(t, mascara) : mayus ? String(t).toUpperCase() : t;
    setForm((f) => ({ ...f, [campo]: v }));
  };
  const setGeo = (parcial) => setForm((f) => ({ ...f, ...normalizarGeo({ ...f, ...parcial }) }));

  const grupo = GRUPO_DE_CATEGORIA[form.categoria] ?? 'consumidor';
  const fiscal = esContribuyente(form.categoria);
  const lleva = useMemo(() => camposDeCategoria(form.categoria), [form.categoria]);
  const req = useMemo(() => new Set(camposRequeridos(form.categoria)), [form.categoria]);
  const v = useMemo(() => validarAlta(form), [form]);
  const cambios = useMemo(() => cambiosDeFicha(form, FICHA_NUEVA), [form]);
  // Lo que falta no se marca al abrir: sí en cuanto hay algo escrito o se intentó crear.
  const senalar = intento || Object.keys(cambios).length > 0;
  const errorDe = (c) => v.errores[c]
    || (senalar && v.faltan.includes(c) ? rotuloFaltaAlNacer(c, form.categoria) || 'Requerido para facturar' : undefined);
  const nombreDeFalta = (c) => rotuloFaltaAlNacer(c, form.categoria) || ETIQUETA_CAMPO[c] || c;

  const crear = async () => {
    setIntento(true);
    if (!v.ok) { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}); return; }
    setGuardando(true);
    setError('');
    trabajando('Creando el cliente…');
    try {
      const r = await crearCliente(cambios);
      descartar();
      if (r.existente) {
        avisar('Ya estaba registrado',
          `${r.name} ya estaba registrado${r.por === 'nombre' ? ' con ese nombre' : ' con ese documento'}. Se abrieron sus datos.`);
      } else {
        trabajando('Asignándole su número…');
        // Como en el portal: la ficha ya está guardada; si la caja no contesta,
        // se reintenta sola en unos minutos.
        const a = await altaClienteEnCaja(r.id);
        if (a?.hecho) listo('Listo para facturar', `Cliente número ${a.erp_id}.`);
        else avisar('Creado, falta el número', a?.revisar
          ? 'Hay que revisarlo: aparece en «Sin número» de la lista de clientes.'
          : 'Se le asigna solo en unos minutos.');
      }
      router.replace({ pathname: '/cliente/[id]', params: { id: String(r.id) } });
    } catch (e) {
      const m = mensajeDeError(e);
      setError(m);
      fallo('No se pudo crear', m);
    } finally {
      setGuardando(false);
    }
  };

  if (!puede) return <PantallaSinDato titulo="Nuevo cliente" texto="No tienes permiso para crear clientes." />;

  const distritos = distritosDe(form.municipio);
  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Nuevo cliente' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? undefined : 'height'}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
          contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive">
          {ofrecerBorrador ? (
            <Seccion titulo="Cliente sin terminar">
              <Aviso tono="cuidado" texto={`Quedaron datos sin guardar${cuando ? ` de las ${hora12(new Date(cuando))}` : ''}.`} />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}><BotonGrande texto="Recuperar" onPress={() => { setForm((f) => ({ ...f, ...recuperado })); setOfrecido(true); }} /></View>
                <View style={{ flex: 1 }}><BotonGrande texto="Descartar" borde onPress={() => { descartar(); setOfrecido(true); }} /></View>
              </View>
            </Seccion>
          ) : null}

          <Seccion titulo="Tipo de cliente">
            {/* seccion-en-linea: elección de un formulario (qué es el cliente), no una sección de la pantalla */}
            <Segmentos margen={0} activa={grupo} opciones={GRUPOS_DE_CLIENTE.map((g) => ({ id: g.value, label: g.label }))}
              onCambiar={(g) => setForm((p) => (GRUPO_DE_CATEGORIA[p.categoria] === g ? p : conCategoria(p, PRIMERA_DEL_GRUPO[g])))} />
            {VARIANTES_DEL_GRUPO[grupo] ? (
              <Opciones opciones={VARIANTES_DEL_GRUPO[grupo]} valor={form.categoria}
                onCambiar={(c) => setForm((p) => conCategoria(p, c))} />
            ) : null}
            {QUE_ES_CATEGORIA[form.categoria] ? <Aviso texto={QUE_ES_CATEGORIA[form.categoria]} /> : null}
          </Seccion>

          <Seccion titulo="Identidad"
            pie={fiscal ? 'Nombre o razón social, como en su tarjeta de IVA. Se guarda en mayúscula.'
              : form.categoria === 'Extranjero' ? 'Nombre y apellido, como en el pasaporte. Se guarda en mayúscula.'
                : 'Nombre y apellido, como en el DUI. Se guarda en mayúscula.'}>
            <CampoConRotulo rotulo="Nombre" requerido value={form.name} onChangeText={set('name', null, true)}
              autoCapitalize="characters" autoCorrect={false} error={errorDe('name')} />
            {lleva.has('dui') ? (
              <CampoConRotulo rotulo={fiscal ? 'DUI' : 'DUI (o el NIT, si no tiene DUI)'} value={form.dui} onChangeText={set('dui', 'DUI')}
                placeholder="00000000-0" keyboardType="number-pad" error={errorDe('dui')} />
            ) : null}
            {lleva.has('nit') ? (
              <CampoConRotulo rotulo="NIT" requerido={req.has('nit')} value={form.nit} onChangeText={set('nit', 'NIT')}
                placeholder="14 dígitos" keyboardType="number-pad" error={errorDe('nit')} />
            ) : null}
            {lleva.has('nrc') ? (
              <CampoConRotulo rotulo="NRC" requerido={req.has('nrc')} value={form.nrc} onChangeText={set('nrc', 'NRC')}
                placeholder="4 a 8 dígitos" keyboardType="number-pad" error={errorDe('nrc')} />
            ) : null}
            {lleva.has('pasaporte') ? (
              <CampoConRotulo rotulo="Pasaporte" requerido={form.categoria === 'Extranjero'} value={form.pasaporte}
                onChangeText={set('pasaporte', null, true)} autoCapitalize="characters" autoCorrect={false} error={errorDe('pasaporte')} />
            ) : null}
            {lleva.has('giro') ? (
              <CampoGiro valor={form.giro} giros={giros} requerido={req.has('giro')} error={errorDe('giro')}
                onCambiar={(g) => setForm((f) => ({ ...f, giro: g || '' }))} />
            ) : null}
            {lleva.has('retencion_pct') ? (
              <CampoConRotulo rotulo="Retención % (0 a 100)" value={form.retencion_pct} onChangeText={set('retencion_pct', 'PERCENT')}
                keyboardType="number-pad" error={errorDe('retencion_pct')} />
            ) : null}
          </Seccion>

          <Seccion titulo="Contacto" pie="La factura pide el teléfono.">
            <CampoConRotulo rotulo="Teléfono" requerido value={form.phone} onChangeText={set('phone', 'PHONE')}
              placeholder="0000-0000" keyboardType="phone-pad" error={errorDe('phone')} />
            <CampoConRotulo rotulo="Teléfono 2" value={form.telefono2} onChangeText={set('telefono2', 'PHONE')}
              placeholder="0000-0000" keyboardType="phone-pad" error={errorDe('telefono2')} />
            <CampoConRotulo rotulo="Correo" requerido={req.has('email')} value={form.email} onChangeText={set('email')}
              keyboardType="email-address" autoCapitalize="none" autoCorrect={false} error={errorDe('email')} />
          </Seccion>

          <Seccion titulo="Ubicación"
            pie={fiscal && !form.distrito ? 'El crédito fiscal pide el distrito, con departamento y municipio.' : undefined}>
            <CampoConRotulo rotulo="Dirección" requerido={req.has('direccion')} value={form.direccion}
              onChangeText={set('direccion', null, true)} autoCapitalize="characters" error={errorDe('direccion')} />
            <Elegir rotulo="Departamento" requerido valor={form.departamento} opciones={opcionesDe(DEPARTAMENTOS)} vacio={null}
              error={errorDe('departamento')} onCambiar={(x) => setGeo({ departamento: x || null, municipio: null, distrito: null })} />
            <Elegir rotulo="Municipio" requerido valor={form.municipio} opciones={opcionesDe(municipiosDe(form.departamento))}
              deshabilitado={!form.departamento} error={errorDe('municipio')}
              onCambiar={(x) => setGeo({ municipio: x || null, distrito: null })} />
            <Elegir rotulo="Distrito" requerido valor={form.distrito} opciones={opcionesDe(distritos)}
              deshabilitado={!form.municipio} error={errorDe('distrito')} onCambiar={(x) => setGeo({ distrito: x || null })} />
          </Seccion>

          <Seccion titulo="Notas">
            <CampoConRotulo rotulo="Notas internas (no salen del portal)" value={form.notes} onChangeText={set('notes')} multiline />
          </Seccion>

          {error ? <Aviso tono="freno" texto={error} /> : null}
          {senalar && v.faltan.length ? (
            <Aviso tono="cuidado" texto={`Falta ${v.faltan.length === 1 ? 'un dato' : `${v.faltan.length} datos`} para crear el cliente: ${v.faltan.map(nombreDeFalta).join(', ')}.`} />
          ) : null}
          {Object.keys(v.errores).length ? (
            <Aviso tono="freno" texto={`Revisa ${Object.keys(v.errores).map((c) => ETIQUETA_CAMPO[c] || c).join(', ')}.`} />
          ) : null}
          <BotonGrande texto={guardando ? 'Creando…' : 'Crear cliente'} color={MARCA.azul} deshabilitado={guardando} onPress={crear} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

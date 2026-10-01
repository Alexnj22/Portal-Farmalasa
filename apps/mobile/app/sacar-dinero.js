// Sacar dinero, NATIVO — la salida de Efectivo del portal (`SalidaDeBolsa.jsx`
// abierto desde Mi caja). Regla del usuario del 3-sep: «todo debe pasar desde
// efectivo»: el dinero sale PRIMERO del cajón, y sólo si no alcanza, de las
// bolsas (`elegirOrigen`, del núcleo).
//
//   · del CAJÓN: `anotarSalida` (edge `operar-caja`, con clave para que dos
//     toques no anoten dos veces) y sale el comprobante del movimiento;
//   · de las BOLSAS: `registrarSalida` reparte entre las más viejas y sale el
//     vale de la operación más la etiqueta nueva de cada bolsa tocada.
//
// Cada motivo (`bolsas_tipos_salida`) dice qué pide: a quién o a qué entidad,
// número de boleta (que no se repita en la sala), foto del comprobante y si
// quien se lo lleva tiene que identificarse con su carné.
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import {
  anotarSalida, boletaYaRegistrada, estadoDeCaja, fetchBolsas, fetchEntidadesDeSalida, fetchSaldos,
  fetchTiposDeSalida, registrarSalida,
} from '@nucleo/data/bolsas';
import { disponibles, elegirOrigen, totalDisponible } from '@nucleo/utils/bolsasReparto';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Dato, Opciones, Seccion } from '../componentes/formulario/Piezas';
import Fotos, { subirFotos } from '../componentes/formulario/Fotos';
import Identidad from '../componentes/Identidad';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';
import { comprobanteDelMovimiento, reimprimirEtiqueta, valeDeLaSalida } from '../componentes/cortes/papel';

export default function SacarDinero() {
  const { sala } = useLocalSearchParams();
  const { user, hasPermission } = useAuth();
  const sucursales = useStaffStore((s) => s.branches);
  const nombreSala = (sucursales || []).find((b) => String(b.id) === String(sala))?.name ?? '';
  const delCajonPermitido = hasPermission('caja_vales', 'can_edit');

  const [tipos, setTipos] = useState([]);
  const [entidades, setEntidades] = useState([]);
  const [efectivo, setEfectivo] = useState(null);
  const [bolsas, setBolsas] = useState([]);
  const [tipo, setTipo] = useState(null);
  const [monto, setMonto] = useState('');
  const [entidad, setEntidad] = useState('');
  const [boleta, setBoleta] = useState('');
  const [repetida, setRepetida] = useState(false);
  const [nota, setNota] = useState('');
  const [fotos, setFotos] = useState([]);
  const [identidad, setIdentidad] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [clave] = useState(() => `app-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  useEffect(() => {
    let vivo = true;
    fetchTiposDeSalida().then((x) => vivo && setTipos(x));
    fetchEntidadesDeSalida().then((x) => vivo && setEntidades(x));
    if (sala) {
      estadoDeCaja(sala).then((e) => vivo && setEfectivo(e?.error ? null : (e?.efectivo ?? null)));
      fetchBolsas({ estados: ['ABIERTA'] }).then(async (lista) => {
        const mias = (lista || []).filter((b) => String(b.branch_id) === String(sala));
        const saldos = await fetchSaldos(mias.map((b) => b.id));
        if (vivo) setBolsas(disponibles(mias, saldos));
      });
    }
    return () => { vivo = false; };
  }, [sala]);

  const t = tipos.find((x) => x.codigo === tipo && x.activo) || null;
  const opcionesEntidad = entidades.filter((e) => e.tipo === tipo).map((e) => e.nombre);
  const n = String(monto).trim() === '' ? NaN : Number(String(monto).replace(',', '.'));
  const eleccion = useMemo(() => elegirOrigen({
    efectivoEnCaja: delCajonPermitido ? efectivo : null, puedeElCajon: !!t?.caja_tipo, lista: bolsas, monto: Number.isFinite(n) ? n : 0,
  }), [delCajonPermitido, efectivo, t, bolsas, n]);
  const delCajon = eleccion.origen === 'CAJA';

  useEffect(() => {
    if (!t?.pide_boleta || !boleta.trim()) { setRepetida(false); return undefined; }
    let vivo = true;
    const id = setTimeout(() => boletaYaRegistrada(Number(sala), boleta.trim()).then((f) => vivo && setRepetida(f.length > 0)), 400);
    return () => { vivo = false; clearTimeout(id); };
  }, [t, boleta, sala]);

  const falta = !t ? 'Elige el motivo.'
    : !(n > 0) ? 'Escribe el monto.'
      : !eleccion.alcanza ? `En la sala hay ${formatMoney(totalDisponible(bolsas))} en bolsas${delCajonPermitido && efectivo != null ? ' y la caja no alcanza' : ''}: no alcanza.`
        : t.etiqueta_entidad && !t.entidad_la_dice_el_papel && !entidad.trim() ? `Falta ${t.etiqueta_entidad.toLowerCase()}.`
          : t.pide_boleta && !boleta.trim() ? 'Falta el número de boleta.'
            : repetida ? 'Esa boleta ya está registrada en esta sala.'
              : t.foto === 'OBLIGATORIA' && !fotos.length ? 'Falta la foto del comprobante.'
                : t.pide_receptor && !identidad ? 'Falta identificar a quien se lo lleva.'
                  : null;

  const guardar = async () => {
    setGuardando(true); trabajando('Registrando la salida…');
    try {
      const fotoUrl = fotos.length ? (await subirFotos(fotos, { bucket: 'payment-proofs', carpeta: `bolsas/${sala ?? 'sin-sala'}/${user?.id ?? 'anon'}` }))[0] ?? null : null;
      const entidadDicha = t.entidad_la_dice_el_papel ? '' : entidad.trim();
      if (delCajon) {
        const r = await anotarSalida({
          sala, monto: n, tipo: t.caja_tipo,
          concepto: [t.etiqueta, entidadDicha, nota.trim()].filter(Boolean).join(' · ').slice(0, 50),
          detalle: [entidadDicha, nota.trim()].filter(Boolean).join(' · '),
          boleta: boleta.trim() || null, fotoUrl,
          recibidoPor: t.pide_receptor ? identidad?.persona?.id : null, vale: t.pide_receptor ? identidad?.vale : null,
          recibe: t.pide_receptor ? '' : entidad.trim(), clave,
        });
        if (r?.error) { if (t.pide_receptor) setIdentidad(null); throw r.error; }
        const papel = r?.movimiento ? await comprobanteDelMovimiento(r.movimiento, {
          etiqueta: t.etiqueta, detalle: [entidadDicha, nota.trim()].filter(Boolean).join(' · '),
          persona: identidad?.persona?.name || entidad.trim(), comoSeComprobo: r.movimiento.recibido_metodo,
        }, sala, nombreSala, user?.name || '') : { ok: true };
        if (r?.aviso) fallo('Salida anotada, con un pendiente', r.aviso);
        else if (!papel.ok) fallo('Salida anotada, pero el comprobante no salió', papel.detalle);
        else listo('Salida registrada', `De la caja · ${formatMoney(n)}`);
      } else {
        const { data, error } = await registrarSalida({
          tipo: t.codigo, monto: n, repartos: eleccion.repartos.map(({ bolsa_id, monto: m }) => ({ bolsa_id, monto: m })),
          entidad, numeroBoleta: boleta, fotoUrl, nota,
          recibidoPor: t.pide_receptor ? identidad?.persona?.id : null, vale: t.pide_receptor ? identidad?.vale : null,
        });
        if (error) { if (t.pide_receptor) setIdentidad(null); throw error; }
        // El vale y la etiqueta nueva de cada bolsa tocada: sin la etiqueta, la
        // bolsa diría lo guardado y no lo que le queda.
        const vale = await valeDeLaSalida(data.id, data.branch_id ?? sala);
        const etiquetas = [];
        for (const { bolsa_id } of eleccion.repartos) {
          const b = bolsas.find((x) => x.id === bolsa_id);
          if (b) etiquetas.push(await reimprimirEtiqueta(b, nombreSala, user?.name || ''));
        }
        const malos = [!vale.ok && `el vale (${vale.detalle})`, etiquetas.some((e) => !e.ok) && 'alguna etiqueta'].filter(Boolean);
        if (malos.length) fallo('Salida registrada, pero falta papel', `No salió ${malos.join(' ni ')}. Imprímelo desde el detalle de la bolsa.`);
        else listo('Salida registrada', `${data.folio} · ${formatMoney(n)}`);
      }
      router.back();
    } catch (e) {
      fallo('No se pudo registrar', mensajeAmigable(e, 'Vuelve a intentar en un momento.'));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Sacar dinero' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? undefined : 'height'}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
          contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive">
          <Seccion titulo={nombreSala || 'La sala'}>
            <Dato primero rotulo="En la caja" valor={efectivo != null && delCajonPermitido ? formatMoney(efectivo) : '—'} />
            <Dato rotulo="En bolsas" valor={formatMoney(totalDisponible(bolsas))} />
          </Seccion>

          <Seccion titulo="Motivo">
            <Opciones opciones={tipos.filter((x) => x.activo).map((x) => ({ id: x.codigo, label: x.etiqueta, detalle: x.leyenda || null }))}
              valor={tipo} onCambiar={(v) => { setTipo(v); setEntidad(''); setBoleta(''); setFotos([]); setIdentidad(null); }} />
          </Seccion>

          {t ? (
            <Seccion titulo="La salida">
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>Monto</Text>
                <View style={{ width: 140 }}><Campo multiline={false} value={monto} onChangeText={(v) => setMonto(v.replace(/[^\d.,]/g, ''))} keyboardType="decimal-pad" placeholder="$0.00" style={{ textAlign: 'center' }} /></View>
              </View>
              {n > 0 && eleccion.alcanza ? (
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                  {delCajon ? 'Sale de la caja.' : `Sale de ${eleccion.repartos.map((r) => `${bolsas.find((b) => b.id === r.bolsa_id)?.folio ?? 'una bolsa'} (${formatMoney(r.monto)})`).join(', ')}.`}
                </Text>
              ) : null}
              {t.etiqueta_entidad && !t.entidad_la_dice_el_papel ? (
                opcionesEntidad.length
                  ? <Opciones opciones={opcionesEntidad} valor={entidad} onCambiar={setEntidad} />
                  : <Campo multiline={false} value={entidad} onChangeText={setEntidad} placeholder={t.etiqueta_entidad} />
              ) : null}
              {t.pide_boleta ? <Campo multiline={false} value={boleta} onChangeText={setBoleta} placeholder="Número de boleta" autoCapitalize="characters" /> : null}
              {t.foto && t.foto !== 'NO' ? <Fotos fotos={fotos} onCambiar={setFotos} max={1} /> : null}
              <Campo value={nota} onChangeText={setNota} placeholder="Nota (opcional)" />
            </Seccion>
          ) : null}

          {t?.pide_receptor ? (
            <Seccion titulo="Quién se lo lleva">
              <Identidad identidad={identidad} onIdentidad={setIdentidad} titulo="Escanea el carné de quien se lo lleva" />
            </Seccion>
          ) : null}

          {falta && t ? <Aviso tono="cuidado" texto={falta} /> : null}
          <BotonGrande texto={guardando ? 'Registrando…' : 'Registrar e imprimir'} color={MARCA.verde} deshabilitado={guardando || !!falta} onPress={guardar} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

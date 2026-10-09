// Hacer el corte, NATIVO — `DialogoCorte` de «Mi caja» en el portal, en sus
// tres momentos:
//
//   1. Si quedó un corte a medias (ni confirmado ni descartado), NO se pide un
//      número: los cortes del día se suman y el siguiente tampoco se podría
//      confirmar. Se manda a resolver aquél (regla del usuario, 6-sep). El
//      servidor lo vuelve a frenar.
//   2. Se cuenta SÓLO el cajón. Lo ya embolsado hoy lo pone el portal
//      (`declaradoDelCorte`): el sistema de la caja cuenta el día entero.
//      Mostrar lo embolsado no rompe el conteo a ciegas: es lo que la sala
//      misma guardó; lo que no se ve es cuánto DEBERÍA haber.
//   3. El resultado: la diferencia del TRAMO (`conTramoDelCorte`) y, si dice
//      otra cosa, la del día. «Firmar el corte» abre su detalle nativo
//      (confirmar con entrega, o descartar), que es donde sale el papel.
//
// El corte existe en la caja apenas se aprieta: salir sin firmar lo deja
// PENDIENTE, y mientras siga así no se puede hacer otro ni cerrar el día. Se
// dice en pantalla, como el aviso del portal.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { estadoDeCaja, fetchBolsas, fetchSaldos, fetchValesPendientes, hacerCorte } from '@nucleo/data/bolsas';
import { fetchCortes } from '@nucleo/data/cortes';
import { acumuladoAntesDe, conLaCuentaBuena, conTramoDelCorte } from '@nucleo/utils/cortesDiagnostico';
import { bolsasDelDia, declaradoDelCorte, embolsadoDelDia, valesDeLaSala } from '@nucleo/utils/corteDeCaja';
import { construirComprobanteDeCorte } from '@nucleo/utils/corteTicket';
import { conSigno, formatMoney } from '@nucleo/utils/formatNumber';
import { hora12 } from '@nucleo/utils/hora';
import { hoySV } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Dato, Seccion } from '../componentes/formulario/Piezas';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';
import { imprimirEnLaSala } from '../componentes/imprimir';

export default function HacerCorte() {
  const { sala } = useLocalSearchParams();
  const { user, hasPermission } = useAuth();
  const puedeOperar = hasPermission('caja_vales', 'can_edit');
  const puedeVerCortes = hasPermission('cortes_caja', 'can_view');
  const sucursales = useStaffStore((s) => s.branches);
  const nombreSala = (sucursales || []).find((b) => String(b.id) === String(sala))?.name ?? '';
  const [estado, setEstado] = useState(undefined);
  const [bolsasDeHoy, setBolsasDeHoy] = useState([]);
  const [vales, setVales] = useState(0);
  const [cortesDelDia, setCortesDelDia] = useState([]);
  const [efectivo, setEfectivo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [resultado, setResultado] = useState(null);

  const cargar = useCallback(async () => {
    const e = await estadoDeCaja(sala);
    const dia = e?.dia || hoySV();
    const [abiertas, v, delDia] = await Promise.all([
      fetchBolsas({ estados: ['ABIERTA', 'ENTREGADA', 'CONTADA'] }),
      fetchValesPendientes(),
      puedeVerCortes ? fetchCortes({ desde: dia, hasta: dia }).then((f) => (f || []).filter((c) => String(c.branch_id) === String(sala))) : Promise.resolve([]),
    ]).catch(() => [[], { filas: [] }, []]);
    const mias = (abiertas || []).filter((b) => String(b.branch_id) === String(sala));
    const saldos = await fetchSaldos(mias.map((b) => b.id)).catch(() => new Map());
    setBolsasDeHoy(bolsasDelDia(mias.map((b) => ({ ...b, ...(saldos.get(b.id) || {}) })), dia));
    setVales(valesDeLaSala(v?.filas, sala).length);
    setCortesDelDia(delDia || []);
    setEstado(e?.error ? { error: mensajeAmigable(e.error) } : e);
  }, [sala, puedeVerCortes]);
  useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial de datos

  const yaEmbolsado = embolsadoDelDia(bolsasDeHoy);
  const declarado = declaradoDelCorte(efectivo, yaEmbolsado);
  const valido = efectivo !== '' && Number(efectivo.replace(',', '.')) >= 0;
  const sinResolver = (estado?.cortes || []).filter((c) => c.tipo === 'C' && c.estado === 'PENDIENTE');

  const cortar = () => {
    const contado = Number(efectivo.replace(',', '.')) || 0;
    const total = declaradoDelCorte(contado, yaEmbolsado);
    Alert.alert('¿Hacer el corte?',
      `${formatMoney(contado)} en el cajón${yaEmbolsado > 0 ? ` + ${formatMoney(yaEmbolsado)} ya embolsado = ${formatMoney(total)} declarado` : ''}.\n\nEl corte queda registrado en la caja y después hay que confirmarlo o descartarlo.`, [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Hacer el corte', onPress: async () => {
          setOcupado(true);
          trabajando('Haciendo el corte…');
          const bruto = await hacerCorte({ sala, efectivo: total }).catch((e) => ({ error: e }));
          setOcupado(false);
          if (bruto?.error) { fallo('No se pudo hacer el corte', mensajeAmigable(bruto.error)); return; }
          const base = cortesDelDia.length ? cortesDelDia : (estado?.cortes || []);
          setResultado(conTramoDelCorte(conLaCuentaBuena(bruto), acumuladoAntesDe(base)));
          listo('Corte hecho', 'Falta confirmarlo o descartarlo.');
        } },
      ]);
  };

  const imprimir = async () => {
    const papel = await imprimirEnLaSala(construirComprobanteDeCorte({
      resultado, sala: nombreSala, hechoPor: user?.name || '', hechoAt: new Date().toISOString(),
    }), sala, 'Corte de caja');
    if (papel.ok) listo('Comprobante enviado', papel.detalle); else fallo('No se pudo imprimir', papel.detalle);
  };

  // La fila del corte la escribe el sync medio minuto después: se busca por el
  // número que devolvió la caja y, si todavía no está, se dice.
  const firmar = async () => {
    trabajando('Buscando el corte…');
    const dia = estado?.dia || hoySV();
    for (let i = 0; i < 4; i += 1) {
      const delDia = await fetchCortes({ desde: dia, hasta: dia }).catch(() => []);
      const mio = (delDia || []).find((c) => String(c.erp_corte_id) === String(resultado?.id_corte));
      if (mio) {
        listo('Corte listo para firmar');
        router.replace({ pathname: '/corte/[id]', params: { id: String(mio.id), fecha: mio.fecha || dia } });
        return;
      }
      await new Promise((r) => setTimeout(r, 4000));
    }
    fallo('Todavía no aparece el corte', 'Se registró en la caja y llega en unos minutos. Confírmalo desde Efectivo › Cortes.');
  };

  if (!puedeOperar) {
    return (<><Stack.Screen options={{ ...BARRA_NATIVA, title: 'Hacer corte' }} />
      <View style={{ padding: 20 }}><Aviso tono="freno" texto="Hacer el corte es de quien opera la caja." /></View></>);
  }

  let cuerpo;
  if (estado === undefined) cuerpo = <ActivityIndicator style={{ marginTop: 40 }} />;
  else if (estado?.error) cuerpo = <Aviso tono="freno" texto={`No se pudo leer la caja: ${estado.error}`} />;
  else if (resultado) {
    const acumulada = Number(resultado.diferencia || 0);
    const dif = resultado.tramo != null ? Number(resultado.tramo) : acumulada;
    const cuadro = Math.abs(dif) < 0.005;
    const conAcumulada = resultado.tramo != null && Math.abs(acumulada - dif) >= 0.005;
    cuerpo = (
      <>
        <Seccion titulo={cuadro ? 'El corte cuadró' : 'El corte tiene diferencia'}>
          <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>{`Contaste ${formatMoney(resultado.contado)}`}</Text>
          <Text style={{ color: cuadro ? MARCA.verde : dif > 0 ? MARCA.ambar : MARCA.rojo, fontSize: 34, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{conSigno(dif)}</Text>
          {conAcumulada ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
            {`En el día: ${conSigno(acumulada)}${resultado.previo?.hora ? ` · el corte de las ${hora12(resultado.previo.hora)} ya había dado ${conSigno(resultado.previo.valor)}` : ''}`}
          </Text> : null}
          {resultado.nota ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${resultado.nota.titulo}. ${resultado.nota.detalle}`}</Text> : null}
          {resultado.aviso ? <Text style={{ color: MARCA.rojo, fontSize: 13, fontWeight: '700' }}>{resultado.aviso}</Text> : null}
        </Seccion>
        {resultado.ok ? (
          <>
            <Aviso texto="¿Este conteo es el bueno? Confírmalo para que cuente como el corte del día. Si fue una prueba o contaste mal, descártalo y vuelve a hacerlo. Mientras quede sin resolver no se puede hacer otro corte ni cerrar el día." />
            <BotonGrande texto="Firmar el corte" color={MARCA.verde} onPress={firmar} />
            <BotonGrande texto="Imprimir el comprobante" borde onPress={imprimir} />
          </>
        ) : <BotonGrande texto="Entendido" onPress={() => router.back()} />}
      </>
    );
  } else if (sinResolver.length) {
    cuerpo = (
      <>
        <Aviso tono="cuidado" texto="Antes de hacer otro corte hay que decir qué pasa con el que quedó a medias. Los cortes del día se suman: mientras uno quede sin confirmar ni descartar, el que venga después tampoco se va a poder confirmar." />
        {sinResolver.map((c) => (
          <Seccion key={c.id} titulo={`Corte de las ${hora12(c.hora)}`}>
            {c.total_declarado != null ? <Dato primero rotulo="Declarado" valor={formatMoney(c.total_declarado)} /> : null}
            {puedeVerCortes
              ? <BotonGrande texto="Confirmar o descartar" onPress={() => router.push({ pathname: '/corte/[id]', params: { id: String(c.id), fecha: c.fecha || estado?.dia || hoySV() } })} />
              : <Aviso texto="Alguien con acceso a Cortes tiene que confirmarlo o descartarlo." />}
          </Seccion>
        ))}
      </>
    );
  } else if (!estado?.abierta || estado?.turno_corriendo === false) {
    cuerpo = <Aviso tono="freno" texto={estado?.abierta ? 'El turno está parado: inícialo antes de cortar.' : 'La caja está cerrada.'} />;
  } else {
    cuerpo = (
      <>
        <Text style={{ color: colorSistema.texto2, fontSize: 15, marginHorizontal: 4 }}>Cuenta SÓLO el efectivo que hay en el cajón ahora. Lo que ya está en las bolsas de hoy lo suma el portal.</Text>
        {vales > 0 ? <Aviso texto={`Antes del corte se anota un vale de caja con ${vales} salida${vales === 1 ? '' : 's'} del día.`} /> : null}
        <Seccion titulo="Efectivo en el cajón">
          <Campo multiline={false} value={efectivo} onChangeText={(v) => setEfectivo(v.replace(/[^\d.,]/g, ''))}
            keyboardType="decimal-pad" placeholder="$0.00" autoFocus style={{ fontSize: 28, fontWeight: '700', textAlign: 'center', minHeight: 60 }} />
          {yaEmbolsado > 0 ? (
            <>
              <Dato rotulo={bolsasDeHoy.length === 1 ? 'Ya en la bolsa de hoy' : `Ya en las ${bolsasDeHoy.length} bolsas de hoy`} valor={formatMoney(yaEmbolsado)} />
              <Dato rotulo="Se declara" valor={formatMoney(declarado)} fuerte />
            </>
          ) : null}
        </Seccion>
        <BotonGrande texto={ocupado ? 'Haciendo el corte…' : 'Hacer el corte'} color={MARCA.azul} deshabilitado={ocupado || !valido} onPress={cortar} />
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Hacer corte' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? undefined : 'height'}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
          contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          {nombreSala ? <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '700', marginHorizontal: 4 }}>{nombreSala}</Text> : null}
          {cuerpo}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

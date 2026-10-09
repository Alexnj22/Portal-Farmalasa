// Pagar un bono de promoción, NATIVO — `DialogoPagarBono` del portal: saca el
// monto del cajón y quien lo recibe se identifica con su carné (o su usuario),
// porque el bono se cobra EN PERSONA: si se identifica otro, no se paga (la
// base lo rechaza igual; decirlo acá evita llegar al rechazo).
//
// Primero se RESERVA el pago (`reservar_pago_bono`, que devuelve monto,
// concepto y la clave que impide pagarlo dos veces) y después se anota la
// salida del cajón (`operar-caja`) con esa clave. Si la salida falla, el vale
// de identidad ya se gastó: hay que volver a identificarse.
import { useState } from 'react';
import { Alert, ScrollView, Text } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { reservarPagoBono } from '@nucleo/data/bonosProducto';
import { anotarSalida } from '@nucleo/data/bolsas';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande } from '../componentes/formulario/Piezas';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';
import Identidad from '../componentes/Identidad';
import { comprobanteDelMovimiento } from '../componentes/cortes/papel';

export default function PagarBono() {
  const { sala, item: crudo } = useLocalSearchParams();
  const { user, hasPermission } = useAuth();
  const puedeOperar = hasPermission('caja_vales', 'can_edit');
  const sucursales = useStaffStore((s) => s.branches);
  const nombreSala = (sucursales || []).find((b) => String(b.id) === String(sala))?.name ?? '';
  const [item] = useState(() => { try { return JSON.parse(crudo); } catch { return null; } });
  const [identidad, setIdentidad] = useState(null);
  const [guardando, setGuardando] = useState(false);
  if (!item) return <Aviso tono="freno" texto="No se pudo leer el bono." />;

  const esBodega = item.tipo === 'bodega';
  const nombre = esBodega ? 'Bodega' : shortEmployeeName(item);
  const persona = identidad?.persona ?? null;
  const otraPersona = !esBodega && persona && persona.id !== item.employee_id;

  const pagar = () => Alert.alert(`¿Pagar ${formatMoney(item.monto)} a ${nombre}?`,
    `Sale del cajón de ${nombreSala} y lo recibe ${shortEmployeeName(persona)}.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Pagar', onPress: async () => {
        setGuardando(true);
        trabajando('Pagando el bono…');
        try {
          const r = await reservarPagoBono(item.item);
          const s = await anotarSalida({
            sala, monto: Number(r.monto), concepto: r.concepto, tipo: 'BONO_PROMOCION',
            recibidoPor: persona?.id ?? null, vale: identidad?.vale ?? null, clave: r.clave,
            detalle: r.concepto,
          });
          if (s?.error || !s?.ok) { setIdentidad(null); throw s?.error || new Error('La caja no aceptó la salida.'); }
          const papel = s.movimiento ? await comprobanteDelMovimiento(s.movimiento, {
            etiqueta: 'Bono de promoción', detalle: `${r.concepto} · ${nombre}`,
            persona: persona?.name || '', comoSeComprobo: s.movimiento.recibido_metodo,
          }, sala, nombreSala, user?.name || '') : { ok: true };
          if (s.aviso) fallo('Bono pagado, con un pendiente', s.aviso);
          else if (!papel.ok) fallo('Bono pagado, pero el comprobante no salió', papel.detalle);
          else listo('Bono pagado', `${nombre} · ${formatMoney(r.monto)}`);
          router.back();
        } catch (e) {
          setIdentidad(null);
          fallo('No se pudo pagar', mensajeAmigable(e, 'Vuelve a intentarlo.'));
        } finally { setGuardando(false); }
      } },
    ]);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Pagar bono' }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic">
        <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '700', marginHorizontal: 4 }}>{nombre}</Text>
        <Text style={{ color: colorSistema.texto2, fontSize: 15, marginHorizontal: 4 }}>
          {`${item.promocion || ''}${item.tipo === 'excedente' ? ' (excedente aprobado)' : ''}. Saca ${formatMoney(item.monto)} del cajón y entrégalo ${esBodega ? 'a quien recibe por bodega' : `a ${nombre}`}.`}
        </Text>
        {!puedeOperar ? <Aviso tono="freno" texto="Pagar bonos es de quien opera la caja." /> : (
          <>
            <Identidad identidad={identidad} onIdentidad={setIdentidad} titulo={`Escanea el carné de ${esBodega ? 'quien recibe' : nombre}`} />
            {otraPersona ? <Aviso tono="freno" texto={`Se identificó ${shortEmployeeName(persona)}, pero el bono es de ${nombre}. Lo tiene que recibir la persona que lo ganó.`} /> : null}
            <BotonGrande texto={guardando ? 'Pagando…' : `Pagar ${formatMoney(item.monto)}`} color={MARCA.verde}
              deshabilitado={guardando || !persona || !identidad?.vale || otraPersona} onPress={pagar} />
          </>
        )}
      </ScrollView>
    </>
  );
}

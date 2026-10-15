// La pestaña «Nómina y acceso» de la ficha, como en el portal:
//
//  · Dónde se le deposita: banco (lista del núcleo `BANCOS`), tipo y número de
//    cuenta. Sólo con la llave de salarios (`staff_salary` en el alta, o la
//    marca `salario_conocido` que pone el servidor al editar).
//  · Acceso a la app y al portal: el usuario es la CREDENCIAL. En el alta sale
//    del nombre; al editar, si el nombre cambió, se ofrece el nuevo — y
//    guardarlo lo renombra con la cuenta (`updateEmployee`), nunca a secas.
//    «Todavía no tiene carné» habilita imprimirle uno de papel.
//  · Seguridad del kiosco: el código de carné (sólo números; «Generar» pide
//    al servidor uno libre) y el PIN de las barras, que se deriva del código
//    (`pinDeKiosco`, núcleo — el mismo cálculo del trigger) y se puede copiar.
import { Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { BANCOS } from '@nucleo/constants/bancos';
import { ACCOUNT_TYPE_OPTIONS, proponerCodigoDeCarne } from '@nucleo/utils/fichaDelEmpleado';
import { codigoDeCarneLibre } from '@nucleo/data/employees';
import { pinDeKiosco } from '@nucleo/utils/pinDeKiosco';
import { colorSistema } from '../../Formulario';
import { Seccion } from '../../formulario/Piezas';
import { MARCA } from '../../inicio/marca';
import { fallo, listo } from '../../Progreso';
import { Interruptor } from '../Formulario';
import { CampoConRotulo, Elegir, Enlace, Nota, op } from './Piezas';

export function Banco({ form, cambiar }) {
  return (
    <Seccion titulo="Dónde se le deposita">
      <Elegir rotulo="Banco (planilla)" valor={form.bank_name || ''} opciones={op(BANCOS)} onCambiar={cambiar('bank_name')} vacio="Sin indicar" />
      <Elegir rotulo="Tipo de cuenta" valor={form.account_type || 'AHORRO'} opciones={op(ACCOUNT_TYPE_OPTIONS)} onCambiar={cambiar('account_type')} />
      <CampoConRotulo rotulo="Número de cuenta" value={form.account_number || ''} keyboardType="number-pad" placeholder="0000-0000-00"
        onChangeText={(t) => cambiar('account_number')(t.replace(/[^0-9-]/g, '').substring(0, 25))} />
    </Seccion>
  );
}

export default function Acceso({ form, setForm, cambiar, esAlta, usuarioSugerido, usuarioGuardado, credencialesListas }) {
  const usuario = esAlta ? usuarioSugerido : (form.username || '');
  const quedoViejo = !esAlta && !!usuarioSugerido && usuario.toLowerCase() !== usuarioSugerido;
  const vaACambiar = !esAlta && !!usuarioGuardado && usuario.toLowerCase() !== usuarioGuardado;
  const pin = form.code ? pinDeKiosco(form.code) : '';
  const generar = async () => {
    const nuevo = await proponerCodigoDeCarne(codigoDeCarneLibre);
    if (nuevo) setForm((f) => ({ ...f, code: nuevo }));
    else fallo('No se pudo generar un código', 'Escríbelo a mano y comprueba que no esté en uso.');
  };
  const copiar = async () => { await Clipboard.setStringAsync(pin); listo('PIN copiado', pin); };

  return (
    <>
      <Seccion titulo="Acceso a la app y al portal">
        <CampoConRotulo rotulo={esAlta ? 'Usuario (se arma con el nombre)' : 'Usuario'} value={usuario || '…'} editable={false} />
        {quedoViejo ? (
          <>
            <Nota tono="cuidado" texto={`El usuario ya no corresponde al nombre. Con él entra al portal: si lo cambias a ${usuarioSugerido}, desde la próxima vez tendrá que entrar con ese. La contraseña no cambia.`} />
            <Enlace texto={`Usar ${usuarioSugerido}`} onPress={() => cambiar('username')(usuarioSugerido)} />
          </>
        ) : null}
        {!quedoViejo && vaACambiar ? (
          <>
            <Nota tono="cuidado" texto={`Al guardar, entrará con ${usuario} en vez de ${usuarioGuardado}. La contraseña no cambia.`} />
            <Enlace texto={`Dejar ${usuarioGuardado}`} onPress={() => cambiar('username')(usuarioGuardado)} />
          </>
        ) : null}
        <Interruptor titulo="Todavía no tiene carné" valor={!!form.carne_pendiente} onCambiar={cambiar('carne_pendiente')}
          detalle={esAlta ? 'Al guardar se le muestra su contraseña temporal para entregársela.' : 'Puedes imprimirle un carné de papel desde su perfil. Vale hasta medianoche.'} />
      </Seccion>

      <Seccion titulo="Seguridad del kiosco" pie="Sólo números. El PIN de las barras se deriva del código (SHA-256).">
        {!credencialesListas ? <Nota texto="Cargando el código de carné…" /> : (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <CampoConRotulo rotulo="Código de empleado" requerido value={form.code || ''} keyboardType="number-pad" placeholder="Ej. 1024"
                  onChangeText={(t) => cambiar('code')(t.replace(/\D/g, ''))} />
              </View>
              <Enlace texto="Generar" onPress={generar} />
            </View>
            {pin ? (
              <View style={{ gap: 6 }}>
                <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600' }}>PIN del carné</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={{ flex: 1, minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: MARCA.violeta }}>
                    <Text selectable style={{ color: '#fff', fontSize: 18, fontWeight: '800', letterSpacing: 4 }}>{pin}</Text>
                  </View>
                  <Enlace texto="Copiar" onPress={copiar} />
                </View>
                <Nota texto="Este es el valor del código de barras del carné." />
              </View>
            ) : null}
          </>
        )}
      </Seccion>
    </>
  );
}

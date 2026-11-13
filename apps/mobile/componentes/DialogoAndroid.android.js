// El diálogo de Android: el AlertDialog de Material 3 de Compose (2026-11-13,
// «TODO debe ser material nuevo en android»).
//
// Lo dibuja <HojasAndroid /> para dos llamadas de React Native que la app usa
// en ~230 pantallas, con la MISMA firma:
//   · `Alert.alert` — en Android, React Native abre el AlertDialog viejo de la
//     plataforma: esquinas chicas, botones en mayúsculas y SIN los colores del
//     sistema. Se nota «portado» al lado de las hojas y los controles Material.
//   · `Alert.prompt` — no existe en Android (no hace nada); antes lo dibujaba
//     un Modal hecho a mano.
//
// Los colores salen de la paleta del sistema que se lee en vivo
// (tema/material.js), no del Host: el proceso de la app tiene los colores
// congelados desde que cargó el WebView (ver modules/colores-sistema).
import { useEffect } from 'react';
import { AlertDialog, Column, Host, OutlinedTextField, Row, Text, TextButton, useNativeState } from '@expo/ui/jetpack-compose';
import { fillMaxWidth } from '@expo/ui/jetpack-compose/modifiers';
import { SEMILLA, usePaleta } from '../tema/material';

// El tipo de teclado de React Native → el de Compose.
const TECLADO = {
  numeric: 'number', 'number-pad': 'number', 'decimal-pad': 'decimal',
  'email-address': 'email', 'phone-pad': 'phone', url: 'uri',
};

function Campo({ hoja, paleta, onCambio }) {
  const valor = useNativeState(hoja.valor ?? '');
  useEffect(() => { onCambio(hoja.valor ?? ''); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <OutlinedTextField value={valor} onValueChange={onCambio} autoFocus
      singleLine={!!hoja.secreto} maxLines={hoja.secreto ? 1 : 4}
      visualTransformation={hoja.secreto ? 'password' : 'none'}
      keyboardOptions={{ keyboardType: hoja.secreto ? 'password' : (TECLADO[hoja.teclado] ?? 'text'), capitalization: 'sentences' }}
      colors={paleta ? {
        focusedTextColor: paleta.onSurface, unfocusedTextColor: paleta.onSurface,
        focusedIndicatorColor: paleta.primary, unfocusedIndicatorColor: paleta.outline, cursorColor: paleta.primary,
      } : undefined}
      modifiers={[fillMaxWidth()]} />
  );
}

export default function DialogoAndroid({ hoja, cerrar, cancelar, alEscribir }) {
  const paleta = usePaleta();
  const botones = hoja.botones?.length ? hoja.botones : [{ text: 'Aceptar' }];
  const cancelable = hoja.tipo === 'texto' || !!hoja.cancelable;
  const colorDe = (b) => (b.style === 'destructive' ? paleta?.error : paleta?.primary);
  const lista = botones.map((b, i) => (
    <TextButton key={i} onClick={() => cerrar(() => b.onPress?.(hoja.tipo === 'texto' ? hoja.texto?.() : undefined))}
      colors={{ contentColor: colorDe(b) }}>
      <Text style={{ fontSize: 14, fontWeight: '600' }}>{String(b.text ?? 'Aceptar')}</Text>
    </TextButton>
  ));
  // Material 3: los botones van a la derecha, en fila; con más de dos (o
  // textos largos) se apilan, también a la derecha.
  const apilados = botones.length > 2 || botones.some((b) => String(b.text ?? '').length > 18);
  return (
    <Host seedColor={SEMILLA} style={{ position: 'absolute', width: 1, height: 1 }}>
      <AlertDialog onDismissRequest={cancelable ? cancelar : undefined}
        properties={{ dismissOnBackPress: cancelable, dismissOnClickOutside: cancelable }}
        colors={paleta ? { containerColor: paleta.surfaceContainerHigh, titleContentColor: paleta.onSurface, textContentColor: paleta.onSurfaceVariant } : undefined}>
        {hoja.titulo ? <AlertDialog.Title><Text style={{ fontSize: 24 }}>{String(hoja.titulo)}</Text></AlertDialog.Title> : null}
        {hoja.mensaje || hoja.tipo === 'texto' ? (
          <AlertDialog.Text>
            {hoja.tipo === 'texto' ? (
              <Column verticalArrangement={{ spacedBy: 16 }}>
                {hoja.mensaje ? <Text color={paleta?.onSurfaceVariant}>{String(hoja.mensaje)}</Text> : null}
                <Campo hoja={hoja} paleta={paleta} onCambio={alEscribir} />
              </Column>
            ) : <Text>{String(hoja.mensaje)}</Text>}
          </AlertDialog.Text>
        ) : null}
        <AlertDialog.ConfirmButton>
          {apilados
            ? <Column horizontalAlignment="end">{lista}</Column>
            : <Row horizontalArrangement={{ spacedBy: 8 }}>{lista}</Row>}
        </AlertDialog.ConfirmButton>
      </AlertDialog>
    </Host>
  );
}

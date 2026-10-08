// Android: el botón Material de @expo/ui a todo el ancho (2026-10-08).
//
// No es `BotonNativo.js` con otro estilo por gusto: en Android el `style` del
// botón universal se traduce a modificadores de Compose, y `width` ahí sólo
// acepta números. Con `width: '100%'` la app se CERRABA al abrir Bienvenida
// («Cannot cast value for field 'width' ('int') in record '100%'»), o sea en
// la primera pantalla de cualquier Android. El ancho completo es el
// modificador `fillMaxWidth`. La web sigue con `BotonNativo.js`.
import { Button, Host } from '@expo/ui';
import { fillMaxWidth } from '@expo/ui/jetpack-compose/modifiers';
import * as Haptics from 'expo-haptics';

export default function BotonNativo({ etiqueta, alTocar, variante = 'filled', deshabilitado = false, color }) {
  return (
    <Host matchContents={{ vertical: true }} style={{ width: '100%' }} seedColor={color}>
      <Button variant={variante} label={etiqueta} disabled={deshabilitado} modifiers={[fillMaxWidth()]}
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); alTocar?.(); }} />
    </Host>
  );
}

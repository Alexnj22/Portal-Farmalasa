// Android y la vista previa web: el botón universal de @expo/ui (Material en
// Android). En iPhone, `BotonNativo.ios.js`.
import { Button, Host } from '@expo/ui';

export default function BotonNativo({ etiqueta, alTocar, variante = 'filled', deshabilitado = false, color }) {
  return (
    <Host matchContents={{ vertical: true }} style={{ width: '100%' }} seedColor={color}>
      <Button variant={variante} label={etiqueta} disabled={deshabilitado} onPress={alTocar} style={{ width: '100%' }} />
    </Host>
  );
}

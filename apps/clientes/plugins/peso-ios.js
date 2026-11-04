// El PESO de la app en iOS (2026-11-04): quitar los símbolos LOCALES de los
// frameworks embebidos. `ios/` NO está en git (lo regenera
// `expo prebuild -p ios --clean` en scripts/subir-ios.mjs), así que va por
// aquí y no editando ios/ a mano.
//
// Por qué hace falta: con `EXPO_USE_PRECOMPILED_MODULES=1` y React Native
// precompilado, TODOS los frameworks de PuntosSalud.app/Frameworks llegan ya
// compilados (React, hermesvm, ExpoModulesCore, SDWebImage, …) y la fase
// «[CP] Embed Pods Frameworks» los copia tal cual: los ajustes STRIP_* de los
// Pods no los alcanzan, porque no se compilan aquí. Medido sobre el archivo
// del 2026-11-04 con `strip -x`: React 12.0→5.8 MB, hermesvm 5.1→2.3 MB,
// ExpoModulesCore 3.8→2.0 MB; ~2 MB menos ya comprimido. El binario de la app
// ya venía sin símbolos.
//
// `strip -x` quita sólo los símbolos locales (no exportados): es lo mismo que
// Xcode hace por defecto con un framework (STRIP_STYLE = non-global). El
// enlace dinámico usa los exportados, que se quedan. Los dSYM no cambian (el
// UUID es el mismo), así que la simbolización con dSYM sigue igual.
//
// La firma: la fase corre DESPUÉS de embeber y ANTES de la firma final de la
// app. subir-ios.mjs archiva sin firmar (CODE_SIGNING_ALLOWED=NO) y la
// exportación firma todo de nuevo, así que ahí no hay nada que cuidar. Si un
// día se compila firmando (Xcode, `expo run:ios --configuration Release`),
// la fase vuelve a firmar cada framework con la misma identidad que usó
// CocoaPods, porque `strip` invalida la firma anterior.
//
// Interruptor: `PESO_SIN_STRIP=1` en el entorno de la compilación la salta.
//
// Se agrega desde el Podfile (`post_integrate`) y no con withXcodeProject
// porque la fase de CocoaPods que embebe los frameworks nace en `pod install`,
// después de los mods: agregada antes, correría antes de que haya qué achicar.
const { withPodfile } = require('expo/config-plugins');

const MARCA = '# peso-ios: quitar símbolos locales de los frameworks embebidos';

const GUION = [
  'set -e',
  '[ "$CONFIGURATION" = "Release" ] || exit 0',
  'if [ "${PESO_SIN_STRIP:-0}" = "1" ]; then echo "peso-ios: PESO_SIN_STRIP=1, no se tocan los frameworks"; exit 0; fi',
  'dir="${TARGET_BUILD_DIR}/${FRAMEWORKS_FOLDER_PATH}"',
  '[ -d "$dir" ] || exit 0',
  'for fw in "$dir"/*.framework; do',
  '  [ -d "$fw" ] || continue',
  '  nombre=$(/usr/libexec/PlistBuddy -c "Print :CFBundleExecutable" "$fw/Info.plist" 2>/dev/null || basename "$fw" .framework)',
  '  bin="$fw/$nombre"',
  '  [ -f "$bin" ] || continue',
  '  if ! salida=$(xcrun strip -x "$bin" 2>&1); then echo "error: peso-ios: strip -x falló en $bin: $salida"; exit 1; fi',
  '  if [ "${CODE_SIGNING_ALLOWED}" = "YES" ] && [ -n "${EXPANDED_CODE_SIGN_IDENTITY}" ]; then',
  '    /usr/bin/codesign --force --sign "${EXPANDED_CODE_SIGN_IDENTITY}" ${OTHER_CODE_SIGN_FLAGS:-} --preserve-metadata=identifier,entitlements "$fw"',
  '  fi',
  'done',
  '',
].join('\n');

const RUBY = `
${MARCA} (plugins/peso-ios.js)
post_integrate do |installer|
  fase = '[Peso] Quitar símbolos locales de los frameworks'
  guion = <<~'GUION'
${GUION.split('\n').map((l) => (l ? '    ' + l : l)).join('\n')}
  GUION
  installer.aggregate_targets.each do |agregado|
    proyecto = agregado.user_project
    cambiado = false
    agregado.user_targets.each do |objetivo|
      next unless objetivo.product_type == 'com.apple.product-type.application'
      next if objetivo.shell_script_build_phases.any? { |f| f.name == fase }
      f = objetivo.new_shell_script_build_phase(fase)
      f.shell_script = guion
      f.show_env_vars_in_log = '0'
      f.always_out_of_date = '1'
      cambiado = true
    end
    proyecto.save if cambiado
  end
end
`;

module.exports = function pesoIos(config) {
  return withPodfile(config, (c) => {
    if (!c.modResults.contents.includes(MARCA)) c.modResults.contents += RUBY;
    return c;
  });
};

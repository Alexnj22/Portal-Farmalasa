// iOS 27 cierra al abrir la app que no adopta el ciclo de vida por ESCENAS:
// UIKit dispara EXC_BREAKPOINT en
// `_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption` antes de
// pintar nada. Pasa sólo al compilar con el SDK de iOS 27 (Xcode 27, esta Mac);
// las compilaciones de EAS usaban otro Xcode y no lo sufrían. Medido el
// 2026-10-06: Puntos Salud compilación 1 se cerraba al abrir en TestFlight, y
// en el simulador con el mismo informe.
//
// Expo 57 ya trae la pieza (`ExpoAppSceneDelegate`, que crea la ventana desde
// la escena y arranca React Native ahí), pero la plantilla de `prebuild`
// todavía no la conecta. Este plugin hace las dos cosas que faltan:
//   1. Info.plist: declara la escena con ese delegado.
//   2. AppDelegate: deja de crear su propia ventana (la crea la escena) y
//      expone la fábrica de React Native por `ExpoReactNativeFactoryProvider`.
// El día que la plantilla lo traiga, el plugin no encuentra qué cambiar y
// lanza: así se nota y se borra.
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

const VENTANA_PROPIA = `#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif
`;

module.exports = function cicloPorEscenas(config) {
  config = withInfoPlist(config, (c) => {
    c.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [{
          UISceneConfigurationName: 'Default Configuration',
          UISceneDelegateClassName: 'EXExpoAppSceneDelegate',
        }],
      },
    };
    return c;
  });
  return withAppDelegate(config, (c) => {
    let s = c.modResults.contents;
    if (s.includes('ExpoReactNativeFactoryProvider')) return c;
    const clase = 'class AppDelegate: ExpoAppDelegate {';
    if (!s.includes(clase) || !s.includes(VENTANA_PROPIA)) {
      throw new Error('ciclo-por-escenas: el AppDelegate de la plantilla cambió; revisar si ya adopta escenas y borrar este plugin.');
    }
    s = s.replace(clase, 'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {');
    s = s.replace(VENTANA_PROPIA, '    // La ventana la crea la escena (ExpoAppSceneDelegate), no el AppDelegate.\n');
    c.modResults.contents = s;
    return c;
  });
};

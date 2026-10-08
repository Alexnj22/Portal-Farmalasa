// La tarjeta de socio en Apple Wallet, con la HOJA del sistema
// (PKAddPassesViewController): la persona ve la tarjeta y toca «Agregar», sin
// salir de la app ni ver un enlace. Antes se abría un enlace de descarga en
// Safari, que mostraba la dirección del servidor (2026-10-06).
//
// `tiene` pregunta a la biblioteca de Wallet si la tarjeta ya está, para que la
// app cambie «Agregar» por «Ver en Wallet».
import ExpoModulesCore
import PassKit

public class WalletModule: Module {
  private var promesaHoja: Promise?
  private var serialHoja: (String, String)?

  public func definition() -> ModuleDefinition {
    Name("Wallet")

    // El botón OFICIAL «Agregar a Apple Wallet» (2026-10-07): las guías de
    // Apple piden PKAddPassButton y no uno dibujado a mano.
    View(BotonWalletView.self) {
      Events("onPress")
    }

    Function("disponible") { () -> Bool in
      PKAddPassesViewController.canAddPasses()
    }

    Function("tiene") { (tipo: String, serial: String) -> Bool in
      PKPassLibrary().pass(withPassTypeIdentifier: tipo, serialNumber: serial) != nil
    }

    // Abre la tarjeta ya agregada, en Wallet.
    Function("abrir") { (tipo: String, serial: String) -> Bool in
      guard let pase = PKPassLibrary().pass(withPassTypeIdentifier: tipo, serialNumber: serial),
            let url = pase.passURL else { return false }
      DispatchQueue.main.async { UIApplication.shared.open(url) }
      return true
    }

    // Recibe el .pkpass en base64 y presenta la hoja. Devuelve si quedó agregada.
    AsyncFunction("agregar") { (base64: String, promise: Promise) in
      guard let datos = Data(base64Encoded: base64) else {
        promise.reject("WALLET_DATOS", "La tarjeta llegó dañada."); return
      }
      let pase: PKPass
      do { pase = try PKPass(data: datos) } catch {
        promise.reject("WALLET_PASE", "No se pudo leer la tarjeta: \(error.localizedDescription)"); return
      }
      // Si Wallet ya la tiene (también si está oculta en «Pases ocultos»), la
      // hoja de Apple sale VACÍA (2026-10-07): se reemplaza en silencio con la
      // versión nueva y se abre en Wallet.
      let biblioteca = PKPassLibrary()
      if biblioteca.pass(withPassTypeIdentifier: pase.passTypeIdentifier, serialNumber: pase.serialNumber) != nil {
        _ = biblioteca.replacePass(with: pase)
        if let url = biblioteca.pass(withPassTypeIdentifier: pase.passTypeIdentifier, serialNumber: pase.serialNumber)?.passURL {
          UIApplication.shared.open(url)
        }
        promise.resolve(true); return
      }
      // Primero, la alerta del SISTEMA («¿Agregar a Wallet?»): no depende de
      // presentar una vista nuestra, que en iOS 26/27 sobre las pestañas
      // nativas salía en NEGRO (2026-10-07). Sólo si el sistema pide revisarla
      // se muestra la hoja clásica.
      biblioteca.addPasses([pase]) { estado in
        DispatchQueue.main.async {
          switch estado {
          case .didAddPasses:
            promise.resolve(true)
          case .didCancelAddPasses:
            promise.resolve(false)
          default:
            self.presentarHoja(pase, promise)
          }
        }
      }
    }.runOnQueue(.main)
  }

  private func presentarHoja(_ pase: PKPass, _ promise: Promise) {
      guard let hoja = PKAddPassesViewController(pass: pase) else {
        promise.reject("WALLET_HOJA", "Este teléfono no puede agregar tarjetas."); return
      }
      self.promesaHoja = promise
      self.serialHoja = (pase.passTypeIdentifier, pase.serialNumber)
      hoja.delegate = self.delegado
      self.delegado.alCerrar = { [weak self] in self?.terminar() }
      // En una VENTANA PROPIA (2026-10-08): presentada sobre las pestañas
      // nativas salía en negro. Una ventana nueva, encima de todo, con un
      // controlador vacío y transparente, no hereda nada de la jerarquía de la app.
      guard let escena = UIApplication.shared.connectedScenes
        .compactMap({ $0 as? UIWindowScene })
        .first(where: { $0.activationState == .foregroundActive }) ?? UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first else {
        promise.reject("WALLET_VISTA", "No se pudo mostrar la tarjeta."); return
      }
      let ventana = UIWindow(windowScene: escena)
      ventana.windowLevel = .alert + 1
      let base = UIViewController()
      base.view.backgroundColor = .clear
      ventana.rootViewController = base
      ventana.makeKeyAndVisible()
      self.ventanaHoja = ventana
      hoja.modalPresentationStyle = .pageSheet
      // Sin cerrar deslizando: la hoja tiene «Cancelar» y «Agregar», y así el
      // delegado siempre avisa y la ventana nunca queda tapando la app.
      hoja.isModalInPresentation = true
      base.present(hoja, animated: true)
  }

  private var ventanaHoja: UIWindow?

  private let delegado = Delegado()

  private func terminar() {
    ventanaHoja?.isHidden = true
    ventanaHoja = nil
    guard let promesa = promesaHoja, let (tipo, serial) = serialHoja else { return }
    promesaHoja = nil
    promesa.resolve(PKPassLibrary().pass(withPassTypeIdentifier: tipo, serialNumber: serial) != nil)
  }
}

final class Delegado: NSObject, PKAddPassesViewControllerDelegate {
  var alCerrar: (() -> Void)?
  func addPassesViewControllerDidFinish(_ controller: PKAddPassesViewController) {
    controller.dismiss(animated: true) { self.alCerrar?() }
  }
}

final class BotonWalletView: ExpoView {
  let onPress = EventDispatcher()
  private let boton = PKAddPassButton(addPassButtonStyle: .black)

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    boton.addTarget(self, action: #selector(tocado), for: .touchUpInside)
    addSubview(boton)
  }

  @objc private func tocado() { onPress([:]) }

  override func layoutSubviews() {
    super.layoutSubviews()
    boton.frame = bounds
  }
}

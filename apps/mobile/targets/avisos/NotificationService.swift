// Cada aviso con `mutableContent` pasa por acá antes de mostrarse (iOS).
//
// Lo que hace:
//  1. Lo agrupa por tema (`data.tema`: traslados, solicitudes, caja…), porque
//     el servicio de Expo no deja mandar el hilo directo.
//  2. Si trae renglones, adjunta la TARJETA dibujada como imagen
//     (`Tarjeta.swift`): es lo que se ve al mantener presionado.
//  3. Si la tarjeta trae quién lo originó, lo vuelve un aviso de COMUNICACIÓN:
//     la foto de esa persona en lugar del ícono de la app, como en Mensajes. El
//     título original ("Ana te pide un traslado") pasa a subtítulo.
//
// Nada de esto puede costar el aviso: si algo falla, se entrega tal cual llegó,
// y si el sistema corta el tiempo (`serviceExtensionTimeWillExpire`), también.
import Intents
import UIKit
import UserNotifications

class NotificationService: UNNotificationServiceExtension {
  private var contentHandler: ((UNNotificationContent) -> Void)?
  private var mejorHastaAhora: UNMutableNotificationContent?

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    self.contentHandler = contentHandler
    guard let content = request.content.mutableCopy() as? UNMutableNotificationContent else {
      contentHandler(request.content)
      return
    }
    mejorHastaAhora = content

    let datos = Datos.de(content.userInfo)
    if let tema = datos["tema"] as? String, !tema.isEmpty {
      content.threadIdentifier = tema
    }

    let tarjeta = datos["tarjeta"] as? [String: Any]
    let quien = tarjeta?["quien"] as? [String: Any]
    let nombre = (quien?["nombre"] as? String).flatMap { $0.isEmpty ? nil : $0 }
    let modelo = Modelo(tarjeta: tarjeta)
    if nombre == nil && modelo == nil {
      contentHandler(content)
      return
    }

    let foto = (quien?["foto"] as? String).flatMap(URL.init(string:))
    Self.bajar(foto) { imagen in
      DispatchQueue.main.async {
        if let modelo, let adjunto = ImagenDeTarjeta.adjunto(modelo, foto: imagen) {
          content.attachments = [adjunto]
        }
        if let nombre {
          contentHandler(Self.comoComunicacion(content, nombre: nombre, imagen: imagen) ?? content)
        } else {
          contentHandler(content)
        }
      }
    }
  }

  override func serviceExtensionTimeWillExpire() {
    if let contentHandler, let mejorHastaAhora { contentHandler(mejorHastaAhora) }
  }

  private static func bajar(_ url: URL?, _ listo: @escaping (Data?) -> Void) {
    guard let url else { listo(nil); return }
    var pedido = URLRequest(url: url)
    pedido.timeoutInterval = 8
    URLSession.shared.dataTask(with: pedido) { data, respuesta, _ in
      let ok = (respuesta as? HTTPURLResponse)?.statusCode == 200
      listo(ok ? data : nil)
    }.resume()
  }

  private static func comoComunicacion(
    _ content: UNMutableNotificationContent, nombre: String, imagen: Data?
  ) -> UNNotificationContent? {
    // El título pasa a subtítulo: en un aviso de comunicación el título es el
    // nombre de quien lo manda.
    if content.subtitle.isEmpty || content.subtitle == nombre { content.subtitle = content.title }

    let persona = INPerson(
      personHandle: INPersonHandle(value: nombre, type: .unknown),
      nameComponents: nil,
      displayName: nombre,
      image: imagen.map { INImage(imageData: $0) },
      contactIdentifier: nil,
      customIdentifier: nombre
    )
    let intent = INSendMessageIntent(
      recipients: nil,
      outgoingMessageType: .outgoingMessageText,
      content: content.body,
      speakableGroupName: nil,
      conversationIdentifier: content.threadIdentifier,
      serviceName: nil,
      sender: persona,
      attachments: nil
    )
    if let img = persona.image { intent.setImage(img, forParameterNamed: \.sender) }
    let interaccion = INInteraction(intent: intent, response: nil)
    interaccion.direction = .incoming
    interaccion.donate(completion: nil)
    return try? content.updating(from: intent)
  }
}

// Los datos del aviso. Expo los manda en `body` (a veces como texto JSON).
enum Datos {
  static func de(_ info: [AnyHashable: Any]) -> [String: Any] {
    if let d = info["body"] as? [String: Any] { return d }
    if let s = info["body"] as? String, let data = s.data(using: .utf8),
       let d = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] { return d }
    if let d = info["data"] as? [String: Any] { return d }
    return [:]
  }
}

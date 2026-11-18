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
//  4. Si no trae tarjeta pero sí `data.imagen` (una URL https de una foto: un
//     producto, un comunicado), la adjunta (2026-11-18). La tarjeta gana: es
//     la imagen que ya resume el aviso. Esto exige binario; cuál aviso manda
//     imagen se decide en el servidor, sin compilar.
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
    let imagenURL = modelo == nil
      ? (datos["imagen"] as? String).flatMap(URL.init(string:)).flatMap { $0.scheme == "https" ? $0 : nil }
      : nil
    if nombre == nil && modelo == nil && imagenURL == nil {
      contentHandler(content)
      return
    }

    let foto = (quien?["foto"] as? String).flatMap(URL.init(string:))
    Self.bajar(foto) { imagen in
     Self.bajarConTipo(imagenURL) { extra in
      DispatchQueue.main.async {
        if let modelo, let adjunto = ImagenDeTarjeta.adjunto(modelo, foto: imagen) {
          content.attachments = [adjunto]
        } else if let extra, let adjunto = Self.adjuntoDeImagen(extra.datos, tipo: extra.tipo) {
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

  /// Como `bajar`, pero con el tipo que dice el servidor: una URL firmada no
  /// trae extensión, y el sistema decide por la extensión del archivo.
  private static func bajarConTipo(_ url: URL?, _ listo: @escaping ((datos: Data, tipo: String)?) -> Void) {
    guard let url else { listo(nil); return }
    var pedido = URLRequest(url: url)
    pedido.timeoutInterval = 8
    URLSession.shared.dataTask(with: pedido) { data, respuesta, _ in
      guard let http = respuesta as? HTTPURLResponse, http.statusCode == 200, let data, !data.isEmpty else {
        listo(nil); return
      }
      listo((data, (http.mimeType ?? "").lowercased()))
    }.resume()
  }

  /// La foto como adjunto del aviso. Sólo los formatos que el sistema muestra;
  /// cualquier otro (webp, svg) se descarta y el aviso sale sin imagen.
  private static func adjuntoDeImagen(_ datos: Data, tipo: String) -> UNNotificationAttachment? {
    let ext: String
    switch tipo {
    case "image/jpeg", "image/jpg": ext = "jpg"
    case "image/png": ext = "png"
    case "image/gif": ext = "gif"
    case "image/heic": ext = "heic"
    default: return nil
    }
    let archivo = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString)
      .appendingPathExtension(ext)
    do {
      try datos.write(to: archivo)
      return try UNNotificationAttachment(identifier: "imagen", url: archivo, options: nil)
    } catch {
      return nil
    }
  }

  private static func comoComunicacion(
    _ content: UNMutableNotificationContent, nombre: String, imagen: Data?
  ) -> UNNotificationContent? {
    // El título pasa a subtítulo: en un aviso de comunicación el título es el
    // nombre de quien lo manda. Y sin repetir ese nombre: «Ana López te pide un
    // traslado» debajo de «Ana López» se lee dos veces; queda «Te pide un
    // traslado» (usuario, 2026-09-30: «muy bien estructuradas»).
    if content.subtitle.isEmpty || content.subtitle == nombre {
      var sub = content.title
      if let r = sub.range(of: nombre, options: [.caseInsensitive, .diacriticInsensitive, .anchored]) {
        sub = sub[r.upperBound...].trimmingCharacters(in: .whitespaces)
        sub = sub.prefix(1).uppercased() + sub.dropFirst()
      }
      content.subtitle = sub
    }

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

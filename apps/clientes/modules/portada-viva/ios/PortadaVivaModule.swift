// Lo que suena en la pantalla bloqueada del iPhone, con portada VIVA desde
// iOS 26 (2026-11-10: «podemos hacer live estas fotos? creo que ios lo acepta»).
//
// Por qué un módulo propio y no el aviso de react-native-audio-api: aquél
// rehace `nowPlayingInfo` entero en cada cambio y no conoce la portada animada,
// así que cualquier clave que se le agregara por fuera se borraba en el
// siguiente toque. Además limita la portada fija a 1024 px, y en la pantalla
// completa de iOS 26 eso se estira casi tres veces y se ve borroso. Acá se
// manejan las dos cosas, la información y los botones (reproducir, pausa,
// detener), y la decisión de QUÉ mostrar sigue en lib/ruido.js.
//
// La portada viva son dos videos en bucle exacto que trae la app
// (assets/sonidos/vivas): 3:4 para la pantalla completa y 1:1 para el
// reproductor chico. Si el sistema no los soporta (antes de iOS 26, o un
// equipo que no la muestra), queda la portada fija.
import ExpoModulesCore
import MediaPlayer
import AVFoundation
import UIKit

struct DatosAviso: Record {
  /// Identifica el ambiente: con la misma clave no se rehacen las portadas.
  @Field var clave: String = ""
  @Field var titulo: String = ""
  @Field var artista: String = ""
  /// `file://` de la portada fija.
  @Field var portada: String? = nil
  @Field var videoAlto: String? = nil
  @Field var videoCuadrado: String? = nil
  @Field var sonando: Bool = true
  /// Segundos que le quedan al temporizador; sin temporizador, nada.
  @Field var resta: Double? = nil
}

private func archivo(_ uri: String?) -> URL? {
  guard let uri, !uri.isEmpty else { return nil }
  let u = uri.hasPrefix("file://") ? URL(string: uri) : URL(fileURLWithPath: uri)
  guard let u, FileManager.default.fileExists(atPath: u.path) else { return nil }
  return u
}

/// El primer cuadro del video: lo que el sistema muestra mientras lo carga.
private func primerCuadro(_ u: URL) -> UIImage? {
  let g = AVAssetImageGenerator(asset: AVURLAsset(url: u))
  g.appliesPreferredTrackTransform = true
  g.requestedTimeToleranceBefore = .zero
  g.requestedTimeToleranceAfter = .zero
  guard let cg = try? g.copyCGImage(at: .zero, actualTime: nil) else { return nil }
  return UIImage(cgImage: cg)
}

public class PortadaVivaModule: Module {
  private var conectado = false
  private var sonando = false
  private var titulo = ""
  private var artista = ""
  private var resta: Double? = nil
  private var clavePortada: String? = nil
  private var portada: UIImage? = nil
  private var claveVivas: String? = nil
  private var vivas: [String: Any] = [:]

  public func definition() -> ModuleDefinition {
    Name("PortadaViva")
    Events("alPausar", "alReanudar", "alDetener")

    /// ¿Este iPhone muestra portadas animadas?
    Function("animada") { () -> Bool in
      if #available(iOS 26.0, *) { return !MPNowPlayingInfoCenter.supportedAnimatedArtworkKeys.isEmpty }
      return false
    }

    AsyncFunction("mostrar") { (d: DatosAviso) in
      self.mostrar(d)
    }.runOnQueue(.main)

    AsyncFunction("ocultar") {
      self.ocultar()
    }.runOnQueue(.main)
  }

  private func mostrar(_ d: DatosAviso) {
    conectar()
    sonando = d.sonando
    titulo = d.titulo
    artista = d.artista
    resta = d.resta
    if d.portada != clavePortada {
      clavePortada = d.portada
      portada = archivo(d.portada).flatMap { UIImage(contentsOfFile: $0.path) }
    }
    if d.clave != claveVivas {
      claveVivas = d.clave
      vivas = armarVivas(d)
    }
    publicar()
  }

  private func armarVivas(_ d: DatosAviso) -> [String: Any] {
    var r: [String: Any] = [:]
    guard #available(iOS 26.0, *) else { return r }
    let soportadas = MPNowPlayingInfoCenter.supportedAnimatedArtworkKeys
    let pares: [(String, URL?, String)] = [
      (MPNowPlayingInfoProperty3x4AnimatedArtwork, archivo(d.videoAlto), "alto"),
      (MPNowPlayingInfoProperty1x1AnimatedArtwork, archivo(d.videoCuadrado), "cuadrado"),
    ]
    for (clave, video, forma) in pares {
      guard soportadas.contains(clave), let video else { continue }
      // El id cambia si cambia el video: subir el número al regenerarlos.
      r[clave] = MPMediaItemAnimatedArtwork(
        artworkID: "puntos-salud-\(d.clave)-\(forma)-1",
        previewImageRequestHandler: { _, listo in listo(primerCuadro(video)) },
        videoAssetFileURLRequestHandler: { _, listo in listo(video) }
      )
    }
    return r
  }

  private func publicar() {
    var info: [String: Any] = [
      MPMediaItemPropertyTitle: titulo,
      MPMediaItemPropertyArtist: artista,
      // NUNCA «en vivo» (2026-11-10, compilación 103: «dice en vivo, así al
      // pausar se quita»): a una transmisión en vivo iOS no le ofrece pausa,
      // su botón la DETIENE y quita el reproductor.
      MPNowPlayingInfoPropertyIsLiveStream: false,
      MPNowPlayingInfoPropertyElapsedPlaybackTime: 0.0,
      // En pausa la tasa es 0: el sistema pinta el botón de reproducir.
      MPNowPlayingInfoPropertyPlaybackRate: sonando ? 1.0 : 0.0,
    ]
    // Con temporizador, la barra cuenta lo que falta para que se apague.
    if let r = resta, r > 0 { info[MPMediaItemPropertyPlaybackDuration] = r }
    if let img = portada {
      info[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: img.size) { _ in img }
    }
    for (k, v) in vivas { info[k] = v }
    MPNowPlayingInfoCenter.default().nowPlayingInfo = info
  }

  private func conectar() {
    guard !conectado else { return }
    conectado = true
    let cc = MPRemoteCommandCenter.shared()
    for c in [cc.playCommand, cc.pauseCommand, cc.togglePlayPauseCommand, cc.stopCommand] { c.isEnabled = true }
    // La pausa se marca acá mismo para que el botón cambie sin esperar a JS;
    // lib/ruido.js la confirma con el siguiente `mostrar`.
    cc.playCommand.addTarget { [weak self] _ in
      guard let s = self else { return .commandFailed }
      s.sonando = true; s.publicar(); s.sendEvent("alReanudar", [:]); return .success
    }
    cc.pauseCommand.addTarget { [weak self] _ in
      guard let s = self else { return .commandFailed }
      s.sonando = false; s.publicar(); s.sendEvent("alPausar", [:]); return .success
    }
    cc.togglePlayPauseCommand.addTarget { [weak self] _ in
      guard let s = self else { return .commandFailed }
      let pausar = s.sonando
      s.sonando = !pausar; s.publicar(); s.sendEvent(pausar ? "alPausar" : "alReanudar", [:]); return .success
    }
    cc.stopCommand.addTarget { [weak self] _ in
      self?.sendEvent("alDetener", [:]); return .success
    }
    for c in [cc.nextTrackCommand, cc.previousTrackCommand, cc.skipForwardCommand, cc.skipBackwardCommand,
              cc.seekForwardCommand, cc.seekBackwardCommand, cc.changePlaybackPositionCommand] as [MPRemoteCommand] {
      c.isEnabled = false
    }
  }

  private func ocultar() {
    MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    if conectado {
      let cc = MPRemoteCommandCenter.shared()
      for c in [cc.playCommand, cc.pauseCommand, cc.togglePlayPauseCommand, cc.stopCommand] { c.removeTarget(nil) }
      conectado = false
    }
    claveVivas = nil
    vivas = [:]
  }
}

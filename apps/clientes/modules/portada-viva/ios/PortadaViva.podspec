Pod::Spec.new do |s|
  s.name           = 'PortadaViva'
  s.version        = '1.0.0'
  s.summary        = 'Lo que suena en la pantalla bloqueada, con portada animada desde iOS 26.'
  s.author         = 'Farmacia Salud'
  s.homepage       = 'https://portal.farmasalud.lat'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks     = 'MediaPlayer', 'AVFoundation'
  s.source_files   = '**/*.swift'
end

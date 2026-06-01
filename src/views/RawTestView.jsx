export default function RawTestView() {
    const GRAD = 'radial-gradient(ellipse at 38% 28%, #d8d2ff 0%, #e4e0ff 22%, #eae8ff 50%, #e2deff 100%)';
    // Alto total del header fijo (zona status bar + barra de título)
    const HEADER_H = 'calc(env(safe-area-inset-top, 0px) + 52px)';

    return (
        <>
            {/* Fondo fijo — cubre todo el físico incluyendo status bar y home indicator */}
            <div style={{ position: 'fixed', inset: 0, background: GRAD, zIndex: 0 }} />

            {/* Header de vidrio — cubre zona status bar (paddingTop) + barra de título */}
            <div style={{
                position: 'fixed', top: 0, left: 0, right: 0, zIndex: 99,
                background: 'rgba(221,216,255,0.88)',
                backdropFilter: 'blur(44px)',
                WebkitBackdropFilter: 'blur(44px)',
                paddingTop: 'env(safe-area-inset-top, 0px)',
                borderBottom: '1px solid rgba(255,255,255,0.6)',
            }}>
                <div style={{ padding: '12px 16px', fontFamily: 'system-ui', fontWeight: 800, fontSize: 15, color: '#1e293b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>/raw-test</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#6e46e6', background: 'rgba(110,70,230,0.12)', borderRadius: 8, padding: '2px 8px' }}>v5</span>
                </div>
            </div>

            {/*
              Scroll container empieza en top:0 (físico) — mismo que el header.
              paddingTop empuja el primer ítem debajo del header.
              Al scrollear, el contenido SUBE por detrás del vidrio del header
              y entra en la zona del status bar → el efecto que buscamos.
              zIndex 10 < zIndex 99 del header, así el contenido pasa por debajo.
            */}
            <div style={{
                position: 'fixed',
                top: 0, left: 0, right: 0, bottom: 0,
                overflowY: 'auto',
                WebkitOverflowScrolling: 'touch',
                zIndex: 10,
                paddingTop: HEADER_H,
                paddingLeft: 16,
                paddingRight: 16,
                paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 20px)',
            }}>

                <div style={{ background: 'rgba(110,70,230,0.12)', borderRadius: 16, padding: 16, marginBottom: 16, border: '1px solid rgba(110,70,230,0.2)' }}>
                    <p style={{ margin: 0, fontSize: 13, color: '#4c1d95', lineHeight: 1.6, fontFamily: 'system-ui' }}>
                        <strong>v5 — scroll por detrás del header</strong><br />
                        1. ¿Hay scroll? ✓/✗<br />
                        2. Al scrollear, ¿el contenido pasa por el status bar (arriba)?<br />
                        3. ¿La franja de abajo desaparece?
                    </p>
                </div>

                {Array.from({ length: 25 }, (_, i) => (
                    <div key={i} style={{
                        background: 'rgba(255,255,255,0.55)',
                        backdropFilter: 'blur(20px)',
                        WebkitBackdropFilter: 'blur(20px)',
                        borderRadius: 16,
                        padding: '16px',
                        marginBottom: 10,
                        border: '1px solid rgba(255,255,255,0.7)',
                        display: 'flex', alignItems: 'center', gap: 12,
                        fontFamily: 'system-ui',
                    }}>
                        <div style={{
                            width: 36, height: 36, borderRadius: 12, flexShrink: 0,
                            background: 'linear-gradient(135deg, #6e46e6, #3c64f0)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: 'white', fontWeight: 900, fontSize: 14,
                        }}>{i + 1}</div>
                        <div>
                            <div style={{ fontWeight: 700, fontSize: 14, color: '#1e293b' }}>Fila {i + 1}</div>
                            <div style={{ fontSize: 12, color: '#64748b' }}>Scrollea para ver el efecto</div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Franja inferior — cubre zona home indicator con mismo vidrio del header */}
            <div style={{
                position: 'fixed', bottom: 0, left: 0, right: 0,
                height: 'env(safe-area-inset-bottom, 0px)',
                background: 'rgba(221,216,255,0.88)',
                backdropFilter: 'blur(44px)',
                WebkitBackdropFilter: 'blur(44px)',
                zIndex: 98,
            }} />
        </>
    );
}

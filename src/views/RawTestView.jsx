export default function RawTestView() {
    const GRAD = 'radial-gradient(ellipse at 38% 28%, #d8d2ff 0%, #e4e0ff 22%, #eae8ff 50%, #e2deff 100%)';

    return (
        <>
            {/* Fondo fijo — position:fixed llega hasta y=0 (bajo status bar) */}
            <div style={{
                position: 'fixed',
                top: 0, left: 0, right: 0, bottom: 0,
                background: GRAD,
                zIndex: 0,
            }} />

            {/* Header fijo — cubre zona status bar con mismo gradiente */}
            <div style={{
                position: 'fixed', top: 0, left: 0, right: 0, zIndex: 99,
                background: 'rgba(221,216,255,0.85)',
                backdropFilter: 'blur(40px)',
                WebkitBackdropFilter: 'blur(40px)',
                paddingTop: 'env(safe-area-inset-top, 0px)',
                borderBottom: '1px solid rgba(255,255,255,0.5)',
            }}>
                <div style={{ padding: '12px 16px', fontFamily: 'system-ui', fontWeight: 800, fontSize: 15, color: '#1e293b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>/raw-test</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#6e46e6', background: 'rgba(110,70,230,0.12)', borderRadius: 8, padding: '2px 8px' }}>v3</span>
                </div>
            </div>

            {/* Contenedor de scroll — div interno fijo, igual que #main-scroll en Portal */}
            <div style={{
                position: 'fixed',
                top: 'calc(env(safe-area-inset-top, 0px) + 52px)',
                left: 0, right: 0,
                bottom: 0,
                overflowY: 'auto',
                WebkitOverflowScrolling: 'touch',
                zIndex: 10,
                padding: '16px',
                paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 20px)',
            }}>

                <div style={{ background: 'rgba(110,70,230,0.12)', borderRadius: 16, padding: 16, marginBottom: 16, border: '1px solid rgba(110,70,230,0.2)' }}>
                    <p style={{ margin: 0, fontSize: 13, color: '#4c1d95', lineHeight: 1.6, fontFamily: 'system-ui' }}>
                        <strong>v3 — scroll interno (div fijo)</strong><br />
                        1. ¿Hay scroll? ✓/✗<br />
                        2. ¿La franja del status bar (arriba) desaparece?<br />
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
                            <div style={{ fontSize: 12, color: '#64748b' }}>Scrollea hacia abajo</div>
                        </div>
                    </div>
                ))}
            </div>
        </>
    );
}

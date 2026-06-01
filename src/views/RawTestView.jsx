import { useEffect } from 'react';

export default function RawTestView() {
    useEffect(() => {
        // Body scroll nativo (misma técnica de v4 que arregló la franja inferior)
        const html = document.documentElement;
        const body = document.body;
        const root = document.getElementById('root');
        html.style.setProperty('overflow', 'auto', 'important');
        html.style.setProperty('height', 'auto', 'important');
        body.style.setProperty('overflow', 'auto', 'important');
        body.style.setProperty('height', 'auto', 'important');
        body.style.setProperty('overscroll-behavior', 'auto', 'important');
        if (root) {
            root.style.setProperty('overflow', 'visible', 'important');
            root.style.setProperty('height', 'auto', 'important');
        }
        return () => {
            ['overflow', 'height'].forEach(p => html.style.removeProperty(p));
            ['overflow', 'height', 'overscroll-behavior'].forEach(p => body.style.removeProperty(p));
            if (root) ['overflow', 'height'].forEach(p => root.style.removeProperty(p));
        };
    }, []);

    // Color sólido que coincide exactamente con capacitor.config.json backgroundColor
    // y con el theme-color meta de index.html
    // Si el strip arriba desaparece con este color → el problema era el gradiente
    const SOLID = '#ddd8ff';

    return (
        <>
            {/* Fondo sólido = mismo color que WKWebView backgroundColor (#ddd8ff) */}
            <style>{`html, body { background: ${SOLID} !important; }`}</style>

            {/* Header — mismo color sólido, sin transparencia */}
            <div style={{
                position: 'fixed', top: 0, left: 0, right: 0, zIndex: 99,
                background: SOLID,
                backdropFilter: 'blur(44px)',
                WebkitBackdropFilter: 'blur(44px)',
                paddingTop: 'env(safe-area-inset-top, 0px)',
                borderBottom: '1px solid rgba(255,255,255,0.6)',
            }}>
                <div style={{ padding: '12px 16px', fontFamily: 'system-ui', fontWeight: 800, fontSize: 15, color: '#1e293b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>/raw-test</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#6e46e6', background: 'rgba(110,70,230,0.12)', borderRadius: 8, padding: '2px 8px' }}>v6</span>
                </div>
            </div>

            {/* Spacer */}
            <div style={{ height: 'calc(env(safe-area-inset-top, 0px) + 52px)' }} />

            {/* Contenido — body scroll nativo */}
            <div style={{ padding: 16 }}>
                <div style={{ background: 'rgba(110,70,230,0.12)', borderRadius: 16, padding: 16, marginBottom: 16, border: '1px solid rgba(110,70,230,0.2)' }}>
                    <p style={{ margin: 0, fontSize: 13, color: '#4c1d95', lineHeight: 1.6, fontFamily: 'system-ui' }}>
                        <strong>v6 — fondo sólido #ddd8ff (diagnóstico)</strong><br />
                        Si las franjas desaparecen → el gradiente causaba el desajuste de color.<br />
                        Si siguen → es un problema de configuración nativa.
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
                            <div style={{ fontSize: 12, color: '#64748b' }}>Diagnóstico de franjas</div>
                        </div>
                    </div>
                ))}

                <div style={{ height: 'max(env(safe-area-inset-bottom, 0px), 20px)' }} />
            </div>
        </>
    );
}

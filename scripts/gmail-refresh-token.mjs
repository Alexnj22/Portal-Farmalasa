// Genera el refresh token de Gmail para sync-purchase-emails.
// Correr UNA VEZ por cada cuenta de compras (iniciando sesión con esa cuenta en el navegador):
//   node scripts/gmail-refresh-token.mjs <client_id> <client_secret>
// El token que imprime se guarda en Vault — nunca en el repo ni en la BD.
import http from 'node:http';
import { URL } from 'node:url';

const [clientId, clientSecret] = process.argv.slice(2);
if (!clientId || !clientSecret) {
    console.error('Uso: node scripts/gmail-refresh-token.mjs <client_id> <client_secret>');
    process.exit(1);
}

const PORT = 53682;
const REDIRECT = `http://localhost:${PORT}`;
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
}).toString();

console.log('\n1) Abrí este enlace e iniciá sesión con la cuenta de compras a conectar:\n');
console.log(authUrl.toString());
console.log('\n2) Al aceptar, volvé a esta terminal — el token aparece aquí.\n');

const server = http.createServer(async (req, res) => {
    const code = new URL(req.url, REDIRECT).searchParams.get('code');
    if (!code) {
        res.end('');
        return;
    }
    res.end('Listo — podes cerrar esta pestana y volver a la terminal.');
    server.close();

    const resp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: REDIRECT,
            grant_type: 'authorization_code',
        }),
    });
    const tok = await resp.json();
    if (!tok.refresh_token) {
        console.error('ERROR: Google no devolvió refresh_token. Respuesta completa:', tok);
        process.exit(1);
    }
    console.log('REFRESH TOKEN (dámelo para guardarlo en Vault):\n');
    console.log(tok.refresh_token + '\n');
    process.exit(0);
});
server.listen(PORT);

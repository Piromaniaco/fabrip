/* =====================================================================
   Borde de Vercel: /drive/video/<id> sirve los videos de Google Drive.

   Diagnóstico medido en vivo (2026-10-07):
   - Drive limita la descarga de archivos publicos POR IP con ventanas de
     ~24 h. Las IPs compartidas de Vercel se agotan con facilidad (parte
     del agotamiento actual lo causo el propio diagnostico). Ademas
     rechaza SIEMPRE la descarga completa (sin rango o bytes=0-) y a
     veces cualquier tramo grande. Con la API key (env GOOGLE_API_KEY)
     las peticiones van autenticadas contra el proyecto del sitio.
   - El navegador NUNCA puede pedir los bytes directo: Drive contesta
     403 a cualquier request con Sec-Fetch-Site: cross-site (anti
     hotlink), por eso el video siempre pasa por este proxy.
   - www.googleapis.com a veces contesta su pagina "Sorry" (bloqueo anti
     abuso de la IP) en 403 text/html: jamas eso debe llegar al video.

   Estrategia por pedido:
   1. Todo rango se acota (abierto o gigante -> tramo de 4 MB): el
      reproductor pide el siguiente tramo solo y no nota la diferencia.
   2. Si la respuesta no es video (403 de cuota, "Sorry", timeout de
      5 s al primer byte) se reintenta con tramo de 1 MB, luego 256 KB
      y por ultimo por el camino anonimo (drive.usercontent), que puede
      tener su ventana de cuota aparte.
   3. Si nada contesta con video: 403 JSON limpio y cortacircuito de
      60 s por archivo (no martillear a Drive mientras esta cortado).
   4. El fallo dura lo que dura: el visor del frontend tiene su propio
      tope de 5 s y pasa al reproductor oficial de Drive (iframe
      /preview, que usa el pipeline de YouTube y NO toca esta cuota).

   La clave vive SOLO en variables de entorno: no aparece en el
   navegador, en la respuesta ni en ningun archivo del repo.
   ===================================================================== */

const TRAMO = 4 * 1024 * 1024;        /* tramo normal: 4 MB */
const TRAMO_CHICO = 1024 * 1024;       /* si el 4 MB no pasa: 1 MB */
const TRAMO_MIN = 256 * 1024;          /* ultimo recurso: 256 KB */
const PRIMER_BYTE_MS = 5000;           /* tope al primer intento */
const PRIMER_BYTE_MS_CHICO = 2500;     /* reintentos: rangos chicos = rapidos */
const PAUSA_MS = 60000;                /* cortacircuito tras un fallo */

/* Cortacircuito por archivo: un archivo cortado no vuelve a martillarse
   durante la pausa; los demas videos se siguen sirviendo solos. */
const sinCuotaHasta = new Map();

/* Rango del cliente -> tramo SIEMPRE acotado (nunca "descarga completa").
   null si el formato es raro (p. ej. sufijo bytes=-500): ahi se cae al
   rewrite anonimo de vercel.json. */
function acotar(range, bytes) {
    if (!range) return 'bytes=0-' + (bytes - 1);
    const m = /^\s*bytes=(\d+)-(\d*)\s*$/.exec(range);
    if (!m) return null;
    const ini = parseInt(m[1], 10);
    if (m[2] === '') return 'bytes=' + ini + '-' + (ini + bytes - 1);
    const fin = parseInt(m[2], 10);
    if (fin < ini) return null;
    if (fin - ini + 1 > bytes) return 'bytes=' + ini + '-' + (ini + bytes - 1);
    return 'bytes=' + ini + '-' + fin;
}

/* Cabeceras base para Google: referer propio (por si la clave esta
   restringida por sitio) + validadores del navegador (asi un tramo ya
   cacheado puede volver como 304 y no se bajan bytes otra vez). */
function basePeticion(request, origen) {
    const fwd = new Headers();
    fwd.set('Accept', '*/*');
    fwd.set('Referer', origen + '/');
    ['range', 'if-range', 'if-none-match', 'if-modified-since'].forEach(function (h) {
        const v = request.headers.get(h);
        if (v) fwd.set(h, v);
    });
    return fwd;
}

function pedir(destino, base, rango, ms) {
    const fwd = new Headers(base);
    if (rango) fwd.set('Range', rango);      /* pisa el rango con el acotado */
    const ctrl = new AbortController();
    const reloj = setTimeout(function () { ctrl.abort(); }, ms);
    return fetch(destino, { headers: fwd, redirect: 'follow', signal: ctrl.signal })
        .then(function (r) { clearTimeout(reloj); return r; })
        .catch(function () { clearTimeout(reloj); return null; });
}

/* ¿Sirve para el reproductor? 200/206 con cuerpo que no sea HTML ni
   JSON (la cuota anonima llega como 200 text/html y el bloqueo
   "Sorry" como 403 text/html: ninguno de los dos es video). */
function esVideoOK(r) {
    if (!r) return false;
    if (r.status === 304) return true;       /* cache del navegador: valido */
    if (r.status !== 200 && r.status !== 206) return false;
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    return ct.indexOf('html') < 0 && ct.indexOf('json') < 0;
}

function rechazo() {
    return new Response(
        JSON.stringify({
            error: {
                code: 403,
                message: 'The download quota for this file has been exceeded.',
                errors: [{ reason: 'downloadQuotaExceeded',
                           message: 'The download quota for this file has been exceeded.' }]
            }
        }),
        { status: 403,
          headers: { 'content-type': 'application/json; charset=UTF-8',
                     'cache-control': 'no-store',
                     'x-fuente': 'drive-agotado' } }
    );
}

export default async function middleware(request) {
    const key = (process.env.GOOGLE_API_KEY || '').trim();
    if (!key) return;                       /* sin clave: rewrite anonimo */

    const url = new URL(request.url);
    const id = url.pathname.split('/').pop();
    if (!id) return;

    const rangoCliente = request.headers.get('range') || '';
    const rango4 = acotar(rangoCliente, TRAMO);
    if (!rango4) return;                    /* rango raro: rewrite anonimo */

    if (Date.now() < (sinCuotaHasta.get(id) || 0)) return rechazo();

    const base = basePeticion(request, url.origin);
    const api = new URL('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id));
    api.searchParams.set('alt', 'media');
    api.searchParams.set('key', key);
    const anon = 'https://drive.usercontent.google.com/download?id=' +
                 encodeURIComponent(id) + '&export=view&confirm=t';

    const rango1 = acotar(rangoCliente, TRAMO_CHICO) || rango4;
    const rangoMin = acotar(rangoCliente, TRAMO_MIN) || rango1;

    let r = await pedir(api.href, base, rango4, PRIMER_BYTE_MS);
    let fuente = 'drive-api';

    if (!esVideoOK(r)) {
        r = await pedir(api.href, base, rango1, PRIMER_BYTE_MS_CHICO);
        fuente = 'drive-api-1mb';
    }
    if (!esVideoOK(r)) {
        r = await pedir(api.href, base, rangoMin, PRIMER_BYTE_MS_CHICO);
        fuente = 'drive-api-256k';
    }
    if (!esVideoOK(r)) {
        /* camino anonimo: puede tener su ventana de cuota aparte */
        r = await pedir(anon, base, rangoMin, PRIMER_BYTE_MS_CHICO);
        fuente = 'drive-anon';
    }

    if (!esVideoOK(r)) {
        sinCuotaHasta.set(id, Date.now() + PAUSA_MS);
        return rechazo();                   /* NUNCA el HTML de Google */
    }

    if (r.status === 304) {
        sinCuotaHasta.delete(id);
        const h304 = new Headers();
        ['etag', 'last-modified', 'cache-control'].forEach(function (n) {
            const v = r.headers.get(n);
            if (v) h304.set(n, v);
        });
        h304.set('x-fuente', fuente);
        return new Response(null, { status: 304, headers: h304 });
    }

    sinCuotaHasta.delete(id);

    const h = new Headers();
    ['content-type', 'content-length', 'content-range', 'accept-ranges',
     'etag', 'last-modified'].forEach(function (n) {
        const v = r.headers.get(n);
        if (v) h.set(n, v);
    });
    /* Exito: cacheable un dia en el navegador -> repetir un video no
       vuelve a tocar Drive ni la cuota del proyecto. */
    h.set('cache-control', 'public, max-age=86400');
    h.set('x-fuente', fuente);

    return new Response(r.body, {
        status: r.status,
        statusText: r.statusText,
        headers: h
    });
}

export const config = {
    matcher: '/drive/video/:id'
};

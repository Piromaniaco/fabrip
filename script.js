/* ==========================================================
   FabriP - script
   - Intro: se limpia tras la carga.
   - Reveal: cada item entra/sale de pantalla con IntersectionObserver.
   - Fondo: capas con parallax y profundidad al hacer scroll.
   ========================================================== */

document.addEventListener('DOMContentLoaded', function () {
    /* Intro: se levanta con CSS a los 0.95s + 0.7s; la quitamos a los 2s */
    var intro = document.querySelector('.intro-screen');
    if (intro) {
        setTimeout(function () {
            if (intro && intro.parentNode) {
                intro.parentNode.removeChild(intro);
            }
        }, 2000);
    }

    /* ---- Reveal: anima cada item al ENTRAR y al SALIR de pantalla ----
       IntersectionObserver alterna .in-view (entra) y .is-above (se fue
       por arriba, para que la salida vaya en sentido contrario). */
    var revealEls = Array.prototype.slice.call(document.querySelectorAll('.reveal'));

    if (!revealEls.length) {
        /* nada que revelar */
    } else if (!('IntersectionObserver' in window)) {
        /* Sin soporte: mostramos todo para que no quede nada oculto */
        revealEls.forEach(function (el) { el.classList.add('in-view'); });
    } else {
        var io = new IntersectionObserver(function (entries) {
            /* Si el scroll es repentino no se apaga NADA: con transiciones
               instantaneas un elemento que cruza el limite parpadearia
               (aparece/desaparece) = glitch. Solo se fija la entrada. */
            var fast = document.body.classList.contains('is-fast-scroll');
            for (var i = 0; i < entries.length; i++) {
                var entry = entries[i];
                var el = entry.target;
                if (entry.isIntersecting) {
                    el.classList.remove('is-above');
                    el.classList.add('in-view');
                } else if (!fast) {
                    el.classList.remove('in-view');
                    /* top < 0 -> salió por arriba; top > 0 -> salió por abajo */
                    if (entry.boundingClientRect.top < 0) {
                        el.classList.add('is-above');
                    } else {
                        el.classList.remove('is-above');
                    }
                }
            }
        }, {
            threshold: 0.01,
            rootMargin: '0px 0px -8% 0px'
        });

        revealEls.forEach(function (el) { io.observe(el); });
    }

    /* ---- Scroll repentino: que no se vean "fantasmas" a mitad de fundido ----
       Un salto brusco (barra, Home/End, PageDown, rueda fuerte) hace entrar
       y salir de golpe a varios .reveal: con fundido de 0.7s la pagina queda
       "en blanco" un instante y se lee como bug grafico. Si el scroll es
       repentino, opacidad y transformo pasan a 0s -> aparecen de una; a los
       240ms sin saltos la animacion vuelve a su ritmo normal. */
    var fastTimer = null;
    var speedY = window.scrollY || window.pageYOffset || 0;

    function fastScroll() {
        if (!document.body.classList.contains('is-fast-scroll')) {
            document.body.classList.add('is-fast-scroll');
        }
        clearTimeout(fastTimer);
        fastTimer = setTimeout(function () {
            document.body.classList.remove('is-fast-scroll');
            revealSweep();
        }, 240);
    }

    /* Terminó el salto: se dejan sin revelar los elementos que quedaron
       COMPLETAMENTE fuera de pantalla. Como no se ven, no hay parpadeo;
       de paso vuelve a funcionar su animación de entrada la próxima vez
       que entren (si no, alargar un salto dejaria todo "revelado" y las
       secciones dejarian de animarse). Los que estan a medias se quedan
       como estan: eso si se ve y tiene que seguir visible. */
    function revealSweep() {
        if (document.body.classList.contains('is-modal-open')) return;

        var vh = window.innerHeight || document.documentElement.clientHeight;
        var els = document.querySelectorAll('.reveal');
        var fuera;

        for (var i = 0; i < els.length; i++) {
            var el = els[i];
            if (!el.classList.contains('in-view')) continue;
            fuera = el.getBoundingClientRect();
            if (fuera.bottom <= 0) {
                el.classList.remove('in-view');
                el.classList.add('is-above');        /* salió por arriba */
            } else if (fuera.top >= vh) {
                el.classList.remove('in-view');
                el.classList.remove('is-above');     /* salió por abajo */
            }
        }
    }

    function checkSpeed() {
        var y = window.scrollY || window.pageYOffset || 0;

        /* Con el visor abierto el scroll se devuelve a su lugar; para que
           ese rebote no marque "scroll repentino", solo se sigue midiendo. */
        if (document.body.classList.contains('is-modal-open')) {
            speedY = y;
            return;
        }

        var dy = y - speedY;
        speedY = y;
        /* mas de ~120px por frame = salto repentino (lo normal es 20-70) */
        if (dy > 120 || dy < -120) fastScroll();
    }

    window.addEventListener('scroll', checkSpeed, { passive: true });
    window.addEventListener('resize', function () {
        speedY = window.scrollY || window.pageYOffset || 0;
        fastScroll();
    }, { passive: true });

    /* ==========================================================
       PORTAFOLIO - videos de TikTok (API oficial vía /api/videos)
       Carrusel horizontal con profundidad: la tarjeta del centro
       queda ENFOCADA y las de los bordes se retrasan (translateZ +
       rotateY) y se desenfocan (blur) según su distancia al medio.
       ========================================================== */
    var pfVp = document.getElementById('pfViewport');
    var pfTrack = document.getElementById('pfTrack');
    var pfCarousel = document.getElementById('pfCarousel');
    var pfStatus = document.getElementById('pfStatus');
    var pfHint = document.getElementById('pfHint');
    var pfHintText = document.getElementById('pfHintText');
    var pfRefresh = document.getElementById('pfRefresh');
    var pfPrev = document.getElementById('pfPrev');
    var pfNext = document.getElementById('pfNext');

    var pfCards = [];
    var pfFocusIdx = 0;
    var pfScrollAnim = null;
    var pfLastDrag = 0;
    var pfLastIds = '';
    var pfTicking = false;

    /* Medidas cacheadas: se recalculan al renderizar/redimensionar y NUNCA
       dentro del bucle de scroll, así cada frame evita reflow forzado. */
    var pfSnap = [];        /* scrollLeft exacto que centra cada tarjeta */
    var pfSpan = 1;         /* distancia base para normalizar la profundidad */
    var pfLastStyle = [];   /* último transform/filter/opacity escrito */

    function pfMetric() {
        var el = pfCarousel || pfTrack;
        var cs = getComputedStyle(el);
        return {
            cardW: parseFloat(cs.getPropertyValue('--card-w')) || 232,
            gap: parseFloat(cs.getPropertyValue('--card-gap')) || 24
        };
    }

    /* Espaciadores laterales: centran la primera y la última tarjeta */
    function pfLayout() {
        if (!pfVp || !pfTrack) return;
        var m = pfMetric();
        var spacers = pfTrack.querySelectorAll('.pf-spacer');
        if (spacers.length >= 2) {
            var pad = Math.max(0, (pfVp.clientWidth - m.cardW) / 2 - m.gap);
            spacers[0].style.width = pad + 'px';
            spacers[1].style.width = pad + 'px';
        }
        pfMeasure();
        pfDepth();
    }

    /* Toma de medidas en un solo paso (todas las lecturas antes de escribir,
       para no provocar reflows encadenados). */
    function pfMeasure() {
        pfSnap = [];
        pfLastStyle = [];
        if (!pfVp || !pfCards.length) { pfSpan = 1; return; }

        var half = pfVp.clientWidth / 2;
        for (var i = 0; i < pfCards.length; i++) {
            var c = pfCards[i];
            /* offsetLeft no se ve afectado por los transforms ya aplicados */
            pfSnap.push(c.offsetLeft + c.offsetWidth / 2 - half);
        }
        pfSpan = (pfCards[0].offsetWidth || 240) * 1.5;
    }

    /* Profundidad: distancia de cada tarjeta al centro del carrusel.
       Solo lee el scroll (una lectura por frame); las posiciones vienen
       cacheadas de pfMeasure(). */
    function pfDepth() {
        if (!pfVp || !pfCards.length || !pfSnap.length) return;

        var scroll = pfVp.scrollLeft;
        var span = pfSpan || 1;
        var focusIdx = -1;
        var focusDist = Infinity;
        var i;

        for (i = 0; i < pfCards.length; i++) {
            var card = pfCards[i];
            var d = pfSnap[i] - scroll;
            var dist = d < 0 ? -d : d;
            var norm = dist / span;
            if (norm > 1) norm = 1;
            var dir = d < 0 ? -1 : 1;

            var tf = 'translate3d(0,' + (norm * 8).toFixed(1) + 'px,' + (-norm * 280).toFixed(1) + 'px)' +
                ' rotateY(' + (-dir * norm * 26).toFixed(2) + 'deg)' +
                ' scale(' + (1 - norm * 0.16).toFixed(4) + ')';
            var fl = norm > 0.02 ? 'blur(' + (norm * 8).toFixed(2) + 'px)' : 'none';
            var op = (1 - norm * 0.45).toFixed(3);

            /* Solo se escribe si algo cambió: las tarjetas lejanas quedan en
               el máximo y dejan de costar pintura en cada frame. */
            if (pfLastStyle[i] !== tf + fl + op) {
                card.style.transform = tf;
                card.style.filter = fl;
                card.style.opacity = op;
                pfLastStyle[i] = tf + fl + op;
            }

            if (dist < focusDist) { focusDist = dist; focusIdx = i; }
        }

        for (i = 0; i < pfCards.length; i++) {
            pfCards[i].classList.toggle('is-focus', i === focusIdx);
        }
        pfFocusIdx = focusIdx < 0 ? 0 : focusIdx;
        /* Nota: el reproductor NO se auto-carga al enfocar: el iframe capturaría
           el puntero y rompería el arrastre/swipe. Se monta con un clic. */
    }

    /* Un video a la vez: al reproducir uno nuevo, los anteriores se detienen
       (se desmonta su iframe: al ser cross-origin no se puede pausar de otra
       forma, y sacarlo detiene el audio y libera el reproductor). */
    function pfUnmount(card) {
        if (!card.classList.contains('is-playing')) return;
        var frame = card.querySelector('.pf-frame');
        if (frame) frame.textContent = '';
        card.classList.remove('is-playing');
    }

    function pfMount(card) {
        var url = card.getAttribute('data-embed');
        if (!url || card.classList.contains('is-playing')) return;
        var host = card.querySelector('.pf-frame');
        if (!host) return;

        for (var i = 0; i < pfCards.length; i++) {
            if (pfCards[i] !== card) pfUnmount(pfCards[i]);
        }

        var frame = document.createElement('iframe');
        frame.src = url;
        frame.title = 'Video de TikTok';
        frame.loading = 'lazy';
        frame.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture';
        frame.setAttribute('allowfullscreen', '');
        host.appendChild(frame);
        card.classList.add('is-playing');
    }

    function pfCount(n) {
        if (n === null || n === undefined || isNaN(n)) return '';
        n = Number(n);
        if (n >= 1000000) return (n / 1000000).toFixed(1).replace('.0', '') + 'M';
        if (n >= 1000) return (n / 1000).toFixed(1).replace('.0', '') + 'k';
        return String(n);
    }

    function pfDuration(sec) {
        sec = Number(sec) || 0;
        var m = Math.floor(sec / 60);
        var s = sec % 60;
        return m + ':' + (s < 10 ? '0' : '') + s;
    }

    function pfBuildCard(v) {
        var card = document.createElement('article');
        card.className = 'pf-card';
        card.setAttribute('role', 'group');
        card.setAttribute('aria-label', v.title || 'Video de TikTok');
        card.setAttribute('data-embed', v.embed || ('https://www.tiktok.com/embed/v2/' + v.id));

        var cover = document.createElement('img');
        cover.className = 'pf-cover';
        cover.loading = 'lazy';
        cover.decoding = 'async';
        cover.alt = v.title || 'Video de TikTok';
        cover.addEventListener('error', function () {
            /* portada caída: queda el fondo neutro de la tarjeta */
            cover.style.display = 'none';
        });
        if (v.cover) cover.src = v.cover;
        card.appendChild(cover);

        var frame = document.createElement('div');
        frame.className = 'pf-frame';
        card.appendChild(frame);

        /* Enlace al video original (siempre accesible) */
        if (v.url) {
            var link = document.createElement('a');
            link.className = 'pf-badge pf-badge--tt';
            link.href = v.url;
            link.target = '_blank';
            link.rel = 'noopener';
            link.title = 'Ver en TikTok';
            link.innerHTML = '<i class="fa-brands fa-tiktok" aria-hidden="true"></i><span>TikTok</span>';
            card.appendChild(link);
        }

        if (v.duration) {
            var time = document.createElement('span');
            time.className = 'pf-badge pf-badge--time';
            time.textContent = pfDuration(v.duration);
            card.appendChild(time);
        }

        var meta = document.createElement('div');
        meta.className = 'pf-meta';

        var name = document.createElement('span');
        name.className = 'pf-name';
        name.textContent = v.title || 'Video de TikTok';
        meta.appendChild(name);

        var stats = document.createElement('span');
        stats.className = 'pf-stats';
        var parts = [];
        if (v.views !== null && v.views !== undefined) {
            parts.push('<span><i class="fa-regular fa-eye" aria-hidden="true"></i>' + pfCount(v.views) + '</span>');
        }
        if (v.likes !== null && v.likes !== undefined) {
            parts.push('<span><i class="fa-regular fa-heart" aria-hidden="true"></i>' + pfCount(v.likes) + '</span>');
        }
        if (parts.length) stats.innerHTML = parts.join('');
        meta.appendChild(stats);

        card.appendChild(meta);

        var play = document.createElement('button');
        play.className = 'pf-play';
        play.type = 'button';
        play.setAttribute('aria-label', 'Reproducir video');
        play.innerHTML = '<i class="fa-solid fa-play" aria-hidden="true"></i>';
        card.appendChild(play);

        card.addEventListener('click', function (e) {
            var t = e.target;
            if (t && t.closest && t.closest('a')) return;       /* link a TikTok */
            if (Date.now() - pfLastDrag < 300) return;           /* venía de un arrastre */
            pfMount(card);
        });

        return card;
    }

    function pfTimeAgo(ts) {
        var s = Math.max(0, Math.round(Date.now() / 1000 - Number(ts)));
        if (s < 60) return 'hace unos segundos';
        var m = Math.round(s / 60);
        if (m < 60) return 'hace ' + m + ' min';
        var h = Math.round(m / 60);
        if (h < 24) return 'hace ' + h + ' h';
        return 'hace ' + Math.round(h / 24) + ' d';
    }

    function pfUpdateHint(updatedAt) {
        if (!pfHintText) return;
        var text = 'Deslizá en horizontal para ver todos los videos';
        if (updatedAt) text += ' · actualizado ' + pfTimeAgo(updatedAt);
        pfHintText.textContent = text;
    }

    function pfRender(list, updatedAt) {
        var ids = list.map(function (v) { return v.id; }).join(',');
        if (ids && ids === pfLastIds) {
            pfUpdateHint(updatedAt);
            pfDepth();
            return;
        }
        pfLastIds = ids;

        var old = pfTrack.querySelectorAll('.pf-card');
        for (var i = 0; i < old.length; i++) old[i].parentNode.removeChild(old[i]);
        pfCards = [];

        var spacers = pfTrack.querySelectorAll('.pf-spacer');
        var anchor = spacers[1] || null;

        for (var k = 0; k < list.length; k++) {
            var card = pfBuildCard(list[k]);
            pfCards.push(card);
            pfTrack.insertBefore(card, anchor);
        }

        pfCarousel.classList.toggle('is-empty', !list.length);
        if (pfHint) pfHint.hidden = list.length < 2;

        if (list.length) {
            if (pfStatus) pfStatus.hidden = true;
            pfVp.scrollLeft = 0;
            pfLayout();
            pfReveal();
            pfUpdateHint(updatedAt);
        }
    }

    /* Si el carrusel estaba oculto y aparecen videos, hay que mostrarlo
       aunque el reveal no lo haya visto todavía. */
    function pfReveal() {
        if (!pfCarousel) return;
        pfCarousel.classList.remove('is-above');
        var r = pfCarousel.getBoundingClientRect();
        if (r.bottom > 0 && r.top < (window.innerHeight || 0)) {
            pfCarousel.classList.add('in-view');
        }
    }

    function pfStatusMessage(kind, title, body) {
        if (!pfStatus) return;
        pfStatus.hidden = false;
        pfStatus.textContent = '';

        var head = document.createElement('span');
        head.className = 'pf-status-title';
        head.textContent = title;
        pfStatus.appendChild(head);

        var text = document.createElement('span');
        text.textContent = body;
        pfStatus.appendChild(text);

        if (kind === 'not_authorized' || kind === 'expired' || kind === 'info') {
            var go = document.createElement('a');
            go.className = 'pf-btn';
            go.href = '/auth/login';
            go.innerHTML = '<i class="fa-brands fa-tiktok" aria-hidden="true"></i><span>Conectar mi TikTok</span>';
            pfStatus.appendChild(go);
        } else if (kind === 'api_error' || kind === 'offline' || kind === 'state') {
            var retry = document.createElement('button');
            retry.className = 'pf-btn';
            retry.type = 'button';
            retry.innerHTML = '<i class="fa-solid fa-rotate" aria-hidden="true"></i><span>Reintentar</span>';
            retry.addEventListener('click', function () { pfLoad(true); });
            pfStatus.appendChild(retry);
        }
    }

    function pfApply(data) {
        if (data.ok && data.videos && data.videos.length) {
            pfRender(data.videos, data.updated_at);
            return;
        }
        if (data.ok) {
            pfRender([], data.updated_at);
            pfStatusMessage('empty', 'Cuenta conectada',
                'Todavía no hay videos públicos para mostrar.');
            return;
        }

        var reason = data.reason || 'api_error';
        var title = 'Videos no disponibles';
        var body = data.message || 'No se pudieron cargar los videos.';
        if (reason === 'not_configured') {
            title = 'Videos sin configurar';
            /* el backend sabe dónde vive la config: archivo en local,
               variables de entorno en Vercel */
            body = data.message ||
                'Faltan el client_key y el client_secret de la API de TikTok en la configuración del servidor (ver PORTAFOLIO.md).';
        } else if (reason === 'not_authorized') {
            title = 'Conectá tu cuenta de TikTok';
            body = 'Autorizá el acceso y tus videos se van a cargar acá en tiempo real.';
        } else if (reason === 'expired') {
            title = 'Conexión vencida';
            body = 'Volvé a conectar tu cuenta de TikTok para seguir sincronizando.';
        }
        pfStatusMessage(reason, title, body);
    }

    function pfLoad(force) {
        if (!pfCards.length && pfStatus) {
            pfStatus.hidden = false;
            pfStatus.textContent = '';
            var head = document.createElement('span');
            head.className = 'pf-status-title';
            head.textContent = 'Cargando tus videos de TikTok…';
            pfStatus.appendChild(head);
        }
        if (force && pfRefresh) pfRefresh.classList.add('is-busy');

        fetch(force ? '/api/refresh' : '/api/videos', { cache: 'no-store' })
            .then(function (res) { return res.json(); })
            .then(function (data) {
                if (pfRefresh) pfRefresh.classList.remove('is-busy');
                pfApply(data || {});
            })
            .catch(function () {
                if (pfRefresh) pfRefresh.classList.remove('is-busy');
                if (pfCards.length) {
                    pfUpdateHint(0);
                    if (pfHintText) pfHintText.textContent = 'Sin conexión con el servidor · mostrando los últimos videos';
                } else {
                    pfStatusMessage('offline', 'Sin conexión con el servidor',
                        'Abrí la página desde el servidor local (python server.py) para ver tus videos.');
                }
            });
    }

    /* Paso al siguiente/anterior video: scroll animado con easing propio
       (easeOutCubic) para que el movimiento sea suave y termine exactamente
       en el centro de la tarjeta. */
    function pfAnimateTo(to) {
        var max = Math.max(0, pfVp.scrollWidth - pfVp.clientWidth);
        to = Math.max(0, Math.min(max, to));

        var from = pfVp.scrollLeft;
        var delta = to - from;

        if (pfScrollAnim) {
            cancelAnimationFrame(pfScrollAnim);
            pfScrollAnim = null;
        }
        if (Math.abs(delta) < 1) return;

        /* apagamos el smooth nativo y el snap para no duplicar/frenar la
           animación (el snap mandatorio saltaría a mitad de camino) */
        var prevBehavior = pfVp.style.scrollBehavior;
        var prevSnap = pfVp.style.scrollSnapType;
        pfVp.style.scrollBehavior = 'auto';
        pfVp.style.scrollSnapType = 'none';

        var start = null;
        var dur = 620;

        function frame(ts) {
            if (start === null) start = ts;
            var t = Math.min((ts - start) / dur, 1);
            var eased = 1 - Math.pow(1 - t, 3);          /* easeOutCubic */
            pfVp.scrollLeft = from + delta * eased;
            if (t < 1) {
                pfScrollAnim = requestAnimationFrame(frame);
            } else {
                pfScrollAnim = null;
                pfVp.style.scrollBehavior = prevBehavior;
                pfVp.style.scrollSnapType = prevSnap;
            }
        }

        pfScrollAnim = requestAnimationFrame(frame);
    }

    function pfStopAnim() {
        if (!pfScrollAnim) return;
        cancelAnimationFrame(pfScrollAnim);
        pfScrollAnim = null;
        pfVp.style.scrollBehavior = '';
        pfVp.style.scrollSnapType = '';
    }

    function pfStep(dir) {
        if (!pfSnap.length) return;
        var idx = pfFocusIdx + dir;
        if (idx < 0) idx = 0;
        if (idx > pfSnap.length - 1) idx = pfSnap.length - 1;
        pfAnimateTo(pfSnap[idx]);
    }

    /* Arrastre con el mouse (en táctil funciona el scroll nativo) */
    function pfInitDrag() {
        var down = false, startX = 0, startLeft = 0, moved = false;

        pfVp.addEventListener('pointerdown', function (e) {
            pfStopAnim();      /* el usuario tomó el control del carrusel */
            if (e.pointerType !== 'mouse' || e.button !== 0) return;
            if (e.target && e.target.closest && e.target.closest('a')) return;
            down = true;
            moved = false;
            startX = e.clientX;
            startLeft = pfVp.scrollLeft;
            pfVp.classList.add('is-dragging');
        });

        pfVp.addEventListener('pointermove', function (e) {
            if (!down) return;
            var dx = e.clientX - startX;
            if (!moved && Math.abs(dx) > 5) moved = true;
            if (moved) {
                pfVp.scrollLeft = startLeft - dx;
                e.preventDefault();
            }
        });

        ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (type) {
            pfVp.addEventListener(type, function () {
                if (!down) return;
                down = false;
                pfVp.classList.remove('is-dragging');
                if (moved) {
                    pfLastDrag = Date.now();   /* el click de después no debe reproducir */
                    moved = false;
                }
            });
        });
    }

    function pfHandleAuth() {
        var found = /[?&]auth=([a-z_]+)/i.exec(window.location.search);
        if (!found) return null;
        var kind = found[1];

        if (kind === 'ok') {
            pfStatusMessage('empty', 'Cuenta conectada',
                'Tus videos de TikTok se están sincronizando.');
        } else if (kind === 'not_configured') {
            pfStatusMessage('not_configured', 'Videos sin configurar',
                'Faltan el client_key y el client_secret de la API de TikTok en la configuración del servidor (ver PORTAFOLIO.md).');
        } else if (kind === 'state') {
            pfStatusMessage('state', 'Enlace vencido',
                'Volvé a intentar conectar tu cuenta de TikTok.');
        } else {
            pfStatusMessage('api_error', 'No se pudo conectar',
                'TikTok no autorizó el acceso. Revisá que la redirect_uri registrada en developers.tiktok.com coincida con la de este servidor.');
        }

        if (window.history && window.history.replaceState) {
            window.history.replaceState(null, '', window.location.pathname);
        }
        return kind;
    }

    function pfInit() {
        pfLayout();

        if (pfPrev) pfPrev.addEventListener('click', function () { pfStep(-1); });
        if (pfNext) pfNext.addEventListener('click', function () { pfStep(1); });
        if (pfRefresh) pfRefresh.addEventListener('click', function () { pfLoad(true); });

        pfVp.addEventListener('scroll', function () {
            if (pfTicking) return;
            pfTicking = true;
            window.requestAnimationFrame(function () { pfDepth(); pfTicking = false; });
        }, { passive: true });

        pfVp.addEventListener('keydown', function (e) {
            if (e.key === 'ArrowRight') { pfStep(1); e.preventDefault(); }
            else if (e.key === 'ArrowLeft') { pfStep(-1); e.preventDefault(); }
        });

        window.addEventListener('resize', pfLayout);
        pfInitDrag();

        var auth = pfHandleAuth();
        pfLoad(auth === 'ok');

        /* "Tiempo real": reconsulta cada 5 min si la pestaña está visible */
        setInterval(function () {
            if (document.visibilityState === 'visible') pfLoad(false);
        }, 5 * 60 * 1000);
    }

    if (pfVp && pfTrack && pfCarousel) pfInit();

    /* ============================================================
       PORTAFOLIOS - videos de la carpeta de Google Drive
       ------------------------------------------------------------
       - /api/portafolios devuelve el listado: Drive se lee desde el
         servidor (60 s de cache), asi que si agregas un video a la
         carpeta, la pagina lo refleja sola en un minuto.
       - los bytes llegan por /drive/video/<id>: rewrite en el borde de
         Vercel en produccion, proxy del server.py en local (Drive no
         deja enlazar el archivo desde otro dominio: responde 403 a
         todo request Sec-Fetch-Site: cross-site).
       - la carga nativa tiene un tope de 5 s: si Drive la corta (la
         cuota es por IP y la de Vercel se agota seguido) o no llega el
         primer cuadro, el visor cae al reproductor OFICIAL de Drive
         (iframe /preview), que usa el pipeline de YouTube y no depende
         ni de la cuota de descarga ni de las IPs de Vercel. Un video
         que ya cayo una vez se abre directo en el respaldo.
       - la tira avanza de izquierda a derecha en bucle y cada video
         recien carga/reproduce cuando esta cerca de la pantalla.
       ============================================================ */
    var plStrip = document.getElementById('plStrip');
    var plTrack = document.getElementById('plTrack');
    var plStatus = document.getElementById('plStatus');
    var plItems = [];
    var plSignature = '';
    var plLastLoad = 0;
    var plResizeTimer = null;

    function plStatusMsg(title, body) {
        if (!plStatus) return;
        plStatus.hidden = false;
        plStatus.textContent = '';

        var head = document.createElement('span');
        head.className = 'pf-status-title';
        head.textContent = title;
        plStatus.appendChild(head);

        var text = document.createElement('span');
        text.textContent = body;
        plStatus.appendChild(text);
    }

    function plStatusOk() {
        if (plStatus) plStatus.hidden = true;
    }

    /* La deriva de la tira queda congelada mientras cargan las
       miniaturas: redibujar imágenes que llegan dentro de la tira en
       movimiento se ve como tirones en un celular. Sale con load, con
       error o con un tope de 6 s por si una descarga se queda colgada. */
    var plThumbPend = 0;
    var plThumbOn = false;

    function plThumbDone() {
        plThumbPend--;
        if (plThumbPend <= 0 && plThumbOn) {
            plThumbOn = false;
            plStrip.classList.remove('is-loading');
        }
    }

    function plThumbWait(img) {
        if (!img.src || img.complete) return;   /* caché: ni se entera */
        if (!plThumbOn) {
            plThumbOn = true;
            plStrip.classList.add('is-loading');
            setTimeout(function () {
                plThumbPend = 0;
                plThumbOn = false;
                plStrip.classList.remove('is-loading');
            }, 6000);
        }
        plThumbPend++;
        img.addEventListener('load', plThumbDone, { once: true });
        img.addEventListener('error', plThumbDone, { once: true });
    }

    function plCard(video, clone) {
        var fig = document.createElement('figure');
        fig.className = 'pl-item';
        if (clone) {
            /* la mitad duplicada del bucle: se oculta al lector de pantalla
               y no recibe foco, pero sigue siendo clickeable */
            fig.setAttribute('aria-hidden', 'true');
            fig.setAttribute('tabindex', '-1');
        } else {
            fig.setAttribute('role', 'button');
            fig.setAttribute('tabindex', '0');
            fig.setAttribute('aria-label', 'Reproducir ' + video.name);
        }

        /* La tarjeta NO reproduce nada: el video entero recién se carga
           dentro del visor. Un <img> en vez de un <video> con poster deja
           la tira sin capas de video (en un celular, elementos de video
           dentro de la tira en movimiento se ven como parpadeo) y además
           nos da el evento de carga de cada miniatura. */
        var v = document.createElement('img');
        v.className = 'pl-thumb';
        v.alt = '';
        v.setAttribute('aria-hidden', 'true');
        v.decoding = 'async';
        if (video.thumb) {
            v.src = video.thumb;
            plThumbWait(v);
        }

        var cap = document.createElement('figcaption');
        cap.textContent = video.name.replace(/\.[a-z0-9]+$/i, '');

        var play = document.createElement('i');
        play.className = 'fa-solid fa-play pl-play';
        play.setAttribute('aria-hidden', 'true');

        fig.appendChild(v);
        fig.appendChild(cap);
        fig.appendChild(play);

        fig.__src = video.video;          /* de aca arranca en el visor */
        fig.__id = video.id || '';        /* id para el respaldo de Drive */
        fig.__poster = video.thumb || ''; /* primer cuadro del visor */
        fig.__name = cap.textContent;

        fig.addEventListener('click', function () { plOpen(fig); });
        fig.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
                e.preventDefault();
                plOpen(fig);
            }
        });
        return fig;
    }

    /* ==================== VISOR (crece y reproduce con sonido) ============
       Técnica FLIP: se mide la tarjeta de origen, el visor se abre con el
       video en la escala y el lugar exacto de esa tarjeta y en el siguiente
       frame se le quita la transformación -> crece suave hasta el centro.
       Al cerrar vuelve al revés y se suelta el buffer del video. */
    var plModal = document.getElementById('plModal');
    var plModalCard = document.getElementById('plModalCard');
    var plModalVideo = document.getElementById('plModalVideo');
    var plModalPoster = document.getElementById('plModalPoster');
    var plModalName = document.getElementById('plModalName');
    var plModalClose = document.getElementById('plModalClose');
    var plModalBackdrop = document.getElementById('plModalBackdrop');
    var plModalRetry = document.getElementById('plModalRetry');
    var plOrigin = null;
    var plOpenFlag = false;
    var plCloseTimer = null;
    var plGuardTimer = null;         /* tope de espera (nativo o respaldo) */
    var plLockY = 0;                 /* scroll congelado mientras se ve */
    var plFlipDone = false;          /* terminó la animación de apertura */
    var plHasFrame = false;          /* el video ya tiene su primer cuadro */
    var plEmbed = document.getElementById('plModalEmbed');
    var plEmbedReady = false;        /* el visor oficial de Drive cargó */
    var plViajaron = {};             /* ids que ya cayeron al respaldo */
    var plId = '';                   /* id del video abierto */
    var plSrc = '';                  /* URL nativa del video abierto */

    /* true: primero el video nativo (click -> agranda -> reproduce solo
       con sonido); si falla o se pasa del tope, cae al visor oficial de
       Drive. false: siempre el visor oficial (cero espera, pero pide un
       segundo toque adentro del reproductor de Google). */
    var PL_NATIVO_PRIMERO = true;
    var PL_NATIVO_MS = 5000;         /* tope de la carga nativa */
    var PL_EMBEDEV_MS = 12000;       /* tope del visor oficial */

    var PL_EASE = 'cubic-bezier(0.2, 0.9, 0.25, 1)';

    /* El video a la vista solo cuando YA TIENE CUADRO y la animación de
       apertura terminó: mientras tanto se ve el primer cuadro + spinner.
       Así no hay pantalla negra ni video dibujado a media carga. */
    function plShowVideo() {
        if (plFlipDone && plHasFrame) plModalCard.classList.add('is-playing');
    }

    /* Arranca la reproducción. Si el navegador no lo permite (bloqueo de
       reproducción automática) se pide el video igual con preload=auto para
       mostrarlo con sus controles y que el usuario lo inicie a mano; si el
       problema es la fuente, onerror deriva al respaldo (visor oficial). */
    function plStart() {
        var q = plModalVideo.play();
        if (q && q.catch) q.catch(function (e) {
            if (e && e.name === 'NotAllowedError') {
                plModalVideo.preload = 'auto';
                plModalVideo.load();
            }
        });
    }

    /* Manejadores de la carga NATIVA: se atan en cada intento y se desatan
       al pasar al respaldo (así vaciar el src no dispara otro error en
       cadena). Si llega el primer cuadro se cancela el tope; si hay error
       Drive -> visor oficial de Drive. */
    function plNatAsignar() {
        plModalVideo.onloadeddata = function () {
            plHasFrame = true;
            clearTimeout(plGuardTimer);     /* llegó el cuadro: sin tope */
            plShowVideo();
        };
        plModalVideo.onerror = function () {
            if (plModal.hidden) return;
            plEmbedAbrir();
        };
    }

    /* Respaldo: visor oficial de Drive (iframe /preview). Ese visor usa el
       pipeline de YouTube: no toca la cuota de descarga ni las IPs de
       Vercel, así que reproduce aunque el proxy esté cortado. El id queda
       registrado: si el mismo video se vuelve a abrir, va directo acá sin
       esperar el fallo nativo ni gastar bytes. */
    function plEmbedAbrir() {
        if (!plModal || plModal.hidden || plEmbedReady) return;
        clearTimeout(plGuardTimer);

        if (!plId || !plEmbed) {            /* sin respaldo posible */
            plModalCard.classList.add('is-error');
            return;
        }
        plViajaron[plId] = true;

        /* el nativo se corta del todo: cero bytes colgados */
        plModalVideo.onloadeddata = null;
        plModalVideo.onerror = null;
        plModalVideo.removeAttribute('src');
        plModalVideo.load();

        plModalCard.classList.add('is-embed');
        if (!plEmbed.getAttribute('src')) {
            plEmbed.src = 'https://drive.google.com/file/d/' + plId + '/preview';
        }

        plGuardTimer = setTimeout(function () {
            if (plModal.hidden || plEmbedReady) return;
            plModalCard.classList.add('is-error');
            if (plModalRetry && plModalRetry.focus) {
                try { plModalRetry.focus({ preventScroll: true }); } catch (err) {}
            }
        }, PL_EMBEDEV_MS);
    }

    /* El reintento agrega un sello de tiempo a la URL: así, si el CDN guardó
       la respuesta mala de Drive, se pide de nuevo al origen en vez de volver
       a recibir el error cacheado. El primer intento usa la URL limpia. */
    function plFreshSrc() {
        var base = (plModalVideo.getAttribute('src') || '').split('?')[0];
        if (base) plModalVideo.src = base + '?r=' + Date.now();
    }

    function plFlip(from, duration, onEnd) {
        /* from = rect de la tarjeta de origen; el visor arranca ahí a esa
           escala y en el siguiente frame se suelta hasta su tamaño real */
        var t = plModalCard.getBoundingClientRect();
        if (!t.width || !from.width) { if (onEnd) onEnd(); return; }

        var dx = (from.left + from.width / 2) - (t.left + t.width / 2);
        var dy = (from.top + from.height / 2) - (t.top + t.height / 2);
        var sx = from.width / t.width;
        var sy = from.height / t.height;

        plModalCard.style.willChange = 'transform';     /* solo mientras anima */
        plModalCard.style.transition = 'none';
        plModalCard.style.transform =
            'translate(' + dx.toFixed(2) + 'px,' + dy.toFixed(2) + 'px) scale(' +
            sx.toFixed(4) + ',' + sy.toFixed(4) + ')';
        void plModalCard.offsetWidth;      /* fuerza el refresco del estilo */

        requestAnimationFrame(function () {
            plModalCard.style.transition = 'transform ' + duration + 's ' + PL_EASE;
            plModalCard.style.transform = 'none';
        });

        setTimeout(function () {
            /* Se saca el will-change: si queda, la capa compuesta sigue
               escalando la textura y el video termina borroso */
            plModalCard.style.willChange = '';
            plModalCard.style.transition = '';
            if (onEnd) onEnd();
        }, duration * 1000 + 80);
    }

    function plOpen(fig) {
        if (!plModal || plOpenFlag || !plModal.hidden) return;
        if (!fig || !fig.__src) return;             /* nada que reproducir */
        plOpenFlag = true;
        plOrigin = fig;

        var r = fig.getBoundingClientRect();

        /* El scroll se congela devolviéndolo a su lugar, NO con overflow:
           bloquear overflow hace que la página se corra (barra clásica) y
           eso se ve como salto gráfico al abrir. */
        plLockY = window.scrollY || window.pageYOffset || 0;
        document.body.classList.add('is-modal-open');

        var posterSrc = fig.__poster || '';
        if (posterSrc) {
            plModalPoster.src = posterSrc;
        } else {
            plModalPoster.removeAttribute('src');
        }
        plModalName.textContent = fig.__name || '';
        plModalCard.classList.remove('is-playing');
        plModalCard.classList.remove('is-error');
        plModalCard.classList.remove('is-embed');
        plFlipDone = false;
        plHasFrame = false;
        plEmbedReady = false;
        plId = fig.__id || '';
        plSrc = fig.__src || '';
        clearTimeout(plGuardTimer);
        if (plEmbed) plEmbed.removeAttribute('src');

        plModal.hidden = false;
        plModal.classList.add('is-open');
        plFlip(r, 0.45, function () { plFlipDone = true; plShowVideo(); });

        if (!PL_NATIVO_PRIMERO || (plId && plViajaron[plId])) {
            /* este video ya falló antes (o está en modo solo-respaldo):
               directo al visor oficial, sin esperar ni gastar bytes */
            plEmbedAbrir();
        } else {
            /* preload=none: solo se descarga si se va a reproducir (menos
               peso para la cuota de Drive) y al cerrar se corta con
               removeAttribute+load */
            plModalVideo.preload = 'none';
            plModalVideo.src = plSrc;

            /* gesto del usuario -> sonido y desde el segundo 0 */
            plModalVideo.muted = false;
            plNatAsignar();
            /* si en PL_NATIVO_MS no llega ni el primer cuadro, respaldo */
            plGuardTimer = setTimeout(plEmbedAbrir, PL_NATIVO_MS);
            try { plModalVideo.currentTime = 0; } catch (err) { /* sin metadata aún */ }
            plStart();
        }

        /* el foco cae en el visor (no en la X): así la barra espaciadora
           pausa/reanuda y Escape cierra igual */
        if (plModalCard && plModalCard.focus) {
            plModalCard.focus({ preventScroll: true });
        }
        plOpenFlag = false;
    }

    function plFinishClose() {
        plModal.hidden = true;
        plModalCard.classList.remove('is-playing');
        plModalCard.classList.remove('is-error');
        plModalCard.classList.remove('is-embed');
        clearTimeout(plGuardTimer);
        plEmbedReady = false;
        if (plEmbed) plEmbed.removeAttribute('src');   /* corta el iframe */
        plModalCard.style.transition = 'none';
        plModalCard.style.transform = '';
        plModalVideo.removeAttribute('src');
        plModalVideo.onloadeddata = null;
        plModalVideo.onerror = null;
        plModalVideo.preload = 'none';            /* nada en reposo */
        plModalVideo.load();                  /* suelta el buffer y la conexión */
        plModalPoster.removeAttribute('src');
        plModalName.textContent = '';
        /* recién acá vuelve a correr la tira: la tarjeta de origen no se
           movió ni un milímetro mientras el visor volvía a su lugar */
        document.body.classList.remove('is-modal-open');
        if (plOrigin && plOrigin.focus) plOrigin.focus({ preventScroll: true });
        plOrigin = null;
    }

    function plClose() {
        if (!plModal || plModal.hidden || plCloseTimer) return;
        plCloseTimer = true;

        plModal.classList.remove('is-open');
        plModalVideo.pause();

        if (plOrigin) plFlip(plOrigin.getBoundingClientRect(), 0.4);

        plCloseTimer = setTimeout(function () {
            plCloseTimer = null;
            plFinishClose();
        }, 480);
    }

    function plMeasure() {
        /* el track va duplicado: media vuelta = la mitad del ancho total */
        var half = plTrack.scrollWidth / 2;
        if (!half) return;
        var speed = parseFloat(getComputedStyle(plStrip).getPropertyValue('--pl-speed')) || 42;
        plTrack.style.setProperty('--pl-dur', Math.round(half / speed) + 's');
    }

    function plRender(videos) {
        var sig = videos.map(function (x) { return x.id; }).join(',');
        if (sig === plSignature) return false;      /* no cambió: no se reconstruye */
        plSignature = sig;

        while (plTrack.firstChild) plTrack.removeChild(plTrack.firstChild);
        plItems = [];

        if (!videos.length) {
            plStrip.classList.add('is-empty');
            return true;
        }

        var frag = document.createDocumentFragment();
        for (var pass = 0; pass < 2; pass++) {      /* duplicado: bucle sin salto */
            for (var i = 0; i < videos.length; i++) {
                var card = plCard(videos[i], pass === 1);
                plItems.push(card);
                frag.appendChild(card);
            }
        }
        plTrack.appendChild(frag);
        plStrip.classList.remove('is-empty');

        plMeasure();
        return true;
    }

    function plLoad() {
        plLastLoad = Date.now();
        if (!plItems.length) {
            plStatusMsg('Cargando portafolios…', 'Buscando los videos de la carpeta de Google Drive.');
        }

        fetch('/api/portafolios')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                var videos = (data && data.videos) || [];
                if (!videos.length) {
                    if (plItems.length) return;     /* ya hay tira: no se tapa */
                    plStatusMsg('Portafolios vacíos',
                        (data && data.message) || 'La carpeta todavía no tiene videos.');
                    return;
                }
                plRender(videos);
                plStatusOk();
            })
            .catch(function () {
                if (plItems.length) return;
                plStatusMsg('Portafolios no disponibles',
                    'No se pudo leer la carpeta de Google Drive.');
            });
    }

    function plInit() {
        if (!plStrip || !plTrack) return;

        /* Visor: se cierra con el fondo, con la X o con Escape. El foco
           arranca en el visor, asi que la barra espaciadora pausa/reanuda */
        if (plModal) {
            if (plModalBackdrop) plModalBackdrop.addEventListener('click', plClose);
            if (plModalClose) plModalClose.addEventListener('click', plClose);
            if (plModalCard) {
                plModalCard.addEventListener('keydown', function (e) {
                    /* La barra espaciadora sobre el botón de reintentar es
                       suya (activa el botón): acá solo se maneja el visor */
                    if (e.target && e.target.id === 'plModalRetry') return;
                    if (e.key === ' ' || e.key === 'Spacebar') {
                        e.preventDefault();
                        /* con el respaldo activo maneja su reproductor
                           el reproductor de Google (iframe cross-origin) */
                        if (plModalCard.classList.contains('is-embed')) return;
                        if (plModalVideo.paused) {
                            var q = plModalVideo.play();
                            if (q && q.catch) q.catch(function () {});
                        } else {
                            plModalVideo.pause();
                        }
                    }
                });
            }
            if (plModalRetry) {
                plModalRetry.addEventListener('click', function () {
                    plModalCard.classList.remove('is-error');
                    plModalCard.classList.remove('is-playing');
                    plModalCard.classList.remove('is-embed');
                    plEmbedReady = false;
                    if (plEmbed) plEmbed.removeAttribute('src');
                    plHasFrame = false;
                    clearTimeout(plGuardTimer);
                    plModalCard.focus({ preventScroll: true });

                    if (plId && plViajaron[plId]) {
                        /* ya sabemos que el nativo falla: recarga el visor
                           oficial directo (otra oportunidad para Google) */
                        plEmbedAbrir();
                        return;
                    }
                    /* reintenta el camino nativo; si vuelve a fallar,
                       plNatAsignar->plEmbedAbrir vuelve al respaldo */
                    if (!plSrc) { plModalCard.classList.add('is-error'); return; }
                    plModalVideo.preload = 'none';
                    plModalVideo.src = plSrc;
                    plModalVideo.muted = false;
                    plNatAsignar();
                    plGuardTimer = setTimeout(plEmbedAbrir, PL_NATIVO_MS);
                    plFreshSrc();
                    plStart();
                });
            }

            /* Carga del visor oficial de Drive: cuando su "load" confirma
               que el iframe de /preview esta listo, se muestra en el mismo
               lugar donde iría el video nativo (misma caja, misma X). */
            if (plEmbed) {
                plEmbed.addEventListener('load', function () {
                    if (plModal.hidden) return;
                    if ((plEmbed.getAttribute('src') || '').indexOf('drive.google.com') < 0) return;
                    plEmbedReady = true;
                    clearTimeout(plGuardTimer);
                    plModalCard.classList.remove('is-error');
                    plHasFrame = true;
                    plShowVideo();
                });
            }
            document.addEventListener('keydown', function (e) {
                if (e.key === 'Escape' && !plModal.hidden) plClose();
            });

            /* Scroll congelado mientras el visor esta abierto: se devuelve
               a la misma posicion en vez de bloquear overflow (bloquear la
               barra corre la pagina en navegadores con scrollbar clasica =
               salto grafico al abrir y al cerrar). */
            window.addEventListener('scroll', function () {
                if (!document.body.classList.contains('is-modal-open')) return;
                var y = window.scrollY || window.pageYOffset || 0;
                if (y !== plLockY) window.scrollTo(0, plLockY);
            }, { passive: true });
        }

        plLoad();

        /* "Siempre al día": cada minuto, y solo si la tira está a la vista */
        setInterval(function () {
            if (document.visibilityState !== 'visible') return;
            if (!plStrip.classList.contains('in-view')) return;
            if (Date.now() - plLastLoad < 60000) return;
            plLoad();
        }, 60000);

        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'visible' &&
                Date.now() - plLastLoad >= 60000) plLoad();
        });

        window.addEventListener('resize', function () {
            clearTimeout(plResizeTimer);
            plResizeTimer = setTimeout(plMeasure, 180);
        });
    }

    if (plStrip && plTrack) plInit();

    /* ---- Bordes con blur: se apagan cuando su extremo queda a la vista ----
       Al tope de la pagina el blur de arriba desaparece (se ve nitido el
       encabezado) y al final desaparece el de abajo (se ve nitido el pie).
       Se maneja por opacidad: no hay que rehacer el filtro en cada frame. */
    var edgeTop = document.querySelector('.edge-blur--top');
    var edgeBottom = document.querySelector('.edge-blur--bottom');

    function updateEdges() {
        var y = window.scrollY || window.pageYOffset || 0;
        var vh = window.innerHeight || 1;
        var doc = document.documentElement;
        var maxY = Math.max(1, (doc.scrollHeight || 0) - vh);
        var range = vh * 0.42;                    /* tramo del fundido */
        var top = Math.min(1, Math.max(0, y / range)).toFixed(3);
        var bot = Math.min(1, Math.max(0, (maxY - y) / range)).toFixed(3);

        if (edgeTop && edgeTop.__op !== top) {
            edgeTop.style.setProperty('--edge-op', top);
            edgeTop.__op = top;
        }
        if (edgeBottom && edgeBottom.__op !== bot) {
            edgeBottom.style.setProperty('--edge-op', bot);
            edgeBottom.__op = bot;
        }
    }

    /* ---- Parallax de capas del fondo (línea de tiempo) ----
       Cada capa se desplaza a su velocidad (data-speed): las de adelante
       se mueven más que las de atrás y se nota la profundidad. Va SOLO en
       translate (sin scale): escalar una capa con will-change obliga al
       compositor a agrandar la textura y la rejilla queda borrosa y
       "temblorosa" al scrollear rápido. */
    var layers = Array.prototype.slice.call(document.querySelectorAll('.bg-layer'));
    if (!layers.length) return;

    var MAX_SCROLL = 2000;   // hasta dónde se mueve el fondo
    var MAX_OFFSET = 640;    // margen real de la capa (top: -700px)

    var ticking = false;
    var lastY = -1;

    function updateLayers() {
        updateEdges();               /* los bordes dependen de la posición */

        var y = window.scrollY || window.pageYOffset || 0;
        if (y === lastY) { ticking = false; return; }   /* nada cambió */
        lastY = y;

        var eff = Math.min(y, MAX_SCROLL);
        for (var i = 0; i < layers.length; i++) {
            var speed = parseFloat(layers[i].getAttribute('data-speed')) || 0;
            if (!speed) continue;
            var offset = Math.min(eff * speed, MAX_OFFSET);
            var tf = 'translate3d(0, ' + (-offset) + 'px, 0)';
            if (layers[i].__tf !== tf) {          /* solo si cambió */
                layers[i].style.transform = tf;
                layers[i].__tf = tf;
            }
        }
        ticking = false;
    }

    function onScroll() {
        if (!ticking) {
            ticking = true;
            window.requestAnimationFrame(updateLayers);
        }
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    updateLayers();
});

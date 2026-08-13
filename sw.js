/* Service worker för Vinkällaren.
 *
 * Gör två saker:
 *  1. Sidan går att öppna helt utan nät — filerna ligger i cachen.
 *  2. Chrome skickar beforeinstallprompt, så installationsknappen fungerar.
 *
 * Bara sidans egna filer rörs. Anropen till Homey går alltid orörda förbi:
 * en cachad vinlista som utger sig för att vara färsk vore värre än ingen.
 */
const CACHE = 'vinkallaren-v1';

/* Skalet. Ikonerna ligger med för att appen ska se rätt ut även första
   gången den öppnas utan nät. */
const SKAL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-mask-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    /* Var fil för sig. addAll faller om EN saknas, och då blir hela
       installationen misslyckad för en bortglömd ikons skull. */
    await Promise.all(SKAL.map((f) => c.add(f).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const namn = await caches.keys();
    await Promise.all(namn.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

/**
 * Hämta med tidsgräns.
 *
 * Utan den hänger en halvdöd anslutning — telefonen tror den har nät men
 * ingenting kommer fram — och sidan står och laddar i stället för att falla
 * tillbaka på cachen. Det är precis det läget man är i på tåget.
 */
function medTidsgrans(req, ms) {
  return new Promise((klar, fel) => {
    const t = setTimeout(() => fel(new Error('timeout')), ms);
    fetch(req).then(
      (r) => { clearTimeout(t); klar(r); },
      (e) => { clearTimeout(t); fel(e); },
    );
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (x) { return; }

  /* Bara vår egen katalog. Homey och Google Fonts går orörda förbi — de ska
     vara färska eller misslyckas, inte serveras ur en gammal cache. */
  if (url.origin !== self.location.origin) return;
  const bas = self.location.pathname.replace(/[^/]*$/, '');
  if (url.pathname.indexOf(bas) !== 0) return;

  e.respondWith((async () => {
    try {
      const svar = await medTidsgrans(req, 4000);
      /* Spara bara riktiga svar. En 404-sida i cachen är värre än inget:
         den serveras sedan glatt varje gång man är offline. */
      if (svar && svar.ok && svar.status === 200) {
        const kopia = svar.clone();
        caches.open(CACHE).then((c) => c.put(req, kopia)).catch(() => {});
      }
      return svar;
    } catch (fel) {
      const cachad = await caches.match(req, { ignoreSearch: true });
      if (cachad) return cachad;
      /* En navigering utan träff: fall tillbaka på startsidan. Adressen kan
         ha en frågesträng (?las=1) som aldrig cachats för sig. */
      if (req.mode === 'navigate') {
        const start = await caches.match(`${bas}index.html`)
          || await caches.match(bas);
        if (start) return start;
      }
      return new Response('Offline och inget i cachen.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
  })());
});

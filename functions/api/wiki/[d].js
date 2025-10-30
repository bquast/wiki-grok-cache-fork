export async function onRequestGet({ request, params, env }) {
  const url = new URL(request.url);
  const mode = url.searchParams.get('mode') || 'exact';
  const q = url.searchParams.get('q');
  let d = params.d;
  let filter;

  if (mode === 'search' && q) {
    filter = { kinds: [30818], search: q, limit: 200 };
  } else {
    filter = { kinds: [30818], '#d': [d], limit: 50 };
  }

  const KV = env.WIKI_CACHE;
  const cacheKey = (mode === 'exact') ? `wiki:${d}` : null; // No caching for search
  const relays = ['wss://relay.damus.io', 'wss://nos.lol'];
  const TTL = 3600 * 1000; // 1 hour

  let cached = (cacheKey) ? await KV.get(cacheKey) : null;
  let fromCache = false;
  if (cached) {
    cached = JSON.parse(cached);
    if (Date.now() - cached.lastUpdated < TTL) {
      return new Response(JSON.stringify({ events: cached.events, fromCache: true }), { headers: { 'Content-Type': 'application/json' } });
    }
  }

  const events = [];
  for (const relay of relays) {
    const ws = new WebSocket(relay);
    await new Promise(resolve => ws.addEventListener('open', resolve));

    const subId = 'wiki-' + Math.random().toString(36);
    ws.send(JSON.stringify(['REQ', subId, filter]));

    const eventsPromise = new Promise(resolve => {
      ws.addEventListener('message', msg => {
        const data = JSON.parse(msg.data);
        if (data[0] === 'EVENT') events.push(data[2]);
      });
      setTimeout(() => { ws.send(JSON.stringify(['CLOSE', subId])); resolve(); }, 5000);
    });
    await eventsPromise;
    ws.close();
  }

  const uniqueEvents = [...new Map(events.map(ev => [ev.id, ev])).values()];

  if (cacheKey) {
    await KV.put(cacheKey, JSON.stringify({ events: uniqueEvents, lastUpdated: Date.now() }));
  }

  return new Response(JSON.stringify({ events: uniqueEvents, fromCache }), { headers: { 'Content-Type': 'application/json' } });
}
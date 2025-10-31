export async function onRequestGet({ request, params, env }) {
  const url = new URL(request.url);
  const mode = url.searchParams.get('mode') || 'exact';
  const q = url.searchParams.get('q');
  const tag = url.searchParams.get('tag');
  let d = params.d;
  let filter;
  let limit = 50;

  if (mode === 'search' && q) {
    filter = { kinds: [30818], search: q };
    limit = 300;
  } else if (mode === 'tag' && tag && q) {
    filter = { kinds: [30818], ['#' + tag]: [q] };
  } else {
    filter = { kinds: [30818], '#d': [d] };
  }

  filter.limit = limit;

  const KV = env.WIKI_CACHE;
  const cacheKey = (mode === 'exact') ? `wiki:${d}` : null; // Cache only exact #d
  const relays = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band', 'wss://relay.primal.net'];
  const TTL = 3600 * 1000; // 1 hour

  let cached = (cacheKey) ? await KV.get(cacheKey) : null;
  let fromCache = false;
  if (cached) {
    cached = JSON.parse(cached);
    if (Date.now() - cached.lastUpdated < TTL) {
      fromCache = true;
      return new Response(JSON.stringify({ events: cached.events, fromCache }), { headers: { 'Content-Type': 'application/json' } });
    }
  }

  const events = [];
  for (const relay of relays) {
    try {
      const ws = new WebSocket(relay);
      await new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve);
        ws.addEventListener('error', reject);
      });

      const subId = 'wiki-' + Math.random().toString(36).slice(2);
      ws.send(JSON.stringify(['REQ', subId, filter]));

      const timeoutId = setTimeout(() => {
        ws.send(JSON.stringify(['CLOSE', subId]));
        ws.close();
      }, 30000); // Fallback timeout: 30 seconds

      await new Promise((resolve) => {
        ws.addEventListener('message', (msg) => {
          const data = JSON.parse(msg.data);
          if (data[0] === 'EVENT' && data[1] === subId) {
            events.push(data[2]);
          } else if (data[0] === 'EOSE' && data[1] === subId) {
            clearTimeout(timeoutId);
            ws.send(JSON.stringify(['CLOSE', subId]));
            ws.close();
            resolve();
          }
        });

        ws.addEventListener('close', resolve);
        ws.addEventListener('error', resolve); // Resolve on error to continue with other relays
      });
    } catch (e) {
      // Skip failed relay
    }
  }

  const uniqueEvents = [...new Map(events.map(ev => [ev.id, ev])).values()];

  if (cacheKey) {
    await KV.put(cacheKey, JSON.stringify({ events: uniqueEvents, lastUpdated: Date.now() }));
  }

  return new Response(JSON.stringify({ events: uniqueEvents, fromCache }), { headers: { 'Content-Type': 'application/json' } });
}
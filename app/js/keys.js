// Settings → API keys: the free keys some Find clips sources need, with where to get each one.
// The page never gets a saved key back, only that it's set and its last 4 characters.
const SOURCES = [
  { id: 'pexels', name: 'Pexels', what: 'Free stock videos and photos (needed for Pexels)', get: 'https://www.pexels.com/api/new/', getLabel: 'Get a free Pexels key',
    steps: 'Sign up (free), fill in the short form, then copy “Your API key”.', fields: [['pexelsKey', 'API key']] },
  { id: 'pixabay', name: 'Pixabay', what: 'Free stock videos and photos (needed for Pixabay)', get: 'https://pixabay.com/api/docs/#api_search_images', getLabel: 'Get a free Pixabay key',
    steps: 'Sign up or log in (free); your key is shown on that page under “Parameters → key”.', fields: [['pixabayKey', 'API key']] },
  { id: 'openverse', name: 'Openverse', what: 'Optional: makes Openverse photos work when its open servers are busy', get: 'https://api.openverse.org/v1/#tag/auth/operation/register', getLabel: 'How to get Openverse keys',
    steps: 'Register an app (name, description, your email), confirm the email they send, then paste the client ID and secret.', fields: [['openverseId', 'Client ID'], ['openverseSecret', 'Client secret']] },
];
export function initKeys({ toast, esc }) {
  const box = document.querySelector('#setKeys .key-list'); if (!box) return;
  let saved = {};
  const draw = () => {
    box.innerHTML = SOURCES.map((s) => {
      const set = s.fields.every(([k]) => saved[k]);
      return `<div class="key-row" data-src="${s.id}">
        <div class="key-h"><b>${s.name}</b><span class="key-st ${set ? 'on' : ''}">${set ? `Saved ${esc(saved[s.fields[0][0]])}` : 'Not set'}</span></div>
        <small class="key-what">${esc(s.what)}</small>
        <a class="key-get" href="${s.get}" target="_blank" rel="noopener noreferrer">${esc(s.getLabel)} ↗</a>
        <small class="key-steps">${esc(s.steps)}</small>
        <div class="key-in">${s.fields.map(([k, l]) => `<input type="password" autocomplete="off" spellcheck="false" data-key="${k}" placeholder="${set ? 'Paste a new ' + l + ' to replace it' : 'Paste your ' + l}" aria-label="${s.name} ${l}">`).join('')}</div>
        <div class="set-row"><button class="small primary-act" data-save>Save</button>${set ? '<button class="small" data-test>Test</button><button class="small" data-clear>Remove</button>' : ''}<span class="key-msg"></span></div>
      </div>`;
    }).join('');
  };
  const load = async () => { try { saved = (await (await fetch('/api/keys')).json()).keys || {}; } catch {} draw(); };
  const post = async (o) => { const r = await fetch('/api/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) }); saved = (await r.json()).keys || {}; };
  box.addEventListener('click', async (e) => {
    const row = e.target.closest('.key-row'); if (!row) return;
    const s = SOURCES.find((x) => x.id === row.dataset.src), msg = row.querySelector('.key-msg');
    if (e.target.closest('[data-save]')) {
      const o = {};
      row.querySelectorAll('[data-key]').forEach((i) => { if (i.value.trim()) o[i.dataset.key] = i.value.trim(); });
      if (!Object.keys(o).length) { msg.textContent = 'Paste the key first'; return; }
      await post(o); draw();
      const m2 = box.querySelector(`[data-src="${s.id}"] .key-msg`);
      if (s.fields.every(([k]) => saved[k])) { m2.textContent = 'Checking…'; test(s, m2); } else m2.textContent = 'Saved. Add the rest too.';
    } else if (e.target.closest('[data-test]')) { msg.textContent = 'Checking…'; test(s, msg); }
    else if (e.target.closest('[data-clear]')) { await post(Object.fromEntries(s.fields.map(([k]) => [k, '']))); draw(); toast(`${s.name} key removed`); }
  });
  async function test(s, msg) {
    try {
      const j = await (await fetch('/api/keys/test?k=' + s.id)).json();
      msg.className = 'key-msg ' + (j.ok ? 'ok' : 'err');
      msg.textContent = j.ok ? `Works: ${s.name} is ready in Find clips` : j.error;
    } catch { msg.className = 'key-msg err'; msg.textContent = 'Couldn’t check it right now.'; }
  }
  document.getElementById('btnSettings')?.addEventListener('click', load);
  load();
  return { reload: load };
}

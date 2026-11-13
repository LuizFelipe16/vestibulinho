// Acesso ao Supabase da plataforma. Precisa do supabase-js carregado antes (CDN).
// A chave publicável pode ficar no navegador: o acesso é decidido pelas regras (RLS) do banco.
(function () {
  const SB_URL = 'https://iqnpfbkxmprytjkgdpjx.supabase.co';
  const SB_KEY = 'sb_publishable_-y4Py9GWLNlfMckjfU19VA_7fs_RWlJ';
  const ALUNO = 'aluno@vestibulinho.app';
  const sb = window.supabase.createClient(SB_URL, SB_KEY);

  // Data local AAAA-MM-DD (fuso do aparelho).
  const iso = d => { const z = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()); };

  // Fila de gravação: uma linha por vez (uma recusa não derruba as outras), sempre a versão mais nova
  // de cada questão, e nova tentativa se a internet cair. flush() devolve a promessa da fila inteira.
  const queue = new Map(), waits = new Map(); let chain = Promise.resolve(), running = false, retry = null, fails = 0;
  function status(text, tone) {
    let el = document.getElementById('db-status');
    if (!el) { el = document.createElement('div'); el.id = 'db-status'; document.body.appendChild(el); }
    el.textContent = text || ''; el.dataset.tone = tone || ''; el.hidden = !text;
  }
  async function run() {
    running = true;
    while (queue.size) {
      const [k, row] = queue.entries().next().value; queue.delete(k);
      const { error } = await sb.from('answers').upsert([row], { onConflict: 'user_id,set_id,q_id' });
      if (!error) { fails = 0; continue; }
      if (error.code) {                       // recusa do banco (trigger/RLS): não adianta repetir
        // a letra já estava travada; a nota ainda pode ser gravada sozinha
        if (row.note != null) await sb.from('answers').update({ note: row.note }).match({ set_id: row.set_id, q_id: row.q_id });
        status('Essa resposta já estava travada.', 'warn'); setTimeout(() => { if (!queue.size) status(''); }, 4000); continue;
      }
      if (!queue.has(k)) queue.set(k, row);
      fails++; status('Sem conexão: tentando salvar de novo…', 'warn');
      clearTimeout(retry); retry = setTimeout(flush, Math.min(30000, 4000 * fails));
      running = false; return;
    }
    running = false; if (fails === 0) status('');
  }
  function flush() { chain = chain.then(run, run); return chain; }

  window.DB = {
    sb, iso,
    today: () => iso(new Date()),
    async session() { const { data } = await sb.auth.getSession(); return data.session; },
    async login(password) {
      const { error } = await sb.auth.signInWithPassword({ email: ALUNO, password });
      if (error) throw error;
    },
    async logout() { await sb.auth.signOut(); location.href = './'; },
    async requireLogin() {
      const s = await this.session();
      if (!s) { location.replace('./'); throw new Error('sem login'); }
      return s;
    },
    async overview() {
      const [sets, ans, subs] = await Promise.all([
        sb.from('sets').select('id,kind,title,due,ordem,total').order('due').order('ordem'),
        sb.from('answers').select('set_id,choice'),
        sb.from('submissions').select('set_id,submitted_at')]);
      for (const r of [sets, ans, subs]) if (r.error) throw r.error;
      return { sets: sets.data, answers: ans.data, submissions: subs.data };
    },
    async set(id) {
      const [s, a, sub] = await Promise.all([
        sb.from('sets').select('*').eq('id', id).single(),
        sb.from('answers').select('q_id,choice,chute,note').eq('set_id', id),
        sb.from('submissions').select('submitted_at').eq('set_id', id)]);
      for (const r of [s, a, sub]) if (r.error) throw r.error;
      return { set: s.data, answers: a.data, submitted: sub.data.length ? sub.data[0].submitted_at : null };
    },
    // Grava (ou atualiza) a resposta de uma questão. note pode chegar depois; choice e chute vêm juntos.
    save(userId, setId, qId, row) {
      queue.set(setId + '|' + qId, Object.assign({ user_id: userId, set_id: setId, q_id: qId }, row));
      return flush();
    },
    async submit(setId) {
      this.now(); await flush();
      if (queue.size) throw new Error('ainda há respostas sem salvar; confira a internet');
      const { error } = await sb.from('submissions').upsert([{ set_id: setId }], { onConflict: 'user_id,set_id', ignoreDuplicates: true });
      if (error) throw error;
    },
    // Nota com espera (debounce) que conta como pendente e é gravada na hora se a página fechar.
    later(key, fn, ms) { clearTimeout(waits.get(key) && waits.get(key).t); waits.set(key, { fn, t: setTimeout(() => { waits.delete(key); fn(); }, ms || 700) }); },
    now() { waits.forEach(w => { clearTimeout(w.t); w.fn(); }); waits.clear(); },
    pending: () => queue.size > 0 || running || waits.size > 0,
    status
  };
  addEventListener('pagehide', () => window.DB.now());
  addEventListener('beforeunload', e => { window.DB.now(); if (window.DB.pending()) { e.preventDefault(); e.returnValue = ''; } });
})();

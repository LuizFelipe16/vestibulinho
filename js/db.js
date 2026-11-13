// Acesso ao Supabase da plataforma. Precisa do supabase-js carregado antes (CDN).
// A chave publicável pode ficar no navegador: o acesso é decidido pelas regras (RLS) do banco.
(function () {
  const SB_URL = 'https://iqnpfbkxmprytjkgdpjx.supabase.co';
  const SB_KEY = 'sb_publishable_-y4Py9GWLNlfMckjfU19VA_7fs_RWlJ';
  const ALUNO = 'aluno@vestibulinho.app';
  const sb = window.supabase.createClient(SB_URL, SB_KEY);

  // Data local AAAA-MM-DD (fuso do aparelho).
  const iso = d => { const z = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()); };

  // Fila de gravação: guarda a última versão de cada linha e tenta de novo se a internet cair.
  const queue = new Map(); let flushing = false, retry = null;
  function status(text, tone) {
    let el = document.getElementById('db-status');
    if (!el) { el = document.createElement('div'); el.id = 'db-status'; document.body.appendChild(el); }
    el.textContent = text || ''; el.dataset.tone = tone || ''; el.hidden = !text;
  }
  async function flush() {
    if (flushing || !queue.size) return; flushing = true;
    const rows = Array.from(queue.values()); queue.clear();
    const { error } = await sb.from('answers').upsert(rows, { onConflict: 'user_id,set_id,q_id' });
    flushing = false;
    if (error) {
      // linha travada pelo banco (treino respondido ou prova enviada) não volta para a fila
      if (/travada|row-level security/i.test(error.message)) { status('Essa resposta já estava travada.', 'warn'); return; }
      rows.forEach(r => { const k = r.set_id + '|' + r.q_id; if (!queue.has(k)) queue.set(k, r); });
      status('Sem conexão: tentando salvar de novo…', 'warn');
      clearTimeout(retry); retry = setTimeout(flush, 4000); return;
    }
    status(''); if (queue.size) flush();
  }

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
      await flush();
      const { error } = await sb.from('submissions').upsert([{ set_id: setId }], { onConflict: 'user_id,set_id', ignoreDuplicates: true });
      if (error) throw error;
    },
    pending: () => queue.size > 0 || flushing,
    status
  };
  addEventListener('beforeunload', e => { if (window.DB.pending()) { e.preventDefault(); e.returnValue = ''; } });
})();

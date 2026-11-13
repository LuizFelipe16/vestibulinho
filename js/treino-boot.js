// Carrega o treino (?set=<id>) e as respostas salvas, liga o HUB do template ao Supabase e inicia a página.
(async function () {
  const id = new URLSearchParams(location.search).get('set');
  let session;
  try { session = await DB.requireLogin(); } catch (e) { return; }
  if (!id) { location.replace('./'); return; }
  let got;
  try { got = await DB.set(id); }
  catch (e) { document.body.insertAdjacentHTML('beforeend', '<div class="card" style="position:fixed;inset:auto 24px 24px;padding:16px;z-index:50">Não consegui carregar o treino: ' + e.message + '. <a href="./">Voltar</a></div>'); return; }
  const { set, answers, submitted } = got;
  const state = { answers: {}, notes: {}, chute: {} };
  answers.forEach(a => { if (a.choice) state.answers[a.q_id] = a.choice; if (a.note) state.notes[a.q_id] = a.note; if (a.chute) state.chute[a.q_id] = true; });
  const last = JSON.parse(JSON.stringify(state));
  const total = (set.data.questions || []).length;
  const latest = {}; let sent = !!submitted;

  function sync(p) {
    const ids = new Set([].concat(Object.keys(p.answers || {}), Object.keys(p.notes || {}), Object.keys(p.chute || {})));
    let noteOnly = false;
    ids.forEach(q => {
      const row = { choice: p.answers[q] || null, chute: !!p.chute[q], note: (p.notes[q] || '').trim() || null };
      const was = { choice: last.answers[q] || null, chute: !!last.chute[q], note: (last.notes[q] || '').trim() || null };
      if (row.choice === was.choice && row.chute === was.chute && row.note === was.note) return;
      last.answers[q] = row.choice; last.chute[q] = row.chute; last.notes[q] = row.note || '';
      latest[q] = row;
      if (row.choice === was.choice && row.chute === was.chute) {          // só a nota mudou: espera parar de digitar
        noteOnly = true; DB.later(id + '|' + q, () => DB.save(session.user.id, id, q, latest[q]));
      } else { DB.later(id + '|' + q, () => {}, 0); DB.save(session.user.id, id, q, row); }   // já leva a nota mais nova junto
    });
    const done = Object.values(p.answers || {}).filter(Boolean).length;
    if (!sent && total && done >= total) { sent = true; DB.submit(id).catch(() => { sent = false; }); }
    return noteOnly;
  }

  window.HUB = {
    doc: { id: 'set-' + id, title: set.title, project: 'vestibulinho' },
    load: initial => Object.assign({}, initial, JSON.parse(JSON.stringify(state))),
    save: p => sync(p),
    copy: () => { location.href = './'; }
  };
  window.SET_DATA = Object.assign({}, set.data, { title: set.title, copyLabel: '← Voltar' });
  document.title = set.title + ' · Vestibulinho';
  window.startTreino();
})();

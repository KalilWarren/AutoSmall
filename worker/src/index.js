/* ============================================================
   AutoSmall → REDCap proxy  (Cloudflare Worker)
   ------------------------------------------------------------
   The static AutoSmall site cannot hold the REDCap API token or
   perform real password checks — anything shipped to the browser
   is readable. This Worker is the secure boundary:

     • Holds the REDCap API token and the shared submit password
       as secrets (set with `wrangler secret put`, never in code).
     • Verifies the password before doing anything.
     • Maps AutoSmall's scoring payload onto the REDCap project's
       `smalls_sentence_repetition` form fields.
     • Imports one record into REDCap server-to-server.

   Bindings:
     Secrets — REDCAP_TOKEN, SUBMIT_PASSWORD
     Vars    — REDCAP_API_URL, ALLOWED_ORIGIN, REDCAP_EVENT (optional)
   ============================================================ */

/* Per-type percentage field names on the REDCap form. Order in each
   array: [initial, medial, final, total]. Note the irregular names —
   `s_s_intial_total` is a typo in the REDCap data dictionary and the
   total fields are spelled out for S-S / O-S / S-O. Kept exact on
   purpose so the import matches the project. */
const TYPE_FIELDS = {
  'Active':  ['active_initial_total',  'active_medial_total',  'active_final_total',  'active_total'],
  'O-O':     ['o_o_initial_total',     'o_o_medial_total',     'o_o_final_total',     'o_o_total'],
  'Passive': ['passive_initial_total', 'passive_medial_total', 'passive_final_total', 'passive_total'],
  'S-S':     ['s_s_intial_total',      's_s_medial_total',     's_s_final_total',     'subject_subject_total'],
  'O-S':     ['o_s_initial_total',     'o_s_medial_total',     'o_s_final_total',     'object_subject_total'],
  'S-O':     ['s_o_initial_total',     's_o_medial_total',     's_o_final_total',     'subject_object_total']
};

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400'
  };
}

function json(status, obj, origin) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
  });
}

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* Constant-time compare of two equal-length hex strings. */
function safeEqualHex(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function numOrBlank(v) {
  return (typeof v === 'number' && isFinite(v)) ? String(v) : '';
}
function pctOrBlank(v) {
  return (typeof v === 'number' && isFinite(v)) ? String(Math.round(v * 100) / 100) : '';
}

/* Map the AutoSmall payload onto REDCap field names. */
function mapRecord(body, pid, date, env) {
  const rec = {
    subject_id: pid,                 // project record-ID field
    field1: pid,                     // "Part ID" field on the form
    sent_rep_data_yes_or_no: '1',    // data was collected
    sent_rep_date: date
  };
  if (env.REDCAP_EVENT) rec.redcap_event_name = env.REDCAP_EVENT;

  // Per-sentence points: blank for any sentence not scored.
  (body.sentences || []).forEach(function (s) {
    const n = s.n;
    const scored = s.scored && Array.isArray(s.points);
    rec['init_' + n] = scored ? String(s.points[0]) : '';
    rec['med_'  + n] = scored ? String(s.points[1]) : '';
    rec['fin_'  + n] = scored ? String(s.points[2]) : '';
  });

  const rt = body.rawTotals || {};
  rec.init_raw  = numOrBlank(rt.initial);
  rec.med_raw   = numOrBlank(rt.medial);
  rec.final_raw = numOrBlank(rt.final);
  rec.raw_total = numOrBlank(rt.total);

  const pt = body.percentTotals || {};
  rec.initial_total    = pctOrBlank(pt.initial);
  rec.medial_total     = pctOrBlank(pt.medial);
  rec.final_total      = pctOrBlank(pt.final);
  rec.total_percentage = pctOrBlank(pt.total);

  const tt = body.typeTotals || {};
  Object.keys(TYPE_FIELDS).forEach(function (type) {
    const f = TYPE_FIELDS[type];
    const v = tt[type] || {};
    rec[f[0]] = pctOrBlank(v.initial);
    rec[f[1]] = pctOrBlank(v.medial);
    rec[f[2]] = pctOrBlank(v.final);
    rec[f[3]] = pctOrBlank(v.total);
  });

  rec.sent_rep_comments = String(body.comments || '');

  /* Mark the instrument's status as Complete (0=Incomplete, 1=Unverified,
     2=Complete) so submitted records don't show as Incomplete in REDCap. */
  rec.smalls_sentence_repetition_complete = '2';
  return rec;
}

/* Pre-flight check: does this record's sentence-repetition form already
   hold data? Returns { hasData, info? } or { error }. Requires the API
   token to have Export rights in addition to Import. */
async function checkExisting(pid, env) {
  const q = new URLSearchParams();
  q.set('token', env.REDCAP_TOKEN);
  q.set('content', 'record');
  q.set('action', 'export');
  q.set('format', 'json');
  q.set('type', 'flat');
  q.set('records[0]', pid);
  q.set('fields[0]', 'sent_rep_date');
  q.set('fields[1]', 'smalls_sentence_repetition_complete');
  if (env.REDCAP_EVENT) q.set('events[0]', env.REDCAP_EVENT);

  let resp, text;
  try {
    resp = await fetch(env.REDCAP_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: q
    });
    text = await resp.text();
  } catch (e) {
    return { error: 'Could not reach REDCap to check for existing data.' };
  }
  if (!resp.ok) {
    return { error: 'REDCap rejected the existing-data check — the API token ' +
      'may need Export rights in addition to Import. ' + text };
  }
  let rows;
  try { rows = JSON.parse(text); }
  catch (e) { return { error: 'Unexpected REDCap response while checking for existing data.' }; }
  if (!Array.isArray(rows) || rows.length === 0) {
    return { hasData: false };
  }
  for (let i = 0; i < rows.length; i++) {
    const date = String(rows[i].sent_rep_date || '').trim();
    const status = rows[i].smalls_sentence_repetition_complete;
    if (date || status === '1' || status === '2') {
      return {
        hasData: true,
        info: {
          date: date || '(no date recorded)',
          status: status === '2' ? 'Complete'
                : status === '1' ? 'Unverified' : 'Incomplete'
        }
      };
    }
  }
  return { hasData: false };
}

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || '*';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== 'POST') {
      return json(405, { ok: false, error: 'Use POST.' }, origin);
    }
    if (!env.REDCAP_TOKEN || !env.SUBMIT_PASSWORD || !env.REDCAP_API_URL) {
      return json(500, { ok: false, error: 'Worker is not fully configured (missing secrets or REDCAP_API_URL).' }, origin);
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json(400, { ok: false, error: 'Request body must be JSON.' }, origin);
    }

    // --- password ---
    const want = await sha256Hex(env.SUBMIT_PASSWORD);
    const got  = await sha256Hex(body.password || '');
    if (!safeEqualHex(got, want)) {
      return json(401, { ok: false, error: 'Incorrect password.' }, origin);
    }

    // --- validate ---
    const pid = String(body.participantId || '').trim();
    if (!pid) {
      return json(400, { ok: false, error: 'Participant ID is required.' }, origin);
    }
    const date = String(body.assessmentDate || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return json(400, { ok: false, error: 'Assessment date must be in YYYY-MM-DD format.' }, origin);
    }

    // --- overwrite guard: never silently replace existing data ---
    if (body.confirmOverwrite !== true) {
      const existing = await checkExisting(pid, env);
      if (existing.error) {
        return json(502, { ok: false, error: existing.error }, origin);
      }
      if (existing.hasData) {
        return json(409, {
          ok: false,
          needsConfirm: true,
          error: 'This participant already has sentence-repetition data in REDCap.',
          existing: existing.info
        }, origin);
      }
    }

    // --- map + import ---
    const record = mapRecord(body, pid, date, env);
    const form = new URLSearchParams();
    form.set('token', env.REDCAP_TOKEN);
    form.set('content', 'record');
    form.set('action', 'import');
    form.set('format', 'json');
    form.set('type', 'flat');
    form.set('overwriteBehavior', 'normal');
    form.set('returnContent', 'count');
    form.set('data', JSON.stringify([record]));

    let resp, text;
    try {
      resp = await fetch(env.REDCAP_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form
      });
      text = await resp.text();
    } catch (e) {
      return json(502, { ok: false, error: 'Could not reach REDCap.', detail: String(e) }, origin);
    }

    if (!resp.ok) {
      return json(502, { ok: false, error: 'REDCap rejected the import.', detail: text }, origin);
    }
    return json(200, { ok: true, participantId: pid, redcap: text }, origin);
  }
};

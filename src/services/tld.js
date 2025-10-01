// /opt/doc-upload-app/src/services/tld.js
import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

/** ===== Config ===== */
const BASE    = process.env.TLD_BASE_URL || '';           // e.g. https://mbf.tldcrm.com
const API_KEY = process.env.TLD_API_KEY || '';
const API_ID  = process.env.TLD_API_ID  || '';

const AUTH_MODE = (process.env.TLD_AUTH_MODE || 'headers').toLowerCase(); // 'headers' | 'basic'
const TIMEOUT   = parseInt(process.env.HTTP_TIMEOUT_MS || '25000', 10);

// Ingress (writes)
const INGRESS_LEADS_PATH = process.env.TLD_INGRESS_LEADS_PATH || '/api/ingress/leads';

// Egress (reads/search)
const EGRESS_LEADS_PATH  = process.env.TLD_EGRESS_LEADS_PATH  || '/api/egress/leads';

/** ===== Helpers ===== */
function authConfig(extraHeaders = {}) {
  if (AUTH_MODE === 'basic') {
    return {
      timeout: TIMEOUT,
      auth: { username: String(API_ID || ''), password: String(API_KEY || '') },
      headers: { ...extraHeaders }
    };
  }
  return {
    timeout: TIMEOUT,
    headers: { 'tld-api-id': API_ID, 'tld-api-key': API_KEY, ...extraHeaders }
  };
}

// Build payload for ingress (NO SSN sent)
function buildLeadPayload({ lead_id, first_name, last_name, phone, email }) {
  const out = { first_name, last_name, phone, email };
  if (lead_id) out.lead_id = lead_id;
  return out;
}

// Extract last 4 digits from any SSN-ish string (e.g., "***-**-1234" -> "1234")
function last4FromValue(v) {
  if (!v) return '';
  const digits = String(v).replace(/\D/g, '');
  return digits.slice(-4);
}

/** Try POST/PUT + JSON/form to satisfy tenant settings (handles 405/415). */
async function tryLeadRequest(payload) {
  const url = `${BASE}${INGRESS_LEADS_PATH}`;
  const combos = [
    { method: 'post', mode: 'json' },
    { method: 'put',  mode: 'json' },
    { method: 'post', mode: 'form' },
    { method: 'put',  mode: 'form' }
  ];
  let lastErr = null;

  for (const { method, mode } of combos) {
    try {
      let data, cfg;
      if (mode === 'json') {
        data = payload;
        cfg = authConfig({ 'Content-Type': 'application/json' });
      } else {
        const params = new URLSearchParams();
        Object.entries(payload).forEach(([k, v]) => {
          if (v !== undefined && v !== null) params.append(k, String(v));
        });
        data = params;
        cfg = authConfig({ 'Content-Type': 'application/x-www-form-urlencoded' });
      }
      const res = await axios({ url, method, data, ...cfg });
      return { data: res.data, method, mode };
    } catch (e) {
      const status = e?.response?.status;
      const txt = e?.response?.data ? JSON.stringify(e.response.data) : String(e);
      if (status === 405 || status === 415 || /Method Not Allowed/i.test(txt)) {
        lastErr = e;
        continue;
      }
      throw e;
    }
  }

  if (lastErr) throw lastErr;
  throw new Error('TLD lead request failed with no response');
}

/** ===== Public API ===== */

/** Upsert a lead (no SSN sent). Returns: { lead_id, raw, trace } */
export async function upsertLead({ lead_id, first_name, last_name, phone, email }) {
  const payload = buildLeadPayload({ lead_id, first_name, last_name, phone, email });
  const { data, method, mode } = await tryLeadRequest(payload);
  const outId =
    data?.lead_id ||
    data?.id ||
    data?.lead?.lead_id ||
    data?.response?.lead_id ||
    null;

  return { lead_id: outId, raw: data, trace: { method, mode, sent: payload } };
}

/**
 * Upload a file to a lead using the documented pattern:
 *   POST https://{subdomain}.tldcrm.com/api/ingress/documents/upload/lead/{lead_id}
 * Headers: tld-api-id, tld-api-key
 * Body: multipart/form-data with field name "file"
 */
export async function uploadFileToTLD(lead_id, filePath, description) {
  if (!lead_id) throw new Error('uploadFileToTLD: lead_id is required');
  if (!filePath) throw new Error('uploadFileToTLD: filePath is required');

  const url = `${BASE}/api/ingress/documents/upload/lead/${encodeURIComponent(String(lead_id))}`;

  const fd = new FormData();
  fd.append('file', fs.createReadStream(filePath));  // REQUIRED field name
  if (description) fd.append('description', description); // optional

  const headers = {
    ...fd.getHeaders(),
    'tld-api-id': API_ID,
    'tld-api-key': API_KEY,
  };

  const { data, status } = await axios.post(url, fd, {
    timeout: TIMEOUT,
    headers,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });

  return {
    ok: true,
    data,
    trace: { endpoint: url, auth: 'headers', field: 'file', status }
  };
}

/**
 * Egress search:
 *   - Queries by NAME ONLY (first_name + last_name) — no SSN in request.
 *   - Follows pagination (via navigate.next) and normalizes responses.
 *   - If ssn_last4 is provided, filters results to those whose SSN last4 matches.
 * Returns an array of rows (each should include lead_id, first_name, last_name, email, phone, ssn when permitted).
 */
export async function searchLeadEgress({ first_name, last_name, ssn_last4 }) {
  const columns = 'ssn,lead_id,first_name,last_name,email,phone';
  const baseUrl = `${BASE}${EGRESS_LEADS_PATH}`;
  const TIMEOUT_MS = TIMEOUT;

  const fn = (first_name || '').trim();
  const ln = (last_name  || '').trim();
  const targetLast4 = (ssn_last4 || '').trim();

  if (!fn || !ln) {
    throw new Error('Name search requires first_name and last_name');
  }

  // Normalize different response shapes into { rows: [...], next: 'url' | null }
  function normalize(data) {
    // Case A: array envelope (e.g., [{ results: [...], navigate: { next } }, { meta... }])
    if (Array.isArray(data)) {
      if (data.length && Array.isArray(data[0]?.results)) {
        return {
          rows: data[0].results,
          next: data[0]?.navigate?.next || null
        };
      }
      // Already an array of rows
      if (data.length && (data[0]?.lead_id || data[0]?.id || data[0]?.first_name || data[0]?.last_name)) {
        return { rows: data, next: null };
      }
    }

    // Case B: object with results array
    if (Array.isArray(data?.results)) {
      return { rows: data.results, next: data?.navigate?.next || null };
    }
    if (Array.isArray(data?.response)) {
      return { rows: data.response, next: null };
    }
    if (Array.isArray(data?.response?.results)) {
      return { rows: data.response.results, next: data?.response?.navigate?.next || null };
    }
    if (Array.isArray(data?.data)) {
      return { rows: data.data, next: null };
    }
    if (Array.isArray(data?.response?.data)) {
      return { rows: data.response.data, next: null };
    }

    // Case C: object with numeric keys => coerce to array
    if (data && typeof data === 'object') {
      const vals = Object.values(data).filter(v => v && typeof v === 'object' && !Array.isArray(v));
      if (vals.length && (vals[0].lead_id || vals[0].id || vals[0].first_name || vals[0].last_name)) {
        return { rows: vals, next: null };
      }
    }

    return { rows: [], next: null };
  }

  // Run NAME-ONLY query, following up to 3 pages
  async function runNameQuery() {
    const params = new URLSearchParams();
    params.append('api_key', API_KEY);
    params.append('api_id',  API_ID);
    params.append('columns', columns);
    params.append('first_name', fn);
    params.append('last_name',  ln);

    let pageUrl = `${baseUrl}?${params.toString()}`;
    let all = [];
    let pages = 0;

    while (pageUrl && pages < 3) {
      const { data } = await axios.get(pageUrl, { timeout: TIMEOUT_MS }); // egress: auth in query only
      const { rows, next } = normalize(data);
      if (Array.isArray(rows) && rows.length) all.push(...rows);
      pageUrl = next || null;
      pages++;
    }
    return all;
  }

  const rows = await runNameQuery();

  // If a last4 was provided, return only the rows whose SSN last4 matches.
  if (targetLast4) {
    const filtered = rows.filter(r => last4FromValue(r?.ssn) === targetLast4);
    return filtered;
  }

  // Otherwise return all name-matched rows.
  return rows;
}

/**
 * Convenience: find a single lead_id by name + last4.
 * Returns { lead_id, match } or { lead_id: null, match: null } if not found.
 */
export async function findLeadIdByNameAndLast4({ first_name, last_name, ssn_last4 }) {
  const rows = await searchLeadEgress({ first_name, last_name, ssn_last4 });
  if (!rows || !rows.length) return { lead_id: null, match: null };
  const m = rows[0];
  return { lead_id: m.lead_id || m.id || null, match: m };
}

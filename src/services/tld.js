import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const BASE = process.env.TLD_BASE_URL;
const EGRESS_PATH = process.env.TLD_EGRESS_PATH || '/api/ingress/leads'; // using ingress for write
const UPLOAD_PATH = process.env.TLD_UPLOAD_PATH || '/api/ingress/documents/upload/lead';
const API_KEY = process.env.TLD_API_KEY;
const API_ID = process.env.TLD_API_ID;
const CREATE_LEAD = (process.env.TLD_CREATE_LEAD_IF_MISSING || 'true').toLowerCase() === 'true';

export async function upsertLead({ first_name, last_name, phone, email, ssn_last4 }) {
  const url = `${BASE}${EGRESS_PATH}`;
  const res = await axios.put(url, {
    first_name, last_name, phone, email,
    ssn: ssn_last4 ? `***-**-${ssn_last4}` : undefined
  }, {
    headers: {
      'Content-Type': 'application/json',
      'tld-api-id': API_ID,
      'tld-api-key': API_KEY
    }
  });
  const data = res.data;
  const lead_id = data?.lead_id || data?.id || data?.lead?.lead_id || null;
  if (!lead_id && !CREATE_LEAD) {
    throw new Error('Lead not found and auto-create disabled');
  }
  return { lead_id, raw: data };
}

export async function uploadFileToTLD(lead_id, filePath) {
  const url = `${BASE}${UPLOAD_PATH}/${lead_id}`;
  const fd = new FormData();
  fd.append('file', fs.createReadStream(filePath));
  const headers = {
    ...fd.getHeaders(),
    'tld-api-id': API_ID,
    'tld-api-key': API_KEY
  };
  const { data } = await axios.post(url, fd, { headers });
  return data;
}

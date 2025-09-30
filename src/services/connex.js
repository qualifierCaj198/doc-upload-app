import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const CONNEX_URL = process.env.CONNEX_TRIGGER_URL;
const CONNEX_AUTH = process.env.CONNEX_BASIC_AUTH;

export async function notifyConnex({ customer_id, fields }) {
  const payload = { customer_id, fields, flow_type: 'customer' };
  const { data } = await axios.post(CONNEX_URL, payload, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': CONNEX_AUTH
    }
  });
  return data;
}

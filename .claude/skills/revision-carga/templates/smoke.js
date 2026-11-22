import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE_URL;
if (!BASE) throw new Error('Falta -e BASE_URL=<url>');

export const options = {
  vus: 1,
  duration: '30s',
  thresholds: {
    http_req_failed: [`rate<${__ENV.ERR_RATE || 0.01}`],
    http_req_duration: [`p(95)<${__ENV.P95_MS || 800}`],
  },
};

// Ajustá las rutas a las reales del proyecto.
const PATHS = (__ENV.PATHS || '/').split(',');

export default function () {
  for (const p of PATHS) {
    const res = http.get(BASE + p);
    check(res, { [`${p} responde 2xx`]: (r) => r.status >= 200 && r.status < 300 });
  }
  sleep(1);
}

import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE_URL;
if (!BASE) throw new Error('Falta -e BASE_URL=<url>');
const USERS = Number(__ENV.USERS || 20);

export const options = {
  stages: [
    { duration: '30s', target: USERS },
    { duration: '2m', target: USERS },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_failed: [`rate<${__ENV.ERR_RATE || 0.01}`],
    http_req_duration: [`p(95)<${__ENV.P95_MS || 800}`],
  },
};

const PATHS = (__ENV.PATHS || '/').split(',');

export default function () {
  const p = PATHS[Math.floor(Math.random() * PATHS.length)];
  const res = http.get(BASE + p);
  check(res, { [`${p} responde 2xx`]: (r) => r.status >= 200 && r.status < 300 });
  sleep(1);
}

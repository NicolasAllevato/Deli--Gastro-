import http from 'k6/http';
import { check, sleep } from 'k6';

// Solo local o staging: sube más allá de lo normal para ver dónde se degrada.
const BASE = __ENV.BASE_URL;
if (!BASE) throw new Error('Falta -e BASE_URL=<url>');
const USERS = Number(__ENV.USERS || 20);

export const options = {
  stages: [
    { duration: '1m', target: USERS },
    { duration: '1m', target: USERS * 3 },
    { duration: '1m', target: USERS * 6 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    // En estrés los umbrales cortan la prueba cuando el sistema ya se degradó.
    http_req_failed: [{ threshold: `rate<${__ENV.ERR_RATE || 0.05}`, abortOnFail: true, delayAbortEval: '30s' }],
    http_req_duration: [`p(95)<${__ENV.P95_MS || 2000}`],
  },
};

const PATHS = (__ENV.PATHS || '/').split(',');

export default function () {
  const p = PATHS[Math.floor(Math.random() * PATHS.length)];
  const res = http.get(BASE + p);
  check(res, { [`${p} responde 2xx`]: (r) => r.status >= 200 && r.status < 300 });
  sleep(1);
}

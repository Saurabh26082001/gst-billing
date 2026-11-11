// One billing server per business. Each runs the unchanged _system/server.js
// with FGSB_HOME pointing at that business's own folder, listening on
// 127.0.0.1 only, so one business can never read another's books. Started on
// first use, stopped after a quiet spell, started again on the next request.
import fs from 'fs';
import net from 'net';
import path from 'path';
import { spawn } from 'child_process';
import { config } from './config.js';

const instances = new Map(); // userId -> { port, child, lastUsed, ready: Promise<number> }

export const homeFor = (userId) => path.join(config.dataRoot, 'tenants', userId);

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function answers(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch { return false; }
}

async function start(userId, inst) {
  const home = homeFor(userId);
  const dataDir = path.join(home, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const portFile = path.join(dataDir, 'port.txt');
  fs.writeFileSync(portFile, String(await freePort()));

  const log = fs.openSync(path.join(home, 'server.log'), 'a');
  const child = spawn(process.execPath, [path.join(config.billingAppDir, 'server.js')], {
    cwd: config.billingAppDir,
    // Only what the billing server needs: never the gateway's payment secrets.
    env: { PATH: process.env.PATH, HOME: home, FGSB_HOME: home, NODE_ENV: 'production', TZ: process.env.TZ || 'Asia/Kolkata' },
    stdio: ['ignore', log, log],
  });
  fs.closeSync(log);

  inst.child = child;
  child.on('exit', () => { if (instances.get(userId) === inst) instances.delete(userId); });

  // The server may move to the next port if the chosen one was taken in the
  // meantime; it writes the port it really got back into port.txt.
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`billing server for ${userId} exited (${child.exitCode}); see ${home}/server.log`);
    const port = Number(fs.readFileSync(portFile, 'utf8').trim());
    if (port && await answers(port)) {
      inst.port = port;
      return port;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill('SIGTERM');
  throw new Error(`billing server for ${userId} did not start within 60 s`);
}

// Port of this business's running server, starting it if needed.
export function portFor(userId) {
  let inst = instances.get(userId);
  if (!inst) {
    if (instances.size >= config.maxInstances) stopLeastRecentlyUsed();
    inst = { child: null, port: 0, lastUsed: Date.now() };
    inst.ready = start(userId, inst).catch((err) => {
      if (instances.get(userId) === inst) instances.delete(userId);
      throw err;
    });
    instances.set(userId, inst);
  }
  inst.lastUsed = Date.now();
  return inst.ready;
}

export function stop(userId) {
  const inst = instances.get(userId);
  instances.delete(userId);
  inst?.child?.kill('SIGTERM'); // the billing server flushes and exits on SIGTERM
}

function stopLeastRecentlyUsed() {
  let oldest = null;
  for (const [id, inst] of instances) if (inst.child && (!oldest || inst.lastUsed < instances.get(oldest).lastUsed)) oldest = id;
  if (oldest) stop(oldest);
}

setInterval(() => {
  const idleMs = config.instanceIdleMinutes * 60_000;
  for (const [id, inst] of instances) if (inst.child && Date.now() - inst.lastUsed > idleMs) stop(id);
}, 60_000).unref();

export function stopAll() {
  for (const id of [...instances.keys()]) stop(id);
}

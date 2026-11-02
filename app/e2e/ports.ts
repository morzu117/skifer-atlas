import { execFileSync } from "node:child_process";

/** Ports fixes de la suite : Vite, retour OAuth, serveurs Atlas et faux services. */
export const E2E_PORTS = [1420, 8020, 8791, 8792, 8793, 8794, 8795, 8796, 8797, 8798, 8799];

// La configuration Playwright se charge de façon synchrone : un Node à part essaie d'écouter
// sur chaque port, en IPv4 et en IPv6 (Vite écoute sur « localhost »). Seul EADDRINUSE
// compte : une machine sans IPv6 refuse ::1 autrement.
const PROBE = `
const net = require("node:net");
const ports = JSON.parse(process.argv[1]);
const probe = (port, host) => new Promise((resolve) => {
  const server = net.createServer();
  server.once("error", (error) => resolve(error.code === "EADDRINUSE"));
  server.listen({ port, host, exclusive: true }, () => server.close(() => resolve(false)));
});
Promise.all(ports.map(async (port) => ((await probe(port, "127.0.0.1")) || (await probe(port, "::1")) ? port : null)))
  .then((found) => process.stdout.write(JSON.stringify(found.filter((port) => port !== null))));
`;

export function busyPorts(ports: number[]): number[] {
  return JSON.parse(execFileSync(process.execPath, ["-e", PROBE, JSON.stringify(ports)], { encoding: "utf8" }));
}

/** Le processus qui écoute sur le port, si `lsof` le dit (macOS, Linux). */
function holder(port: number): string {
  try {
    const out = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpc"], { encoding: "utf8" });
    const pid = out.match(/^p(\d+)/m)?.[1];
    const command = out.match(/^c(.+)/m)?.[1];
    return pid ? ` : ${command ?? "?"} (PID ${pid})` : "";
  } catch {
    return "";
  }
}

export function busyMessage(busy: number[]): string {
  return [
    `Ports de la suite e2e déjà occupés, rien n'a été lancé :`,
    ...busy.map((port) => `  - ${port}${holder(port)}`),
    "Une autre exécution e2e tourne peut-être (un autre worktree) : attendre sa fin, ou arrêter ces processus.",
  ].join("\n");
}

/** Échoue avant de lancer quoi que ce soit si un port de la suite est pris. */
export function assertPortsFree(ports = E2E_PORTS): void {
  const busy = busyPorts(ports);
  if (busy.length) throw new Error(busyMessage(busy));
}

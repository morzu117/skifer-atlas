// @vitest-environment node
import { spawnSync } from "node:child_process";
import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { assertPortsFree, busyMessage, busyPorts } from "../../e2e/ports";

const servers: Server[] = [];
const hasLsof = spawnSync("lsof", ["-h"]).error === undefined;
afterEach(() => servers.splice(0).forEach((server) => server.close()));

function listen(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    servers.push(server);
    server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port));
  });
}

async function freePort(): Promise<number> {
  const port = await listen();
  await new Promise((resolve) => servers.pop()!.close(resolve));
  return port;
}

describe("ports de la suite e2e", () => {
  it("un port pris est signalé, un port libre ne l'est pas", async () => {
    const taken = await listen();
    const free = await freePort();
    expect(busyPorts([taken, free])).toEqual([taken]);
  });

  it("le message nomme le port et dit quoi faire, avant tout lancement", async () => {
    const taken = await listen();
    expect(() => assertPortsFree([taken])).toThrow(String(taken));
    const message = busyMessage([taken]);
    expect(message).toContain("Ports de la suite e2e déjà occupés");
    expect(message).toContain("Une autre exécution e2e tourne peut-être");
    if (hasLsof) expect(message).toContain(`PID ${process.pid}`); // processus qui tient le port
  });
});

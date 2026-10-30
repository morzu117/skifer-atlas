import { useCallback, useEffect, useRef, useState } from "react";
import { api, onUnreachable } from "./api";

// État du serveur local. Sous Tauri, il répond déjà quand l'interface s'affiche ; en dev,
// on le laisse démarrer quelques secondes avant de le déclarer injoignable.

export type Startup = { attempts: number; delayMs: number };

export type ServerState = {
  state: "starting" | "ready" | "unreachable";
  version: string | null;
  /** Change à chaque reconnexion : les écrans rechargent leurs données. */
  generation: number;
  retrying: boolean;
  retry: () => void;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function probe({ attempts, delayMs }: Startup): Promise<string | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return (await api.health()).version;
    } catch {
      if (attempt < attempts - 1) await sleep(delayMs);
    }
  }
  return null;
}

export function useServer(startup: Startup): ServerState {
  const [state, setState] = useState<ServerState["state"]>("starting");
  const [version, setVersion] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    probe(startup).then((found) => {
      if (!alive.current) return;
      setVersion(found);
      setState(found ? "ready" : "unreachable");
    });
    const stop = onUnreachable(() => alive.current && setState("unreachable"));
    return () => {
      alive.current = false;
      stop();
    };
  }, []); // une seule sonde, au démarrage

  const retry = useCallback(() => {
    setRetrying(true);
    probe({ attempts: 1, delayMs: 0 }).then((found) => {
      if (!alive.current) return;
      setRetrying(false);
      if (found) {
        setVersion(found);
        setState("ready");
        setGeneration((g) => g + 1);
      }
    });
  }, []);

  return { state, version, generation, retrying, retry };
}

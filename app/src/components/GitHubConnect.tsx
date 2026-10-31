import { useEffect, useRef, useState } from "react";
import { api, type GitHubDevice } from "../api";
import { openExternal } from "../external";
import { explain } from "../messages";

// Connexion GitHub par le device flow (plan 0025, ADR 0029) : Atlas affiche un code, que
// l'on saisit sur GitHub depuis le navigateur. Aucun champ ne reçoit de jeton : le
// serveur le range lui-même au coffre de l'espace, ou le garde pour l'adhésion.

type State =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "waiting"; device: GitHubDevice; interval: number; polls: number }
  | { kind: "failed"; text: string };

const FAILURES: Record<string, string> = {
  denied: "La connexion a été refusée sur GitHub.",
  expired: "Le code a expiré avant d'être saisi : recommencer.",
};

export function GitHubConnect({
  workspace,
  label = "Se connecter à GitHub",
  primary = false,
  onConnected,
}: {
  /** Espace dont le coffre reçoit le jeton ; absent pour rejoindre un dépôt privé. */
  workspace?: string;
  label?: string;
  primary?: boolean;
  onConnected: (flow: string, account: string | null) => void;
}) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [copied, setCopied] = useState(false);
  const latest = useRef(onConnected);
  latest.current = onConnected;

  const flow = state.kind === "waiting" ? state.device.flow : null;
  const interval = state.kind === "waiting" ? state.interval : 0;
  const polls = state.kind === "waiting" ? state.polls : 0;
  useEffect(() => {
    if (!flow) return;
    let alive = true;
    // GitHub fixe le rythme (`interval`, en secondes) ; le serveur le fait respecter.
    const timer = setTimeout(async () => {
      try {
        const polled = await api.pollGitHub(flow);
        if (!alive) return;
        if (polled.status === "connected") {
          setState({ kind: "idle" });
          latest.current(flow, polled.account ?? null);
        } else if (polled.status === "pending") {
          setState((s) => (s.kind === "waiting" ? { ...s, interval: polled.interval, polls: s.polls + 1 } : s));
        } else {
          setState({ kind: "failed", text: FAILURES[polled.status] });
        }
      } catch (reason) {
        if (alive) setState({ kind: "failed", text: explain(reason).text });
      }
    }, Math.max(interval, 1) * 1000);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [flow, interval, polls]);

  async function start() {
    setState({ kind: "starting" });
    setCopied(false);
    try {
      const device = await api.startGitHub(workspace);
      setState({ kind: "waiting", device, interval: device.interval, polls: 0 });
    } catch (reason) {
      setState({ kind: "failed", text: explain(reason).text });
    }
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (state.kind === "waiting") {
    const { device } = state;
    return (
      <div className="github-device" role="group" aria-label="Connexion à GitHub">
        <p>Saisissez ce code sur GitHub, puis autorisez Skifer Atlas :</p>
        <p className="github-code mono" aria-label={`Code : ${device.user_code.split("").join(" ")}`}>
          {device.user_code}
        </p>
        <div className="github-device-actions">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void openExternal(device.verification_uri)}>
            Ouvrir GitHub
          </button>
          <button type="button" className="btn btn-neutral btn-sm" onClick={() => void copy(device.user_code)}>
            {copied ? "Code copié" : "Copier le code"}
          </button>
          <button type="button" className="link-button" onClick={() => setState({ kind: "idle" })}>
            Annuler
          </button>
        </div>
        <span className="muted" role="status">
          En attente de l'autorisation sur {device.verification_uri.replace(/^https:\/\//, "")}…
        </span>
      </div>
    );
  }

  return (
    <div className="github-device">
      <button
        type="button"
        className={`btn btn-sm ${primary ? "btn-primary" : "btn-secondary"}`}
        disabled={state.kind === "starting"}
        onClick={() => void start()}
      >
        {label}
      </button>
      {state.kind === "failed" && (
        <span className="field-error" role="alert">
          {state.text}
        </span>
      )}
    </div>
  );
}

import { yaml } from "@codemirror/lang-yaml";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";

// Vue YAML plein écran (guide 10.3, « Éditer en YAML ») : CodeMirror, sans thème propre,
// aux couleurs des tokens (styles.css). Le texte est la seule source pendant cette vue ;
// la validation est celle du canevas, côté serveur.

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "var(--atlas-text-md)" },
  ".cm-scroller": { fontFamily: "var(--atlas-font-mono)", lineHeight: "1.5" },
  ".cm-gutters": { background: "var(--atlas-ground)", color: "var(--atlas-muted)", borderRight: "var(--atlas-border) solid var(--atlas-line)" },
  ".cm-activeLine, .cm-activeLineGutter": { background: "var(--atlas-pale)" },
  "&.cm-focused": { outline: "none" },
});

export function YamlView({ initial, onChange, label }: { initial: string; onChange: (text: string) => void; label: string }) {
  const host = useRef<HTMLDivElement>(null);
  const changed = useRef(onChange);
  changed.current = onChange;

  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initial,
        extensions: [
          basicSetup,
          yaml(),
          theme,
          EditorView.contentAttributes.of({ "aria-label": label }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) changed.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.focus();
    return () => view.destroy();
    // Le texte initial n'est lu qu'à l'ouverture : la vue garde ensuite la main.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} className="yaml-editor" />;
}

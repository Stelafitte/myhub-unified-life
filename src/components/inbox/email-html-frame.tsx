import { useEffect, useRef, useState } from "react";

type Props = { html: string };

/**
 * Rend le HTML d'un email dans une iframe sandbox pour éviter que ses styles
 * (position:fixed, body{...}, larges largeurs, scripts…) ne s'échappent et
 * cassent la mise en page de l'app (ex: emails marketing type Veepee).
 */
export function EmailHtmlFrame({ html }: Props) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(400);

  const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><meta name="viewport" content="width=device-width, initial-scale=1"><style>
    html,body{margin:0;padding:12px;background:transparent;color:inherit;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.5;word-wrap:break-word;overflow-wrap:anywhere;}
    img,table,video{max-width:100% !important;height:auto !important;}
    table{table-layout:auto;width:auto !important;max-width:100% !important;}
    *{box-sizing:border-box;max-width:100% !important;}
    a{color:#2563eb;}
  </style></head><body>${html}</body></html>`;

  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;
    const resize = () => {
      try {
        const doc = iframe.contentDocument;
        if (!doc) return;
        const h = Math.max(
          doc.documentElement.scrollHeight,
          doc.body?.scrollHeight ?? 0,
        );
        setHeight(Math.min(h + 8, 4000));
      } catch {
        /* ignore */
      }
    };
    iframe.addEventListener("load", resize);
    const interval = setInterval(resize, 500);
    setTimeout(() => clearInterval(interval), 3000);
    return () => {
      iframe.removeEventListener("load", resize);
      clearInterval(interval);
    };
  }, [html]);

  return (
    <iframe
      ref={ref}
      title="Contenu de l'email"
      sandbox="allow-same-origin allow-popups"
      srcDoc={srcDoc}
      style={{ width: "100%", height, border: 0, display: "block" }}
    />
  );
}

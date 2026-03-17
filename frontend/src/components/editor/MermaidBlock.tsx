import { useEffect, useRef, useState, useId } from 'react';

let mermaidPromise: Promise<typeof import('mermaid')> | null = null;
function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => {
      m.default.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose' });
      return m;
    });
  }
  return mermaidPromise;
}

export function MermaidBlock({ code }: { code: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // useId gives a stable, unique-per-instance ID that survives StrictMode double-invoke
  const rawId = useId();
  const id = `mermaid-${rawId.replace(/[^a-z0-9]/gi, '')}`;

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setLoading(true);

    loadMermaid()
      .then(async (m) => {
        if (cancelled || !containerRef.current) return;
        // Remove any leftover temp element mermaid may have appended to body
        document.getElementById(id)?.remove();
        try {
          const { svg } = await m.default.render(id, code);
          document.getElementById(id)?.remove();
          if (!cancelled && containerRef.current) {
            containerRef.current.innerHTML = svg;
          }
        } catch (e: any) {
          document.getElementById(id)?.remove();
          if (!cancelled) setError(e.message || 'Failed to render diagram');
        }
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load Mermaid');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      document.getElementById(id)?.remove();
    };
  }, [code, id]);

  if (error) {
    return (
      <pre className="rounded-md border border-danger/30 bg-danger-light p-3 text-xs font-mono overflow-x-auto">
        <code>{code}</code>
        <p className="mt-2 text-danger text-xs">{error}</p>
      </pre>
    );
  }

  return (
    <div className="my-4">
      {loading && (
        <div className="flex items-center gap-2 text-sm text-text-secondary py-4">
          <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          Rendering diagram...
        </div>
      )}
      <div ref={containerRef} className="flex justify-center overflow-x-auto" />
    </div>
  );
}

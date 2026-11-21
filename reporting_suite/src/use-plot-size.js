import { useCallback, useState } from "react";

// Plot geometry uses CSS pixels so labels, markers and strokes retain their size.
export function usePlotSize() {
  const [size, setSize] = useState({ width: 300, height: 140 });
  const ref = useCallback((svg) => {
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);
  return { ref, ...size };
}

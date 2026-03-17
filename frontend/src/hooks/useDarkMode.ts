import { useState, useEffect } from 'react';

export function useDarkMode() {
  const [isDark, setIsDark] = useState(() => {
    if (typeof window === 'undefined') return false;
    const saved = localStorage.getItem('axiom-theme');
    if (saved) return saved === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
      localStorage.setItem('axiom-theme', 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('axiom-theme', 'light');
    }
  }, [isDark]);

  return { isDark, toggle: () => setIsDark((d) => !d), setDark: setIsDark };
}

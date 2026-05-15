@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --ink: #0d0f12;
  --ink-muted: #4a5060;
  --ink-faint: #8a909e;
  --surface: #f7f6f2;
  --surface-raised: #ffffff;
  --surface-sunken: #eceae4;
  --border: #dcdad4;
  --border-strong: #b8b5ae;
  --accent: #1a3a5c;
  --accent-light: #e8eef5;
  --accent-text: #ffffff;
  --green: #1a6642;
  --green-light: #e6f2ec;
  --amber: #8a5a00;
  --amber-light: #fdf3dc;
  --red: #8a1a1a;
  --red-light: #faeaea;
  --split-color: #4a2d82;
  --split-light: #f0eafa;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  background: var(--surface);
  color: var(--ink);
  font-family: var(--font-body), sans-serif;
  font-size: 15px;
  line-height: 1.6;
  min-height: 100vh;
}

/* Grain texture overlay */
body::before {
  content: "";
  position: fixed;
  inset: 0;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.03'/%3E%3C/svg%3E");
  pointer-events: none;
  z-index: 9999;
  opacity: 0.4;
}

/* Scrollbar */
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: var(--surface-sunken); }
::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 3px; }

/* Animations */
@keyframes fadeUp {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.3; }
}

.fade-up { animation: fadeUp 0.4s ease both; }
.fade-up-1 { animation: fadeUp 0.4s 0.05s ease both; }
.fade-up-2 { animation: fadeUp 0.4s 0.10s ease both; }
.fade-up-3 { animation: fadeUp 0.4s 0.15s ease both; }
.fade-up-4 { animation: fadeUp 0.4s 0.20s ease both; }

.skeleton {
  background: linear-gradient(90deg, var(--surface-sunken) 25%, var(--border) 50%, var(--surface-sunken) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.4s infinite;
  border-radius: 4px;
}

export default function AuroraBackground({ children }) {
  return (
    <main className="planner-aurora-shell relative isolate min-h-[calc(100dvh-56px)] overflow-clip bg-zinc-50">
      <style>{`
        .planner-aurora-layer {
          position: absolute;
          inset: -10px;
          pointer-events: none;
          background-image:
            repeating-linear-gradient(
              100deg,
              white 0%,
              white 7%,
              transparent 10%,
              transparent 12%,
              white 16%
            ),
            repeating-linear-gradient(
              100deg,
              #3b82f6 10%,
              #a5b4fc 15%,
              #93c5fd 20%,
              #ddd6fe 25%,
              #60a5fa 30%
            );
          background-size: 300%, 200%;
          background-position: 50% 50%, 50% 50%;
          filter: blur(10px) invert(1) saturate(1.45) contrast(1.18);
          opacity: 0.72;
          mask-image: radial-gradient(ellipse at 100% 0%, black 10%, transparent 70%);
          -webkit-mask-image: radial-gradient(ellipse at 100% 0%, black 10%, transparent 70%);
          /* Pin this expensive blur+blend layer onto its own cached GPU layer so page
             updates (scroll, slider drag, re-renders) re-composite the cached texture
             instead of repainting the whole aurora every frame (dev30 jank fix). */
          transform: translateZ(0);
          will-change: transform;
          backface-visibility: hidden;
        }

        .planner-aurora-layer::after {
          content: "";
          position: absolute;
          inset: 0;
          background-image:
            repeating-linear-gradient(
              100deg,
              white 0%,
              white 7%,
              transparent 10%,
              transparent 12%,
              white 16%
            ),
            repeating-linear-gradient(
              100deg,
              #3b82f6 10%,
              #a5b4fc 15%,
              #93c5fd 20%,
              #ddd6fe 25%,
              #60a5fa 30%
            );
          background-size: 200%, 100%;
          background-position: 50% 50%, 50% 50%;
          mix-blend-mode: difference;
        }
      `}</style>
      <div className="planner-aurora-layer" aria-hidden="true" />
      <div className="relative z-10 min-h-[calc(100dvh-56px)]">{children}</div>
    </main>
  )
}
